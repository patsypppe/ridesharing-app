// backend/services/ride-service/handler.js
const { createResponse, validateToken, dbGet, dbPut, dbUpdate, dbQuery, publishEvent, schemas } = require('/opt/utils');
const { v4: uuidv4 } = require('uuid');

// Request a ride
exports.requestRide = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const body = JSON.parse(event.body);
    
    // Validate ride request
    const { error, value } = schemas.ride.validate(body);
    if (error) {
      return createResponse(400, { 
        error: 'Validation failed', 
        details: error.details[0].message 
      });
    }

    // Check if user has an active ride
    const activeRide = await dbQuery({
      TableName: process.env.RIDES_TABLE,
      IndexName: 'UserRidesIndex',
      KeyConditionExpression: 'userId = :userId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':status': 'active'
      }
    });

    if (activeRide.Items && activeRide.Items.length > 0) {
      return createResponse(409, { 
        error: 'You already have an active ride request' 
      });
    }

    // Calculate estimated fare and distance
    const estimatedDistance = calculateDistance(
      value.pickupLocation.lat, value.pickupLocation.lng,
      value.dropoffLocation.lat, value.dropoffLocation.lng
    );
    
    const estimatedFare = calculateEstimatedFare(estimatedDistance, value.rideType);

    // Create ride request
    const rideId = uuidv4();
    const ride = {
      rideId,
      userId,
      driverId: null,
      status: 'requested', // requested, matched, en-route, in-progress, completed, cancelled
      rideType: value.rideType,
      pickupLocation: value.pickupLocation,
      dropoffLocation: value.dropoffLocation,
      estimatedDistance,
      estimatedFare,
      actualFare: null,
      createdAt: new Date().toISOString(),
      matchedAt: null,
      startedAt: null,
      completedAt: null
    };

    await dbPut({
      TableName: process.env.RIDES_TABLE,
      Item: ride
    });

    // Publish ride request event for matching service
    await publishEvent('Ride Requested', {
      rideId,
      userId,
      pickupLocation: value.pickupLocation,
      rideType: value.rideType,
      estimatedFare
    });

    return createResponse(201, { 
      message: 'Ride requested successfully',
      ride: {
        rideId: ride.rideId,
        status: ride.status,
        estimatedFare: ride.estimatedFare,
        estimatedDistance: ride.estimatedDistance
      }
    });

  } catch (error) {
    console.error('Request ride error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Accept ride (driver endpoint)
exports.acceptRide = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const driverId = decodedToken.sub;

    const { rideId } = event.pathParameters;

    // Get ride details
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      return createResponse(404, { error: 'Ride not found' });
    }

    if (ride.status !== 'requested') {
      return createResponse(409, { 
        error: 'Ride is no longer available' 
      });
    }

    // Check if driver is available
    const driver = await dbGet({
      TableName: process.env.DRIVERS_TABLE,
      Key: { driverId }
    });

    if (!driver || driver.status !== 'available') {
      return createResponse(409, { 
        error: 'Driver is not available' 
      });
    }

    // Update ride with driver assignment
    await dbUpdate({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId },
      UpdateExpression: 'SET driverId = :driverId, #status = :status, matchedAt = :matchedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':driverId': driverId,
        ':status': 'matched',
        ':matchedAt': new Date().toISOString()
      }
    });

    // Update driver status to busy
    await dbUpdate({
      TableName: process.env.DRIVERS_TABLE,
      Key: { driverId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'busy',
        ':updatedAt': new Date().toISOString()
      }
    });

    // Publish ride matched event
    await publishEvent('Ride Matched', {
      rideId,
      driverId,
      userId: ride.userId
    });

    return createResponse(200, { 
      message: 'Ride accepted successfully',
      ride: {
        rideId,
        userId: ride.userId,
        pickupLocation: ride.pickupLocation,
        dropoffLocation: ride.dropoffLocation
      }
    });

  } catch (error) {
    console.error('Accept ride error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Update ride status
exports.updateRideStatus = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const { rideId } = event.pathParameters;
    const body = JSON.parse(event.body);
    const { status, location } = body;

    const validStatuses = ['en-route', 'arrived', 'in-progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return createResponse(400, { 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    // Get current ride
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      return createResponse(404, { error: 'Ride not found' });
    }

    // Verify authorization (user or assigned driver)
    if (ride.userId !== userId && ride.driverId !== userId) {
      return createResponse(403, { error: 'Unauthorized to update this ride' });
    }

    // Build update expression
    const updates = {
      status,
      updatedAt: new Date().toISOString()
    };

    // Set timestamp based on status
    if (status === 'in-progress') {
      updates.startedAt = new Date().toISOString();
    } else if (status === 'completed') {
      updates.completedAt = new Date().toISOString();
      // Calculate actual fare if not set
      if (!ride.actualFare) {
        updates.actualFare = ride.estimatedFare; // Simplified - would include surge pricing
      }
    }

    const updateExpression = 'SET ' + Object.keys(updates)
      .map(key => `#${key} = :${key}`)
      .join(', ');

    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    Object.keys(updates).forEach(key => {
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = updates[key];
    });

    await dbUpdate({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    });

    // If ride completed, update driver status and stats
    if (status === 'completed' && ride.driverId) {
      await dbUpdate({
        TableName: process.env.DRIVERS_TABLE,
        Key: { driverId: ride.driverId },
        UpdateExpression: 'SET #status = :status, totalRides = totalRides + :increment, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'available',
          ':increment': 1,
          ':updatedAt': new Date().toISOString()
        }
      });
    }

    // Publish ride status change event
    await publishEvent('Ride Status Changed', {
      rideId,
      status,
      userId: ride.userId,
      driverId: ride.driverId,
      location
    });

    return createResponse(200, { 
      message: 'Ride status updated successfully' 
    });

  } catch (error) {
    console.error('Update ride status error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Get ride history
exports.getRideHistory = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const { limit = 20, startKey } = event.queryStringParameters || {};

    const queryParams = {
      TableName: process.env.RIDES_TABLE,
      IndexName: 'UserRidesIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: parseInt(limit),
      ScanIndexForward: false // Most recent first
    };

    if (startKey) {
      queryParams.ExclusiveStartKey = JSON.parse(decodeURIComponent(startKey));
    }

    const result = await dbQuery(queryParams);

    return createResponse(200, { 
      rides: result.Items,
      lastEvaluatedKey: result.LastEvaluatedKey ? 
        encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });

  } catch (error) {
    console.error('Get ride history error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Helper functions
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateEstimatedFare(distanceKm, rideType) {
  const baseFare = 2.50;
  const perKmRate = {
    'standard': 1.20,
    'premium': 2.00, 
    'pool': 0.80
  };
  
  return baseFare + (distanceKm * (perKmRate[rideType] || perKmRate.standard));
}
