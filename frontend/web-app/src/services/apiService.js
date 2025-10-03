// frontend/web-app/src/services/apiService.js
import { API } from 'aws-amplify';

class APIService {
  constructor() {
    this.apiName = 'RideshareAPI';
  }

  async makeRequest(method, path, data = null, params = {}) {
    try {
      const config = {
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.body = data;
      }

      if (Object.keys(params).length > 0) {
        config.queryStringParameters = params;
      }

      const response = await API[method](this.apiName, path, config);
      return response;
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  // User Service Methods
  async getUserProfile() {
    return this.makeRequest('get', '/user/profile');
  }

  async updateProfile(profileData) {
    return this.makeRequest('put', '/user/profile', profileData);
  }

  // Ride Service Methods
  async requestRide(rideData) {
    return this.makeRequest('post', '/rides', rideData);
  }

  async getRideHistory(limit = 20, startKey = null) {
    const params = { limit };
    if (startKey) params.startKey = startKey;
    return this.makeRequest('get', '/rides/history', null, params);
  }

  async acceptRide(rideId) {
    return this.makeRequest('post', `/rides/${rideId}/accept`);
  }

  async updateRideStatus(rideId, status, location = null) {
    return this.makeRequest('put', `/rides/${rideId}/status`, { status, location });
  }

  // Driver Service Methods
  async registerDriver(driverData) {
    return this.makeRequest('post', '/driver/register', driverData);
  }

  async updateDriverAvailability(status, location = null) {
    return this.makeRequest('put', '/driver/availability', { status, location });
  }

  async getDriverProfile() {
    return this.makeRequest('get', '/driver/profile');
  }

  async getNearbyDrivers(lat, lng, radius = 5) {
    return this.makeRequest('get', '/drivers/nearby', null, { lat, lng, radius });
  }
}

export default new APIService();
