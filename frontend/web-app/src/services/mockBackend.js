// frontend/web-app/src/services/mockBackend.js
//
// An in-browser stand-in for the deployed AWS backend.
//
// It mirrors the real contracts exactly:
//   - the auth surface mirrors the Amplify `Auth` methods authStore.js uses
//   - the API surface mirrors the routes in the service handlers
//   - fares use the same formula as backend/services/ride-service/handler.js
//
// State lives in localStorage so a refresh keeps you signed in, the way a real
// Cognito session would.

const LS_USER = 'rideshare.demo.user';
const LS_RIDES = 'rideshare.demo.rides';
const LS_DRIVER = 'rideshare.demo.driver';

const uuid = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing — demo still works, just not across refreshes */
  }
};

/* ------------------------------------------------------------------ *
 * Geo helpers — same Haversine as the ride-service Lambda
 * ------------------------------------------------------------------ */

export const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Mirrors calculateEstimatedFare() in the ride-service handler.
export const estimateFare = (distanceKm, rideType) => {
  const baseFare = 2.5;
  const perKmRate = { standard: 1.2, premium: 2.0, pool: 0.8 };
  return baseFare + distanceKm * (perKmRate[rideType] || perKmRate.standard);
};

/* ------------------------------------------------------------------ *
 * Auth — mirrors the Amplify Auth methods used by authStore.js
 * ------------------------------------------------------------------ */

export const mockAuth = {
  async currentAuthenticatedUser() {
    await delay(120);
    const user = read(LS_USER, null);
    if (!user) throw new Error('The user is not authenticated');
    return user;
  },

  async signIn(email, password) {
    await delay();
    if (!email || !password) throw new Error('Email and password are required');
    if (password.length < 8) throw new Error('Incorrect username or password.');

    const user = {
      username: email,
      attributes: {
        sub: `demo-${btoa(email).replace(/=/g, '').slice(0, 12)}`,
        email,
        given_name: email.split('@')[0],
      },
    };
    write(LS_USER, user);
    return user;
  },

  async signUp({ username, attributes }) {
    await delay();
    return { user: { username }, userConfirmed: true, userSub: uuid(), attributes };
  },

  async confirmSignUp() {
    await delay();
    return 'SUCCESS';
  },

  async signOut() {
    await delay(120);
    localStorage.removeItem(LS_USER);
  },

  async currentSession() {
    const user = read(LS_USER, null);
    if (!user) throw new Error('No current user');
    return { getIdToken: () => ({ getJwtToken: () => 'demo.jwt.token' }) };
  },
};

/* ------------------------------------------------------------------ *
 * Seeded drivers — scattered around whatever pickup point is used
 * ------------------------------------------------------------------ */

const DRIVER_SEED = [
  { name: 'Marcus W.', rating: 4.9, make: 'Toyota', model: 'Camry', color: 'Silver', plate: '7XKD221' },
  { name: 'Aisha R.', rating: 4.8, make: 'Honda', model: 'Accord', color: 'Black', plate: '5RTP884' },
  { name: 'Diego M.', rating: 5.0, make: 'Tesla', model: 'Model 3', color: 'White', plate: '9QWE117' },
  { name: 'Lena K.', rating: 4.7, make: 'Hyundai', model: 'Sonata', color: 'Blue', plate: '3ZXC005' },
  { name: 'Sam O.', rating: 4.6, make: 'Kia', model: 'Forte', color: 'Grey', plate: '1MNB763' },
];

const scatter = (lat, lng, i) => {
  // Deterministic pseudo-random offsets so drivers don't jump around on rerender.
  const angle = (i * 137.5 * Math.PI) / 180;
  const radius = 0.008 + (i % 3) * 0.006;
  return { lat: lat + Math.sin(angle) * radius, lng: lng + Math.cos(angle) * radius };
};

/* ------------------------------------------------------------------ *
 * API — mirrors the routes wired to the service handlers
 * ------------------------------------------------------------------ */

