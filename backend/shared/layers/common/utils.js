const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// Initialize AWS services with optimal configuration
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION,
  maxRetries: 3,
  httpOptions: {
    timeout: 5000
  }
});

const sns = new AWS.SNS({ region: process.env.AWS_REGION });
const eventbridge = new AWS.EventBridge({ region: process.env.AWS_REGION });

// Common response helper
const createResponse = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    ...headers
  },
  body: JSON.stringify(body)
});

// JWT token validation
const validateToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.sub) {
      throw new Error('Invalid token structure');
    }
    return decoded;
  } catch (error) {
    throw new Error('Token validation failed');
  }
};

// DynamoDB helpers with error handling
const dbGet = async (params) => {
  try {
    const result = await dynamodb.get(params).promise();
    return result.Item;
  } catch (error) {
    console.error('DynamoDB get error:', error);
    throw error;
  }
};

const dbPut = async (params) => {
  try {
    return await dynamodb.put(params).promise();
  } catch (error) {
    console.error('DynamoDB put error:', error);
    throw error;
  }
};

const dbQuery = async (params) => {
  try {
    return await dynamodb.query(params).promise();
  } catch (error) {
    console.error('DynamoDB query error:', error);
    throw error;
  }
};

const dbUpdate = async (params) => {
  try {
    return await dynamodb.update(params).promise();
  } catch (error) {
    console.error('DynamoDB update error:', error);
    throw error;
  }
};

// Event publishing helper
const publishEvent = async (eventType, detail, source = 'rideshare.app') => {
  const params = {
    Entries: [{
      Source: source,
      DetailType: eventType,
      Detail: JSON.stringify(detail),
      EventBusName: process.env.EVENT_BUS_NAME
    }]
  };

  try {
    return await eventbridge.putEvents(params).promise();
  } catch (error) {
    console.error('EventBridge publish error:', error);
    throw error;
  }
};

// Validation schemas
const schemas = {
  user: Joi.object({
    email: Joi.string().email().required(),
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/)
  }),

  ride: Joi.object({
    pickupLocation: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required()
    }).required(),
    dropoffLocation: Joi.object({
      lat: Joi.number().min(-90).max(90).required(), 
      lng: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required()
    }).required(),
    rideType: Joi.string().valid('standard', 'premium', 'pool').default('standard')
  }),

  driver: Joi.object({
    licenseNumber: Joi.string().required(),
    vehicleInfo: Joi.object({
      make: Joi.string().required(),
      model: Joi.string().required(),
      year: Joi.number().integer().min(2000).max(new Date().getFullYear()),
      licensePlate: Joi.string().required(),
      color: Joi.string().required()
    }).required()
  })
};

module.exports = {
  createResponse,
  validateToken,
  dbGet,
  dbPut, 
  dbQuery,
  dbUpdate,
  publishEvent,
  schemas,
  dynamodb,
  sns,
  eventbridge
};