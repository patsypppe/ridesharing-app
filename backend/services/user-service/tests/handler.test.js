// backend/services/user-service/tests/handler.test.js
jest.mock('/opt/nodejs/utils', () => {
  const actual = jest.requireActual('/opt/nodejs/utils');
  return {
    ...actual,
    authenticate: jest.fn(),
    dbGet: jest.fn(),
    dbPut: jest.fn(),
    dbUpdate: jest.fn(),
  };
});

const utils = require('/opt/nodejs/utils');
const { register, getProfile, updateProfile, switchUserType } = require('../handler');

const COGNITO_SUB = 'a1b2c3d4-0000-4000-8000-cognito-sub';
const authed = () => ({ ok: true, userId: COGNITO_SUB, claims: { sub: COGNITO_SUB, email: 'newuser@example.com' } });
const unauthed = () => ({ ok: false, response: utils.createResponse(401, { error: 'No authorization header' }) });

const event = (body, headers = { Authorization: 'Bearer token' }) => ({ headers, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERS_TABLE = 'test-users-table';
  utils.authenticate.mockResolvedValue(authed());
  utils.dbGet.mockResolvedValue(undefined);
  utils.dbPut.mockResolvedValue({});
  utils.dbUpdate.mockResolvedValue({});
});

describe('register', () => {
  const validBody = { email: 'newuser@example.com', firstName: 'John', lastName: 'Doe', phoneNumber: '+1234567890' };

  test('stores the profile under the Cognito sub so other services can find it', async () => {
    const result = await register(event(validBody));
    const response = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(response.user.userId).toBe(COGNITO_SUB);
    expect(response.user.email).toBe('newuser@example.com');
    expect(utils.dbPut).toHaveBeenCalledWith(
      expect.objectContaining({ Item: expect.objectContaining({ userId: COGNITO_SUB, userType: 'rider' }) })
    );
  });

  test('checks for an existing profile by Cognito sub, not by email', async () => {
    await register(event(validBody));

    expect(utils.dbGet).toHaveBeenCalledWith({ TableName: 'test-users-table', Key: { userId: COGNITO_SUB } });
  });

  test('returns 409 when the profile already exists', async () => {
    utils.dbGet.mockResolvedValue({ userId: COGNITO_SUB, email: 'newuser@example.com' });

    const result = await register(event(validBody));

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('User already exists');
    expect(utils.dbPut).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid email', async () => {
    const result = await register(event({ ...validBody, email: 'invalid-email' }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Validation failed');
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue(unauthed());

    const result = await register(event(validBody, {}));

    expect(result.statusCode).toBe(401);
    expect(utils.dbGet).not.toHaveBeenCalled();
    expect(utils.dbPut).not.toHaveBeenCalled();
  });
});

describe('getProfile', () => {
  test('returns the profile for the authenticated user', async () => {
    utils.dbGet.mockResolvedValue({ userId: COGNITO_SUB, email: 'newuser@example.com' });

    const result = await getProfile({ headers: { Authorization: 'Bearer token' } });
    const response = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(response.user.userId).toBe(COGNITO_SUB);
    expect(utils.dbGet).toHaveBeenCalledWith({ TableName: 'test-users-table', Key: { userId: COGNITO_SUB } });
  });

  test('returns 404 when no profile exists', async () => {
    const result = await getProfile({ headers: { Authorization: 'Bearer token' } });

    expect(result.statusCode).toBe(404);
  });

  test('returns 401 for a missing authorization header', async () => {
    utils.authenticate.mockResolvedValue(unauthed());

    const result = await getProfile({ headers: {} });

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('No authorization header');
  });
});

describe('updateProfile', () => {
  test('updates only allowed fields for the authenticated user', async () => {
    const result = await updateProfile(event({ firstName: 'Jane', userType: 'admin' }));

    expect(result.statusCode).toBe(200);
    const params = utils.dbUpdate.mock.calls[0][0];
    expect(params.Key).toEqual({ userId: COGNITO_SUB });
    expect(params.ExpressionAttributeValues[':firstName']).toBe('Jane');
    expect(params.ExpressionAttributeValues[':userType']).toBeUndefined();
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue(unauthed());

    const result = await updateProfile(event({ firstName: 'Jane' }, {}));

    expect(result.statusCode).toBe(401);
    expect(utils.dbUpdate).not.toHaveBeenCalled();
  });
});

describe('switchUserType', () => {
  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue(unauthed());

    const result = await switchUserType(event({ userType: 'driver' }, {}));

    expect(result.statusCode).toBe(401);
    expect(utils.dbUpdate).not.toHaveBeenCalled();
  });
});
