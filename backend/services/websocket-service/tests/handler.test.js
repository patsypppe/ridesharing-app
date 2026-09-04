// backend/services/websocket-service/tests/handler.test.js
const mockPostToConnection = jest.fn(() => ({ promise: () => Promise.resolve() }));

jest.mock('aws-sdk', () => {
  const actual = jest.requireActual('aws-sdk');
  return {
    ...actual,
    ApiGatewayManagementApi: jest.fn(() => ({ postToConnection: mockPostToConnection })),
  };
});

jest.mock('/opt/nodejs/utils', () => {
  const actual = jest.requireActual('/opt/nodejs/utils');
  return {
    ...actual,
    validateToken: jest.fn(),
    dbGet: jest.fn(),
    dbPut: jest.fn(),
    dbUpdate: jest.fn(),
    dbQuery: jest.fn(),
    dbScan: jest.fn(),
  };
});

process.env.CONNECTIONS_TABLE = 'connections';
process.env.RIDES_TABLE = 'rides';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.example.com/prod';

const utils = require('/opt/nodejs/utils');
const { connect, message, broadcast } = require('../handler');

const REAL_USER = 'real-user-sub';

beforeEach(() => {
  jest.clearAllMocks();
  utils.dbPut.mockResolvedValue({});
  utils.dbUpdate.mockResolvedValue({});
});

describe('connect', () => {
  const ctx = { requestContext: { connectionId: 'conn-1' } };

  test('stores the connection under the identity proven by the token', async () => {
    utils.validateToken.mockResolvedValue({ sub: REAL_USER });

    const result = await connect({ ...ctx, queryStringParameters: { token: 'id-token', userType: 'rider', userId: 'spoofed' } });

    expect(result.statusCode).toBe(200);
    expect(utils.validateToken).toHaveBeenCalledWith('id-token');
    expect(utils.dbPut).toHaveBeenCalledWith(
      expect.objectContaining({ Item: expect.objectContaining({ connectionId: 'conn-1', userId: REAL_USER, userType: 'rider' }) })
    );
  });

  test('rejects the handshake when no token is supplied, even if a userId is', async () => {
    const result = await connect({ ...ctx, queryStringParameters: { userId: 'spoofed', userType: 'rider' } });

    expect(result.statusCode).toBe(401);
    expect(utils.dbPut).not.toHaveBeenCalled();
  });

  test('rejects the handshake when the token does not verify', async () => {
    utils.validateToken.mockRejectedValue(new Error('Token validation failed'));

    const result = await connect({ ...ctx, queryStringParameters: { token: 'forged', userType: 'rider' } });

    expect(result.statusCode).toBe(401);
    expect(utils.dbPut).not.toHaveBeenCalled();
  });

  test('rejects an unknown userType', async () => {
    utils.validateToken.mockResolvedValue({ sub: REAL_USER });

    const result = await connect({ ...ctx, queryStringParameters: { token: 'id-token', userType: 'admin' } });

    expect(result.statusCode).toBe(400);
    expect(utils.dbPut).not.toHaveBeenCalled();
  });
});

describe('message: location_update', () => {
  test('attributes the update to the connection owner, not to the userId in the payload', async () => {
    utils.dbUpdate.mockResolvedValue({ Attributes: { connectionId: 'conn-1', userId: REAL_USER } });
    utils.dbGet.mockResolvedValue({ rideId: 'r1', userId: REAL_USER, driverId: 'driver-1' });
    utils.dbQuery.mockResolvedValue({ Items: [{ connectionId: 'conn-driver' }] });

    const result = await message({
      requestContext: { connectionId: 'conn-1' },
      body: JSON.stringify({ action: 'location_update', data: { userId: 'spoofed', rideId: 'r1', location: { lat: 1, lng: 2 } } }),
    });

    expect(result.statusCode).toBe(200);
    // Only the driver should be notified (the sender is excluded by their real id).
    expect(utils.dbQuery).toHaveBeenCalledTimes(1);
    expect(utils.dbQuery.mock.calls[0][0].ExpressionAttributeValues[':userId']).toBe('driver-1');
    expect(mockPostToConnection).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockPostToConnection.mock.calls[0][0].Data);
    expect(mockPostToConnection.mock.calls[0][0].ConnectionId).toBe('conn-driver');
    expect(sent.userId).toBe(REAL_USER);
  });
});