export const mockApi = {
  async getUserProfile() {
    await delay();
    const user = read(LS_USER, null);
    const email = user?.attributes?.email || 'demo@rideshare.dev';
    return {
      user: {
        userId: user?.attributes?.sub || 'demo-user',
        email,
        firstName: read('rideshare.demo.firstName', email.split('@')[0]),
        lastName: read('rideshare.demo.lastName', 'Demo'),
        phoneNumber: read('rideshare.demo.phone', '+15551234567'),
        userType: read(LS_DRIVER, null) ? 'driver' : 'rider',
        createdAt: '2026-01-15T10:00:00.000Z',
        isActive: true,
      },
    };
  },

  async updateProfile(data) {
    await delay();
    if (data.firstName !== undefined) write('rideshare.demo.firstName', data.firstName);
    if (data.lastName !== undefined) write('rideshare.demo.lastName', data.lastName);
    if (data.phoneNumber !== undefined) write('rideshare.demo.phone', data.phoneNumber);
    return { message: 'Profile updated successfully' };
  },

  async getNearbyDrivers(lat, lng) {
    await delay(260);
    const drivers = DRIVER_SEED.map((d, i) => {
      const loc = scatter(lat, lng, i);
      return {
        driverId: `driver-${i + 1}`,
        name: d.name,
        rating: d.rating,
        status: 'available',
        location: loc,
        distance: haversineKm(lat, lng, loc.lat, loc.lng),
        vehicleInfo: { make: d.make, model: d.model, color: d.color, licensePlate: d.plate },
      };
    }).sort((a, b) => a.distance - b.distance);

    return { drivers };
  },

  async requestRide(rideData) {
    await delay(420);
    const { pickupLocation, dropoffLocation, rideType } = rideData;
    const distance = haversineKm(
      pickupLocation.lat,
      pickupLocation.lng,
      dropoffLocation.lat,
      dropoffLocation.lng
    );

    const ride = {
      rideId: uuid(),
      userId: read(LS_USER, {})?.attributes?.sub || 'demo-user',
      driverId: null,
      status: 'requested',
      rideType,
      pickupLocation,
      dropoffLocation,
      estimatedDistance: distance,
      estimatedFare: estimateFare(distance, rideType),
      actualFare: null,
      createdAt: new Date().toISOString(),
    };

    const rides = read(LS_RIDES, []);
    rides.unshift(ride);
    write(LS_RIDES, rides);

    return { message: 'Ride requested successfully', ride };
  },

  async getRide(rideId) {
    await delay(160);
    const ride = read(LS_RIDES, []).find((r) => r.rideId === rideId);
    if (!ride) throw new Error('Ride not found');
    return { ride };
  },

  async updateRideStatus(rideId, status) {
    await delay(200);
    const rides = read(LS_RIDES, []);
    const idx = rides.findIndex((r) => r.rideId === rideId);
    if (idx === -1) throw new Error('Ride not found');

    rides[idx].status = status;
    rides[idx].updatedAt = new Date().toISOString();

    if (status === 'matched' && !rides[idx].driverId) {
      const d = DRIVER_SEED[0];
      rides[idx].driverId = 'driver-1';
      rides[idx].driver = {
        driverId: 'driver-1',
        name: d.name,
        rating: d.rating,
        vehicleInfo: { make: d.make, model: d.model, color: d.color, licensePlate: d.plate },
      };
      rides[idx].matchedAt = new Date().toISOString();
    }
    if (status === 'in-progress') rides[idx].startedAt = new Date().toISOString();
    if (status === 'completed') {
      rides[idx].completedAt = new Date().toISOString();
      rides[idx].actualFare = rides[idx].estimatedFare;
    }

    write(LS_RIDES, rides);
    return { message: 'Ride status updated successfully', ride: rides[idx] };
  },

  async getRideHistory(limit = 20) {
    await delay();
    return { rides: read(LS_RIDES, []).slice(0, limit), lastEvaluatedKey: null };
  },

  async acceptRide(rideId) {
    return this.updateRideStatus(rideId, 'matched');
  },

  async registerDriver(driverData) {
    await delay();
    const driver = {
      driverId: uuid(),
      ...driverData,
      status: 'offline',
      rating: 5.0,
      totalRides: 0,
      createdAt: new Date().toISOString(),
    };
    write(LS_DRIVER, driver);
    return { message: 'Driver registered successfully', driver };
  },

  async getDriverProfile() {
    await delay(160);
    const driver = read(LS_DRIVER, null);
    if (!driver) {
      const err = new Error('Driver not found');
      err.statusCode = 404;
      throw err;
    }
    return { driver };
  },

  async updateDriverAvailability(status) {
    await delay(200);
    const driver = read(LS_DRIVER, null);
    if (!driver) throw new Error('Driver not registered');
    driver.status = status;
    write(LS_DRIVER, driver);
    return { message: `Availability set to ${status}`, driver };
  },
};

/* ------------------------------------------------------------------ *
 * WebSocket stand-in — replays the message shapes the real
 * websocket-service Lambda pushes via ApiGatewayManagementApi
 * ------------------------------------------------------------------ */

export const createMockSocket = () => {
  const handlers = new Map();
  let timer = null;

  return {
    isConnected: true,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    off(type, fn) {
      const list = handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i > -1) list.splice(i, 1);
    },
    emit(type, payload) {
      (handlers.get(type) || []).forEach((fn) => fn({ type, ...payload }));
    },
    // Walks a driver from `from` to `to`, emitting location_update messages
    // exactly like handleLocationUpdate() does in the real Lambda.
    simulateApproach(from, to, { steps = 40, intervalMs = 900 } = {}) {
      let step = 0;
      clearInterval(timer);
      timer = setInterval(() => {
        step += 1;
        const t = Math.min(step / steps, 1);
        const location = {
          lat: from.lat + (to.lat - from.lat) * t,
          lng: from.lng + (to.lng - from.lng) * t,
        };
        this.emit('location_update', { location, progress: t, timestamp: new Date().toISOString() });
        if (t >= 1) clearInterval(timer);
      }, intervalMs);
    },
    disconnect() {
      clearInterval(timer);
      handlers.clear();
      this.isConnected = false;
    },
  };
};

export const resetDemoData = () => {
  [LS_USER, LS_RIDES, LS_DRIVER, 'rideshare.demo.firstName', 'rideshare.demo.lastName', 'rideshare.demo.phone']
    .forEach((k) => localStorage.removeItem(k));
};
