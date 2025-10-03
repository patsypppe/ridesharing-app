// backend/services/driver-service/handler.js
const { createResponse, validateToken, dbGet, dbPut, dbUpdate, dbQuery, publishEvent, schemas } = require('/opt/utils');
const { v4: uuidv4 } = require('uuid');

// Register as driver
exports.registerDriver = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const userId = decodedToken.sub;

    const body = JSON.parse(event.body);
    
    // Validate driver data
    const { error, value } = schemas.driver.validate(body);
    if (error) {
      return createResponse(400, { 
        error: 'Validation failed', 
        details: error.details[0].message 
      });
    }

    // Check if driver already exists
    const existingDriver = await dbGet({
      TableName: process.env.DRIVERS_TABLE,
      Key: { driverId: userId }
    });

    if (existingDriver) {
      return createResponse(409, { error: 'Driver profile already exists' });
    }

    // Create driver profile
    const driverId = userId;
    const driver = {
      driverId,
      userId,
      licenseNumber: value.licenseNumber,
      vehicleInfo: value.vehicleInfo,
      status: 'offline', // offline, available, busy
      rating: 5.0,
      totalRides: 0,
      isVerified: false,
      location: null,
      locationHash: null,
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await dbPut({
      TableName: process.env.DRIVERS_TABLE,
      Item: driver
    });

    // Update user type in users table
    await dbUpdate({
      TableName: process.env.USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'SET userType = :userType, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':userType': 'driver',
        ':updatedAt': new Date().toISOString()
      }
    });

    // Publish driver registration event
    await publishEvent('Driver Registered', { driverId, userId });

    return createResponse(201, { 
      message: 'Driver registered successfully',
      driver: { ...driver, licenseNumber: '***' + driver.licenseNumber.slice(-4) }
    });

  } catch (error) {
    console.error('Driver registration error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Update driver availability/status
exports.updateAvailability = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const driverId = decodedToken.sub;

    const body = JSON.parse(event.body);
    const { status, location } = body;

    if (!['offline', 'available', 'busy'].includes(status)) {
      return createResponse(400, { 
        error: 'Invalid status. Must be offline, available, or busy' 
      });
    }

    const updates = {
      status,
      updatedAt: new Date().toISOString()
    };

    // If location provided, update location and calculate geohash
    if (location && location.lat && location.lng) {
      updates.location = location;
      // Simple geohash implementation for demonstration
      updates.locationHash = generateLocationHash(location.lat, location.lng);
    }

    // Build update expression
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
      TableName: process.env.DRIVERS_TABLE,
      Key: { driverId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    });

    // Publish availability change event
    await publishEvent('Driver Availability Changed', { 
      driverId, 
      status, 
      location: updates.location || null
    });

    return createResponse(200, { 
      message: 'Availability updated successfully' 
    });

  } catch (error) {
    console.error('Update availability error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Get driver profile
exports.getDriverProfile = async (event) => {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = validateToken(token);
    const driverId = decodedToken.sub;

    const driver = await dbGet({
      TableName: process.env.DRIVERS_TABLE,
      Key: { driverId }
    });

    if (!driver) {
      return createResponse(404, { error: 'Driver not found' });
    }

    // Mask sensitive information
    const driverResponse = {
      ...driver,
      licenseNumber: '***' + driver.licenseNumber.slice(-4)
    };

    return createResponse(200, { driver: driverResponse });

  } catch (error) {
    console.error('Get driver profile error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Get nearby available drivers (for matching service)
exports.getNearbyDrivers = async (event) => {
  try {
    const { lat, lng, radius = 5 } = event.queryStringParameters || {};
    
    if (!lat || !lng) {
      return createResponse(400, { 
        error: 'Latitude and longitude are required' 
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    // Generate location hashes for search area (simplified implementation)
    const locationHashes = generateNearbyLocationHashes(latitude, longitude, radius);
    
    const nearbyDrivers = [];

    // Query each location hash
    for (const hash of locationHashes) {
      const result = await dbQuery({
        TableName: process.env.DRIVERS_TABLE,
        IndexName: 'LocationIndex',
        KeyConditionExpression: 'locationHash = :locationHash',
        FilterExpression: '#status = :status AND isActive = :isActive',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':locationHash': hash,
          ':status': 'available',
          ':isActive': true
        }
      });

      if (result.Items) {
        // Filter by actual distance
        const validDrivers = result.Items.filter(driver => {
          if (!driver.location) return false;
          const distance = calculateDistance(
            latitude, longitude,
            driver.location.lat, driver.location.lng
          );
          return distance <= radius;
        });

        nearbyDrivers.push(...validDrivers);
      }
    }

    // Sort by distance and rating
    const sortedDrivers = nearbyDrivers
      .map(driver => ({
        ...driver,
        distance: calculateDistance(
          latitude, longitude,
          driver.location.lat, driver.location.lng
        )
      }))
      .sort((a, b) => {
        // Prioritize closer drivers with higher ratings
        const scoreA = (a.rating * 0.3) - (a.distance * 0.7);
        const scoreB = (b.rating * 0.3) - (b.distance * 0.7);
        return scoreB - scoreA;
      })
      .slice(0, 10); // Return top 10 drivers

    return createResponse(200, { drivers: sortedDrivers });

  } catch (error) {
    console.error('Get nearby drivers error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Helper function to generate simple geohash (simplified implementation)
function generateLocationHash(lat, lng) {
  // Simple grid-based hashing - in production use proper geohash library
  const latGrid = Math.floor(lat * 100);  
  const lngGrid = Math.floor(lng * 100);
  return `${latGrid}_${lngGrid}`;
}

// Generate nearby location hashes for search
function generateNearbyLocationHashes(lat, lng, radiusKm) {
  const hashes = new Set();
  
  // Calculate grid size (approximate)
  const gridSize = 0.01; // ~1km
  const steps = Math.ceil(radiusKm / 111.32); // Approximate km per degree
  
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const testLat = lat + (i * gridSize);
      const testLng = lng + (j * gridSize);
      hashes.add(generateLocationHash(testLat, testLng));
    }
  }
  
  return Array.from(hashes);
}

// Calculate distance between two points (Haversine formula)
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
