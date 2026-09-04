// backend/services/ride-service/tests/handler.test.js
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
const { requestRide, getRide } = require('../handler');

const RIDER = 'rider-sub-1';
const validBody = {
  pickupLocation: { lat: 37.7749, lng: -122.4194, address: '1 Market St' },
  dropoffLocation: { lat: 37.8044, lng: -122.2712, address: '1 Broadway' },
  rideType: 'standard',
};
const event = (body) => ({ headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RIDES_TABLE = 'rides';
  utils.authenticate.mockResolvedValue({ ok: true, userId: RIDER, claims: { sub: RIDER } });
  utils.dbPut.mockResolvedValue({});
  utils.publishEvent.mockResolvedValue({});
});

describe('requestRide', () => {
  test('rejects a new request while the rider has a matched ride', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [{ rideId: 'r1', status: 'matched' }] });

    const result = await requestRide(event(validBody));

    expect(result.statusCode).toBe(409);
    expect(utils.dbPut).not.toHaveBeenCalled();
  });

  test('looks for open rides using the statuses the service actually writes', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [] });

    await requestRide(event(validBody));

    const params = utils.dbQuery.mock.calls[0][0];
    expect(params.IndexName).toBe('UserRidesIndex');
    expect(params.KeyConditionExpression).toBe('userId = :userId');
    expect(params.ExpressionAttributeValues[':userId']).toBe(RIDER);

    const values = Object.values(params.ExpressionAttributeValues);
    expect(values).not.toContain('active');
    for (const status of ['requested', 'matched', 'en-route', 'arrived', 'in-progress']) {
      expect(values).toContain(status);
    }
    expect(values).not.toContain('completed');
    expect(values).not.toContain('cancelled');
  });

  test('creates the ride when the rider has nothing open', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [] });

    const result = await requestRide(event(validBody));
    const response = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(response.ride.status).toBe('requested');
    expect(utils.dbPut).toHaveBeenCalledWith(
      expect.objectContaining({ Item: expect.objectContaining({ userId: RIDER, status: 'requested' }) })
    );
    expect(utils.publishEvent).toHaveBeenCalledWith('Ride Requested', expect.objectContaining({ userId: RIDER }));
  });

  test('leaves driverId absent on a new ride so the DriverRidesIndex key is never null', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [] });

    await requestRide(event(validBody));

    const item = utils.dbPut.mock.calls[0][0].Item;
    expect(item).not.toHaveProperty('driverId');
  });

  test('leaves driverId absent on a new ride so the DriverRidesIndex key is never null', async () => {
    utils.dbQuery.mockResolvedValue({ Items: [] });

    await requestRide(event(validBody));

    const item = utils.dbPut.mock.calls[0][0].Item;
    expect(item).not.toHaveProperty('driverId');
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue({ ok: false, response: utils.createResponse(401, { error: 'Unauthorized' }) });

    const result = await requestRide({ headers: {}, body: JSON.stringify(validBody) });

    expect(result.statusCode).toBe(401);
    expect(utils.dbQuery).not.toHaveBeenCalled();
  });
});

describe('getRide', () => {
  const RIDE_ID = 'ride-1';
  const DRIVER = 'driver-sub-1';
  const ride = { rideId: RIDE_ID, userId: RIDER, driverId: DRIVER, status: 'matched' };
  const getEvent = () => ({ headers: { Authorization: 'Bearer token' }, pathParameters: { rideId: RIDE_ID } });

  test('returns the ride to the rider who requested it', async () => {
    utils.dbGet.mockResolvedValue(ride);

    const result = await getRide(getEvent());
    const response = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(response.ride).toEqual(ride);
    expect(utils.dbGet).toHaveBeenCalledWith(
      expect.objectContaining({ TableName: 'rides', Key: { rideId: RIDE_ID } })
    );
  });

  test('returns the ride to the assigned driver', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: DRIVER, claims: { sub: DRIVER } });
    utils.dbGet.mockResolvedValue(ride);

    const result = await getRide(getEvent());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ride.rideId).toBe(RIDE_ID);
  });

  test('returns 403 to a user who is neither rider nor driver', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: 'someone-else', claims: { sub: 'someone-else' } });
    utils.dbGet.mockResolvedValue(ride);

    const result = await getRide(getEvent());

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ride).toBeUndefined();
  });

  test('returns 404 when the ride does not exist', async () => {
    utils.dbGet.mockResolvedValue(undefined);

    const result = await getRide(getEvent());

    expect(result.statusCode).toBe(404);
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue({ ok: false, response: utils.createResponse(401, { error: 'Unauthorized' }) });

    const result = await getRide({ headers: {}, pathParameters: { rideId: RIDE_ID } });

    expect(result.statusCode).toBe(401);
    expect(utils.dbGet).not.toHaveBeenCalled();
  });
});
