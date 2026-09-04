// backend/services/user-service/handler.js
const { createResponse, authenticate, dbGet, dbPut, dbUpdate, schemas } = require('/opt/nodejs/utils');

// User registration handler
// Creates the DynamoDB profile for an already-signed-up Cognito user. The
// profile is keyed by the Cognito `sub` because every other service looks
// users up by the `sub` in their token.
exports.register = async (event) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const body = JSON.parse(event.body);

    // Validate input
    const { error, value } = schemas.user.validate(body);
    if (error) {
      return createResponse(400, {
        error: 'Validation failed',
        details: error.details[0].message
      });
    }

    // Check if this Cognito user already has a profile
    const existingUser = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (existingUser) {
      return createResponse(409, {
        error: 'User already exists'
      });
    }

    // Create new user
    const user = {
      userId,
      email: value.email,
      firstName: value.firstName,
      lastName: value.lastName,
      phoneNumber: value.phoneNumber || null,
      userType: 'rider', // Default to rider
      createdAt: new Date().toISOString(),
      isActive: true,
      profileComplete: false
    };

    await dbPut({
      TableName: process.env.USERS_TABLE,
      Item: user
    });

    return createResponse(201, {
      message: 'User registered successfully',
      user
    });

  } catch (error) {
    console.error('Registration error:', error);
    return createResponse(500, {
      error: 'Internal server error'
    });
  }
};

// Get user profile
exports.getProfile = async (event) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    // Fetch user profile
    const user = await dbGet({
      TableName: process.env.USERS_TABLE,
      Key: { userId }
    });

    if (!user) {
      return createResponse(404, { error: 'User not found' });
    }

    return createResponse(200, { user });

  } catch (error) {
    console.error('Get profile error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Update user profile
exports.updateProfile = async (event) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const body = JSON.parse(event.body);
    
    // Validate update data
    const allowedFields = ['firstName', 'lastName', 'phoneNumber'];
    const updates = {};
    
    allowedFields.forEach(field => {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    });

    if (Object.keys(updates).length === 0) {
      return createResponse(400, { error: 'No valid fields to update' });
    }

    // Build update expression
    const updateExpression = 'SET ' + Object.keys(updates)
      .map(key => `#${key} = :${key}`)
      .join(', ') + ', updatedAt = :updatedAt';

    const expressionAttributeNames = {};
    const expressionAttributeValues = { ':updatedAt': new Date().toISOString() };
    
    Object.keys(updates).forEach(key => {
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = updates[key];
    });

    await dbUpdate({
      TableName: process.env.USERS_TABLE,
      Key: { userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    });

    return createResponse(200, { 
      message: 'Profile updated successfully' 
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};

// Switch user type (rider <-> driver)
exports.switchUserType = async (event) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const body = JSON.parse(event.body);
    const { userType } = body;

    if (!['rider', 'driver'].includes(userType)) {
      return createResponse(400, { 
        error: 'Invalid user type. Must be either rider or driver' 
      });
    }

    await dbUpdate({
      TableName: process.env.USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'SET userType = :userType, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':userType': userType,
        ':updatedAt': new Date().toISOString()
      }
    });

    return createResponse(200, { 
      message: `User type switched to ${userType}` 
    });

  } catch (error) {
    console.error('Switch user type error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
};
