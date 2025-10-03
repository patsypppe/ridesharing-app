// backend/services/websocket-service/handler.js
const { createResponse, dbPut, dbGet, dbQuery, dbUpdate } = require('/opt/utils');

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

// WebSocket connection handler
exports.connect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const { userId, userType } = event.queryStringParameters || {};

    if (!userId || !userType) {
      return createResponse(400, { error: 'Missing required parameters' });
    }

    // Store connection info
    const connection = {
      connectionId,
      userId,
      userType, // 'rider' or 'driver'
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    await dbPut({
      TableName: CONNECTIONS_TABLE,
      Item: connection
    });

    console.log(`Connection established: ${connectionId} for user ${userId}`);
    return createResponse(200, { message: 'Connected successfully' });

  } catch (error) {
    console.error('Connection error:', error);
    return createResponse(500, { error: 'Failed to connect' });
  }
};

// WebSocket disconnection handler
exports.disconnect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;

    await dbUpdate({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET disconnectedAt = :disconnectedAt',
      ExpressionAttributeValues: {
        ':disconnectedAt': new Date().toISOString()
      }
    });

    console.log(`Connection closed: ${connectionId}`);
    return createResponse(200, { message: 'Disconnected successfully' });

  } catch (error) {
    console.error('Disconnection error:', error);
    return createResponse(500, { error: 'Failed to disconnect' });
  }
};

// WebSocket message handler
exports.message = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body);
    const { action, data } = body;

    // Update last activity
    await dbUpdate({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET lastActivity = :lastActivity',
      ExpressionAttributeValues: {
        ':lastActivity': new Date().toISOString()
      }
    });

    // Handle different message types
    switch (action) {
      case 'location_update':
        await handleLocationUpdate(connectionId, data);
        break;
      case 'ride_status_update':
        await handleRideStatusUpdate(connectionId, data);
        break;
      case 'ping':
        await sendMessageToConnection(connectionId, { type: 'pong' });
        break;
      default:
        console.log(`Unknown action: ${action}`);
    }

    return createResponse(200, { message: 'Message processed' });

  } catch (error) {
    console.error('Message handling error:', error);
    return createResponse(500, { error: 'Failed to process message' });
  }
};

// Send location updates to relevant connections
const handleLocationUpdate = async (connectionId, locationData) => {
  const { userId, location, rideId } = locationData;

  if (!rideId) {
    console.error('No ride ID provided for location update');
    return;
  }

  try {
    // Get ride details to find who should receive updates
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      console.error(`Ride not found: ${rideId}`);
      return;
    }

    // Send location update to rider and driver
    const targetUsers = [ride.userId, ride.driverId].filter(id => id !== userId);

    for (const targetUserId of targetUsers) {
      const connections = await getUserConnections(targetUserId);
      
      for (const connection of connections) {
        await sendMessageToConnection(connection.connectionId, {
          type: 'location_update',
          rideId,
          userId,
          location,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('Error handling location update:', error);
  }
};

// Handle ride status updates
const handleRideStatusUpdate = async (connectionId, statusData) => {
  const { rideId, status, message } = statusData;

  try {
    // Get ride details
    const ride = await dbGet({
      TableName: process.env.RIDES_TABLE,
      Key: { rideId }
    });

    if (!ride) {
      console.error(`Ride not found: ${rideId}`);
      return;
    }

    // Send status update to both rider and driver
    const targetUsers = [ride.userId, ride.driverId];

    for (const targetUserId of targetUsers) {
      const connections = await getUserConnections(targetUserId);
      
      for (const connection of connections) {
        await sendMessageToConnection(connection.connectionId, {
          type: 'ride_status_update',
          rideId,
          status,
          message,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('Error handling ride status update:', error);
  }
};

// Get active connections for a user
const getUserConnections = async (userId) => {
  try {
    const result = await dbQuery({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'UserConnectionsIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'attribute_not_exists(disconnectedAt)',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    });

    return result.Items || [];
  } catch (error) {
    console.error('Error getting user connections:', error);
    return [];
  }
};

// Send message to specific connection
const sendMessageToConnection = async (connectionId, message) => {
  const AWS = require('aws-sdk');
  const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.WEBSOCKET_API_ENDPOINT
  });

  try {
    await apiGateway.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }).promise();
  } catch (error) {
    if (error.statusCode === 410 || error.statusCode === 403) {
      // Connection is gone, mark as disconnected
      await dbUpdate({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET disconnectedAt = :disconnectedAt',
        ExpressionAttributeValues: {
          ':disconnectedAt': new Date().toISOString()
        }
      });
    } else {
      console.error('Error sending message to connection:', error);
    }
  }
};

// Broadcast message to all connections (for system notifications)
exports.broadcast = async (event) => {
  try {
    const { message, userType, excludeUserId } = JSON.parse(event.body);

    // Get all active connections
    const result = await dbQuery({
      TableName: CONNECTIONS_TABLE,
      FilterExpression: 'attribute_not_exists(disconnectedAt)',
      ...(userType && {
        FilterExpression: 'attribute_not_exists(disconnectedAt) AND userType = :userType',
        ExpressionAttributeValues: { ':userType': userType }
      })
    });

    const connections = (result.Items || []).filter(conn => 
      !excludeUserId || conn.userId !== excludeUserId
    );

    // Send to all matching connections
    const sendPromises = connections.map(connection =>
      sendMessageToConnection(connection.connectionId, message)
    );

    await Promise.allSettled(sendPromises);

    return createResponse(200, { 
      message: `Broadcast sent to ${connections.length} connections` 
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    return createResponse(500, { error: 'Failed to broadcast message' });
  }
};