describe('message: relay is limited to ride participants', () => {
  const ride = { rideId: 'r1', userId: REAL_USER, driverId: 'driver-1' };
  const statusEvent = (connectionId) => ({
    requestContext: { connectionId },
    body: JSON.stringify({ action: 'ride_status_update', data: { rideId: 'r1', status: 'arrived' } }),
  });
  const locationEvent = (connectionId) => ({
    requestContext: { connectionId },
    body: JSON.stringify({ action: 'location_update', data: { rideId: 'r1', location: { lat: 1, lng: 2 } } }),
  });

  test('relays a status update from the assigned driver to both parties', async () => {
    utils.dbUpdate.mockResolvedValue({ Attributes: { connectionId: 'conn-d', userId: 'driver-1' } });
    utils.dbGet.mockResolvedValue(ride);
    utils.dbQuery.mockResolvedValue({ Items: [{ connectionId: 'conn-x' }] });

    const result = await message(statusEvent('conn-d'));

    expect(result.statusCode).toBe(200);
    expect(utils.dbQuery).toHaveBeenCalledTimes(2);
    expect(mockPostToConnection).toHaveBeenCalledTimes(2);
  });

  test('ignores a status update from a connection that is not on the ride', async () => {
    utils.dbUpdate.mockResolvedValue({ Attributes: { connectionId: 'conn-9', userId: 'intruder' } });
    utils.dbGet.mockResolvedValue(ride);
    utils.dbQuery.mockResolvedValue({ Items: [{ connectionId: 'conn-x' }] });

    const result = await message(statusEvent('conn-9'));

    expect(result.statusCode).toBe(200);
    expect(utils.dbQuery).not.toHaveBeenCalled();
    expect(mockPostToConnection).not.toHaveBeenCalled();
  });

  test('ignores a location update from a connection that is not on the ride', async () => {
    utils.dbUpdate.mockResolvedValue({ Attributes: { connectionId: 'conn-9', userId: 'intruder' } });
    utils.dbGet.mockResolvedValue(ride);
    utils.dbQuery.mockResolvedValue({ Items: [{ connectionId: 'conn-driver' }] });

    await message(locationEvent('conn-9'));

    expect(utils.dbQuery).not.toHaveBeenCalled();
    expect(mockPostToConnection).not.toHaveBeenCalled();
  });
});

describe('broadcast', () => {
  test('reads all live connections with a scan (a query needs a key condition)', async () => {
    utils.dbScan.mockResolvedValue({ Items: [{ connectionId: 'c1', userId: 'u1' }, { connectionId: 'c2', userId: 'u2' }] });

    const result = await broadcast({ body: JSON.stringify({ message: { type: 'notice' }, excludeUserId: 'u2' }) });

    expect(result.statusCode).toBe(200);
    expect(utils.dbScan).toHaveBeenCalledTimes(1);
    expect(utils.dbQuery).not.toHaveBeenCalled();
    expect(utils.dbScan.mock.calls[0][0].TableName).toBe('connections');
    expect(mockPostToConnection).toHaveBeenCalledTimes(1);
    expect(mockPostToConnection.mock.calls[0][0].ConnectionId).toBe('c1');
  });

  test('filters by userType when one is given', async () => {
    utils.dbScan.mockResolvedValue({ Items: [] });

    await broadcast({ body: JSON.stringify({ message: { type: 'notice' }, userType: 'driver' }) });

    const params = utils.dbScan.mock.calls[0][0];
    expect(params.FilterExpression).toContain('userType = :userType');
    expect(params.ExpressionAttributeValues[':userType']).toBe('driver');
  });
});
