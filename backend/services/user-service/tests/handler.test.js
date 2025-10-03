// backend/services/user-service/tests/handler.test.js
const { register, getProfile, updateProfile } = require('../handler');
const AWS = require('aws-sdk-mock');

// Mock AWS services
beforeAll(() => {
  process.env.USERS_TABLE = 'test-users-table';
  AWS.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {
    if (params.Key.userId === 'existing-user') {
      callback(null, { Item: { userId: 'existing-user', email: 'test@example.com' } });
    } else {
      callback(null, {});
    }
  });

  AWS.mock('DynamoDB.DocumentClient', 'put', (params, callback) => {
    callback(null, {});
  });
});

afterAll(() => {
  AWS.restore('DynamoDB.DocumentClient');
});

describe('User Service', () => {
  describe('register', () => {
    test('should successfully register a new user', async () => {
      const event = {
        body: JSON.stringify({
          email: 'newuser@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+1234567890'
        })
      };

      const result = await register(event);
      const response = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(response.message).toBe('User registered successfully');
      expect(response.user.email).toBe('newuser@example.com');
    });

    test('should return error for invalid email', async () => {
      const event = {
        body: JSON.stringify({
          email: 'invalid-email',
          firstName: 'John',
          lastName: 'Doe'
        })
      };

      const result = await register(event);
      const response = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(response.error).toBe('Validation failed');
    });

    test('should return error for existing user', async () => {
      const event = {
        body: JSON.stringify({
          email: 'existing@example.com',
          firstName: 'John',
          lastName: 'Doe'
        })
      };

      // Mock existing user
      AWS.remock('DynamoDB.DocumentClient', 'get', (params, callback) => {
        callback(null, { Item: { userId: 'existing-user' } });
      });

      const result = await register(event);
      const response = JSON.parse(result.body);

      expect(result.statusCode).toBe(409);
      expect(response.error).toBe('User already exists');
    });
  });

  describe('getProfile', () => {
    test('should return user profile for valid token', async () => {
      const event = {
        headers: {
          Authorization: 'Bearer valid-jwt-token'
        }
      };

      // Mock JWT validation
      jest.spyOn(require('/opt/utils'), 'validateToken').mockReturnValue({
        sub: 'test-user-id'
      });

      const result = await getProfile(event);
      const response = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(response.user).toBeDefined();
    });

    test('should return error for missing authorization header', async () => {
      const event = {
        headers: {}
      };

      const result = await getProfile(event);
      const response = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(response.error).toBe('No authorization header');
    });
  });
});
