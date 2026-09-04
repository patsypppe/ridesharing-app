// frontend/web-app/src/services/apiService.js
//
// Thin client over the API Gateway HTTP API. Every method maps to one route
// backed by one Lambda in backend/services.
//
// When DEMO_MODE is on (no Cognito configured), calls are served by the
// in-browser mock instead, so the UI is fully explorable with nothing deployed.

import { API } from 'aws-amplify';
import { DEMO_MODE } from '../config';
import { mockApi } from './mockBackend';

class APIService {
  constructor() {
    this.apiName = 'RideshareAPI';
  }

  async makeRequest(method, path, data = null, params = {}) {
    try {
      const config = { headers: { 'Content-Type': 'application/json' } };
      if (data) config.body = data;
      if (Object.keys(params).length > 0) config.queryStringParameters = params;

      return await API[method](this.apiName, path, config);
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  // ---- User service ----
  async getUserProfile() {
    if (DEMO_MODE) return mockApi.getUserProfile();
    return this.makeRequest('get', '/user/profile');
  }

  async updateProfile(profileData) {
    if (DEMO_MODE) return mockApi.updateProfile(profileData);
    return this.makeRequest('put', '/user/profile', profileData);
  }

  // ---- Ride service ----
  async requestRide(rideData) {
    if (DEMO_MODE) return mockApi.requestRide(rideData);
    return this.makeRequest('post', '/rides', rideData);
  }

  async getRide(rideId) {
    if (DEMO_MODE) return mockApi.getRide(rideId);
    return this.makeRequest('get', `/rides/${rideId}`);
  }

  async getRideHistory(limit = 20, startKey = null) {
    if (DEMO_MODE) return mockApi.getRideHistory(limit);
    const params = { limit };
    if (startKey) params.startKey = startKey;
    return this.makeRequest('get', '/rides/history', null, params);
  }

  async acceptRide(rideId) {
    if (DEMO_MODE) return mockApi.acceptRide(rideId);
    return this.makeRequest('post', `/rides/${rideId}/accept`);
  }

  async updateRideStatus(rideId, status, location = null) {
    if (DEMO_MODE) return mockApi.updateRideStatus(rideId, status);
    return this.makeRequest('put', `/rides/${rideId}/status`, { status, location });
  }

  // ---- Driver service ----
  async registerDriver(driverData) {
    if (DEMO_MODE) return mockApi.registerDriver(driverData);
    return this.makeRequest('post', '/driver/register', driverData);
  }

  async updateDriverAvailability(status, location = null) {
    if (DEMO_MODE) return mockApi.updateDriverAvailability(status);
    return this.makeRequest('put', '/driver/availability', { status, location });
  }

  async getDriverProfile() {
    if (DEMO_MODE) return mockApi.getDriverProfile();
    return this.makeRequest('get', '/driver/profile');
  }

  async getNearbyDrivers(lat, lng, radius = 5) {
    if (DEMO_MODE) return mockApi.getNearbyDrivers(lat, lng, radius);
    return this.makeRequest('get', '/drivers/nearby', null, { lat, lng, radius });
  }
}

const apiService = new APIService();

export default apiService;
