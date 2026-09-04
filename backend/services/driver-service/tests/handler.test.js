// backend/services/driver-service/tests/handler.test.js
jest.mock('/opt/nodejs/utils', () => {
  const actual = jest.requireActual('/opt/nodejs/utils');
  return {
    ...actual,
    authenticate: jest.fn(),
    dbGet: jest.fn(),
    dbPut: jest.fn(),
    dbUpdate: jest.fn(),
    dbQuery: jest.fn(),
    publishEvent: jest.fn(),
  };
});

const utils = require('/opt/nodejs/utils');
const { registerDriver, updateAvailability, getDriverProfile, getNearbyDrivers } = require('../handler');

const DRIVER = 'driver-sub-1';
const validBody = {
  licenseNumber: 'D1234567',
  vehicleInfo: { make: 'Toyota', model: 'Prius', year: 2020, licensePlate: '7ABC123', color: 'Blue' },
};
const event = (body) => ({ headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DRIVERS_TABLE = 'drivers';
  process.env.USERS_TABLE = 'users';
  utils.authenticate.mockResolvedValue({ ok: true, userId: DRIVER, claims: { sub: DRIVER } });
  utils.dbGet.mockResolvedValue(undefined);
  utils.dbPut.mockResolvedValue({});
  utils.dbUpdate.mockResolvedValue({});
  utils.publishEvent.mockResolvedValue({});
});

describe('registerDriver', () => {
  test('keys the driver profile by the Cognito sub', async () => {
    const result = await registerDriver(event(validBody));

    expect(result.statusCode).toBe(201);
    expect(utils.dbPut).toHaveBeenCalledWith(
      expect.objectContaining({ Item: expect.objectContaining({ driverId: DRIVER, userId: DRIVER, status: 'offline' }) })
    );
    expect(utils.publishEvent).toHaveBeenCalledWith('Driver Registered', { driverId: DRIVER, userId: DRIVER });
  });

  test('leaves location fields absent on a new driver so the LocationIndex key is never null', async () => {
    await registerDriver(event(validBody));

    const item = utils.dbPut.mock.calls[0][0].Item;
    expect(item).not.toHaveProperty('locationHash');
    expect(item).not.toHaveProperty('location');
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue({ ok: false, response: utils.createResponse(401, { error: 'Unauthorized' }) });

    const result = await registerDriver({ headers: {}, body: JSON.stringify(validBody) });

    expect(result.statusCode).toBe(401);
    expect(utils.dbPut).not.toHaveBeenCalled();
  });
});

describe('updateAvailability', () => {
  test('updates the authenticated driver', async () => {
    const result = await updateAvailability(event({ status: 'available', location: { lat: 37.77, lng: -122.41 } }));

    expect(result.statusCode).toBe(200);
    expect(utils.dbUpdate.mock.calls[0][0].Key).toEqual({ driverId: DRIVER });
  });
});

describe('getDriverProfile', () => {
  test('masks the licence number', async () => {
    utils.dbGet.mockResolvedValue({ driverId: DRIVER, licenseNumber: 'D1234567' });

    const result = await getDriverProfile({ headers: { Authorization: 'Bearer token' } });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).driver.licenseNumber).toBe('***4567');
  });
});

describe('getNearbyDrivers', () => {
  const storedDriver = {
    driverId: DRIVER,
    userId: DRIVER,
    licenseNumber: 'D1234567',
    isVerified: true,
    isActive: true,
    status: 'available',
    rating: 4.8,
    totalRides: 12,
    location: { lat: 37.7749, lng: -122.4194 },
    locationHash: 'abc',
    vehicleInfo: { make: 'Toyota', model: 'Prius', year: 2020, licensePlate: '7ABC123', color: 'Blue' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const nearbyEvent = () => ({
    headers: { Authorization: 'Bearer token' },
    queryStringParameters: { lat: '37.7749', lng: '-122.4194', radius: '5' },
  });

  test('returns only what a rider needs to choose a driver, never licence or identity fields', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [] });
    utils.dbQuery.mockResolvedValueOnce({ Items: [storedDriver] });

    const result = await getNearbyDrivers(nearbyEvent());
    const { drivers } = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(drivers).toHaveLength(1);
    expect(drivers[0]).toEqual({
      driverId: DRIVER,
      rating: 4.8,
      totalRides: 12,
      distance: expect.any(Number),
      location: { lat: 37.7749, lng: -122.4194 },
      vehicleInfo: { make: 'Toyota', model: 'Prius', color: 'Blue' },
    });
  });
});
