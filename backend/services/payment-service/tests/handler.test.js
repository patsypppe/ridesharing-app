// backend/services/payment-service/tests/handler.test.js
jest.mock(
  'stripe',
  () =>
    jest.fn(() => ({
      paymentIntents: { create: jest.fn() },
      webhooks: { constructEvent: jest.fn((body) => JSON.parse(body)) },
    })),
  { virtual: true }
);

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

process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
process.env.PAYMENTS_TABLE = 'payments';

const utils = require('/opt/nodejs/utils');
const { stripeWebhook, processPayment, getPaymentHistory, calculateFare } = require('../handler');

beforeEach(() => {
  jest.clearAllMocks();
  utils.dbUpdate.mockResolvedValue({});
  utils.publishEvent.mockResolvedValue({});
});

describe('stripeWebhook', () => {
  test('marks the payment completed on payment_intent.succeeded', async () => {
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { amount: 1250, metadata: { paymentId: 'p1', rideId: 'r1', userId: 'u1' } } },
    });

    const result = await stripeWebhook({ headers: { 'stripe-signature': 'sig' }, body });

    expect(result.statusCode).toBe(200);
    expect(utils.dbUpdate).toHaveBeenCalledTimes(1);
    const params = utils.dbUpdate.mock.calls[0][0];
    expect(params.Key).toEqual({ paymentId: 'p1' });
    expect(params.ExpressionAttributeValues[':status']).toBe('completed');
    expect(utils.publishEvent).toHaveBeenCalledWith(
      'Payment Completed',
      expect.objectContaining({ paymentId: 'p1', rideId: 'r1', userId: 'u1', amount: 12.5 })
    );
  });

  test('marks the payment failed on payment_intent.payment_failed', async () => {
    const body = JSON.stringify({
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { paymentId: 'p2', rideId: 'r2', userId: 'u2' }, last_payment_error: { message: 'card_declined' } } },
    });

    const result = await stripeWebhook({ headers: { 'stripe-signature': 'sig' }, body });

    expect(result.statusCode).toBe(200);
    const params = utils.dbUpdate.mock.calls[0][0];
    expect(params.ExpressionAttributeValues[':status']).toBe('failed');
    expect(params.ExpressionAttributeValues[':error']).toBe('card_declined');
  });
});

describe('authenticated endpoints', () => {
  test('processPayment returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue({ ok: false, response: utils.createResponse(401, { error: 'Unauthorized' }) });

    const result = await processPayment({ headers: {}, body: JSON.stringify({ rideId: 'r1', paymentMethodId: 'pm_1' }) });

    expect(result.statusCode).toBe(401);
    expect(utils.dbGet).not.toHaveBeenCalled();
  });

  test('getPaymentHistory queries by the authenticated user', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: 'u1', claims: { sub: 'u1' } });
    utils.dbQuery.mockResolvedValue({ Items: [{ paymentId: 'p1', paymentMethodId: 'pm_123456789' }] });

    const result = await getPaymentHistory({ headers: { Authorization: 'Bearer token' } });
    const response = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(utils.dbQuery.mock.calls[0][0].ExpressionAttributeValues[':userId']).toBe('u1');
    expect(response.payments[0].paymentMethodId).toBe('**** **** **** 6789');
  });
});

describe('calculateFare', () => {
  const ride = { rideId: 'r1', userId: 'u1', driverId: 'd1', rideType: 'standard', estimatedDistance: 4 };
  const fareEvent = () => ({ headers: { Authorization: 'Bearer token' }, pathParameters: { rideId: 'r1' } });

  test('prices the ride for its rider', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: 'u1', claims: { sub: 'u1' } });
    utils.dbGet.mockResolvedValue(ride);

    const result = await calculateFare(fareEvent());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).fareBreakdown.totalAmount).toBeGreaterThan(0);
  });

  test('prices the ride for its assigned driver', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: 'd1', claims: { sub: 'd1' } });
    utils.dbGet.mockResolvedValue(ride);

    const result = await calculateFare(fareEvent());

    expect(result.statusCode).toBe(200);
  });

  test('returns 403 to a user who is neither rider nor driver', async () => {
    utils.authenticate.mockResolvedValue({ ok: true, userId: 'someone-else', claims: { sub: 'someone-else' } });
    utils.dbGet.mockResolvedValue(ride);

    const result = await calculateFare(fareEvent());

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).fareBreakdown).toBeUndefined();
  });

  test('returns 401 without a valid token', async () => {
    utils.authenticate.mockResolvedValue({ ok: false, response: utils.createResponse(401, { error: 'Unauthorized' }) });

    const result = await calculateFare({ headers: {}, pathParameters: { rideId: 'r1' } });

    expect(result.statusCode).toBe(401);
    expect(utils.dbGet).not.toHaveBeenCalled();
  });
});
