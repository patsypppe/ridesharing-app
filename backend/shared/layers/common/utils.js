const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
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

// ---------------------------------------------------------------------------
// Cognito JWT verification
//
// Tokens are RS256-signed by the user pool. Public keys are fetched from the
// pool's JWKS endpoint and cached in the Lambda container between invocations.
// Requires AWS_REGION, USER_POOL_ID and USER_POOL_CLIENT_ID on every function.
// ---------------------------------------------------------------------------
const TOKEN_ERROR = 'Token validation failed';
const JWKS_CACHE_MS = 10 * 60 * 1000;

const cognitoIssuer = () =>
  `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`;

let jwks = null;
const getJwksClient = () => {
  if (!jwks) {
    jwks = jwksClient({
      jwksUri: `${cognitoIssuer()}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: JWKS_CACHE_MS,
      rateLimit: true,
      jwksRequestsPerMinute: 10
    });
  }
  return jwks;
};

const getSigningKey = (header, callback) => {
  getJwksClient().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    return callback(null, key.getPublicKey());
  });
};

// ID tokens carry the app client in `aud`; access tokens carry it in `client_id`.
// Fails closed: without USER_POOL_CLIENT_ID a token from any app client on the
// pool would otherwise be accepted.
const audienceMatches = (claims) => {
  const clientId = process.env.USER_POOL_CLIENT_ID;
  if (!clientId) {
    console.error('USER_POOL_CLIENT_ID is not set; rejecting token');
    return false;
  }
  return claims.aud === clientId || claims.client_id === clientId;
};

// Verifies signature, issuer, expiry and audience. Resolves the token claims.
// Rejects with a generic error so callers never leak why a token failed.
const validateToken = (token) =>
  new Promise((resolve, reject) => {
    if (!token || typeof token !== 'string') {
      return reject(new Error(TOKEN_ERROR));
    }

    return jwt.verify(
      token,
      getSigningKey,
      { issuer: cognitoIssuer(), algorithms: ['RS256'] },
      (err, claims) => {
        if (err || !claims || !claims.sub || !audienceMatches(claims)) {
          if (err) console.warn('JWT verification failed:', err.message);
          return reject(new Error(TOKEN_ERROR));
        }
        return resolve(claims);
      }
    );
  });

// Resolves the caller of an HTTP API request.
//   { ok: true, userId, claims }   - authenticated
//   { ok: false, response }        - a ready-to-return 401
// If the route sits behind an API Gateway JWT authorizer the gateway has
// already verified the token, so its claims are used without a JWKS lookup.
const authenticate = async (event) => {
  const gatewayClaims = event?.requestContext?.authorizer?.jwt?.claims;
  if (gatewayClaims && gatewayClaims.sub) {
    return { ok: true, userId: gatewayClaims.sub, claims: gatewayClaims };
  }

  const headers = event?.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  if (!authHeader) {
    return { ok: false, response: createResponse(401, { error: 'No authorization header' }) };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const claims = await validateToken(token);
    return { ok: true, userId: claims.sub, claims };
  } catch (error) {
    return { ok: false, response: createResponse(401, { error: 'Invalid or expired token' }) };
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

// Table-wide read. Use only for small tables (e.g. live WebSocket connections).
const dbScan = async (params) => {
  try {
    return await dynamodb.scan(params).promise();
  } catch (error) {
    console.error('DynamoDB scan error:', error);
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
  authenticate,
  dbGet,
  dbPut,
  dbQuery,
  dbUpdate,
  dbScan,
  publishEvent,
  schemas,
  dynamodb,
  sns,
  eventbridge
};
