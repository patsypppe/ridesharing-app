// backend/tests/integration/api.test.js
const axios = require('axios');
const AWS = require('aws-sdk');

const API_BASE_URL = process.env.API_GATEWAY_URL || 'https://api.test.rideshare.com';
const cognito = new AWS.CognitoIdentityServiceProvider({ region: 'us-east-1' });

describe('Rideshare API Integration Tests', () => {
  let authToken;
  let testUserId;

  beforeAll(async () => {
    // Create test user and get auth token
    const testUser = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      firstName: 'Integration',
      lastName: 'Test'
    };

    try {
      // Sign up test user
      await cognito.adminCreateUser({
        UserPoolId: process.env.USER_POOL_ID,
        Username: testUser.email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: testUser.password
      }).promise();

      // Set permanent password
      await cognito.adminSetUserPassword({
        UserPoolId: process.env.USER_POOL_ID,
        Username: testUser.email,
        Password: testUser.password,
        Permanent: true
      }).promise();

      // Authenticate user
      const authResult = await cognito.adminInitiateAuth({
        UserPoolId: process.env.USER_POOL_ID,
        ClientId: process.env.USER_POOL_CLIENT_ID,
        AuthFlow: 'ADMIN_NO_SRP_AUTH',
        AuthParameters: {
          USERNAME: testUser.email,
          PASSWORD: testUser.password
        }
      }).promise();

      authToken = authResult.AuthenticationResult.IdToken;
      testUserId = authResult.AuthenticationResult.AccessToken; // Extract user ID

    } catch (error) {
      console.error('Setup error:', error);
      throw error;
    }
  }, 30000);

  afterAll(async () => {
    // Cleanup test user
    try {
      await cognito.adminDeleteUser({
        UserPoolId: process.env.USER_POOL_ID,
        Username: 'test@example.com'
      }).promise();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('User Management', () => {
    test('should get user profile', async () => {
      const response = await axios.get(`${API_BASE_URL}/user/profile`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      expect(response.status).toBe(200);
      expect(response.data.user).toBeDefined();
      expect(response.data.user.email).toBe('test@example.com');
    });

    test('should update user profile', async () => {
      const updateData = {
        firstName: 'Updated',
        phoneNumber: '+1234567890'
      };

      const response = await axios.put(`${API_BASE_URL}/user/profile`, updateData, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(200);
      expect(response.data.message).toBe('Profile updated successfully');
    });
  });

  describe('Ride Management', () => {
    let rideId;

    test('should request a ride', async () => {
      const rideRequest = {
        pickupLocation: {
          lat: 37.7749,
          lng: -122.4194,
          address: 'San Francisco, CA'
        },
        dropoffLocation: {
          lat: 37.7849,
          lng: -122.4094,
          address: 'San Francisco, CA'
        },
        rideType: 'standard'
      };

      const response = await axios.post(`${API_BASE_URL}/rides`, rideRequest, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(201);
      expect(response.data.ride).toBeDefined();
      expect(response.data.ride.rideId).toBeDefined();
      
      rideId = response.data.ride.rideId;
    });

    test('should get ride history', async () => {
      const response = await axios.get(`${API_BASE_URL}/rides/history`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        params: {
          limit: 10
        }
      });

      expect(response.status).toBe(200);
      expect(response.data.rides).toBeDefined();
      expect(Array.isArray(response.data.rides)).toBe(true);
    });
  });

  describe('Driver Management', () => {
    test('should register as driver', async () => {
      const driverData = {
        licenseNumber: 'DL123456789',
        vehicleInfo: {
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          licensePlate: 'ABC1234',
          color: 'Blue'
        }
      };

      const response = await axios.post(`${API_BASE_URL}/driver/register`, driverData, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(201);
      expect(response.data.message).toBe('Driver registered successfully');
    });

    test('should update driver availability', async () => {
      const availabilityData = {
        status: 'available',
        location: {
          lat: 37.7749,
          lng: -122.4194
        }
      };

      const response = await axios.put(`${API_BASE_URL}/driver/availability`, availabilityData, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      expect(response.status).toBe(200);
      expect(response.data.message).toBe('Availability updated successfully');
    });
  });

  describe('Error Handling', () => {
    test('should return 401 for requests without authorization', async () => {
      try {
        await axios.get(`${API_BASE_URL}/user/profile`);
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    test('should return 400 for invalid request data', async () => {
      try {
        await axios.post(`${API_BASE_URL}/rides`, {
          invalidData: 'test'
        }, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('Validation failed');
      }
    });
  });
});
