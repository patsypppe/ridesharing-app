// backend/services/notification-service/tests/handler.test.js
const mockSendEmail = jest.fn(() => ({ promise: () => Promise.resolve({ MessageId: 'email-1' }) }));
const mockPublish = jest.fn(() => ({ promise: () => Promise.resolve({ MessageId: 'sms-1' }) }));

jest.mock('aws-sdk', () => {
  const actual = jest.requireActual('aws-sdk');
  return { ...actual, SES: jest.fn(() => ({ sendEmail: mockSendEmail })) };
});

jest.mock('/opt/nodejs/utils', () => {
  const actual = jest.requireActual('/opt/nodejs/utils');
  return { ...actual, dbGet: jest.fn(), dbPut: jest.fn(), sns: { publish: mockPublish } };
});

const utils = require('/opt/nodejs/utils');
const { sendNotification } = require('../handler');

const rideRequested = {
  'detail-type': 'Ride Requested',
  detail: { rideId: 'ride-1234-5678', userId: 'u1', pickupLocation: { address: '1 Market St' }, estimatedFare: 12.5 },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NOTIFICATIONS_TABLE = 'notifications';
  utils.dbGet.mockResolvedValue({ userId: 'u1', email: 'rider@example.com', firstName: 'Ria', phoneNumber: '+15551234567' });
  utils.dbPut.mockResolvedValue({});
});

describe('sendNotification', () => {
  test('loads from the layer path and ignores unknown EventBridge detail types', async () => {
    const result = await sendNotification({ 'detail-type': 'Something Else', detail: {} });

    expect(result.statusCode).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('emails and texts the rider when a sender address is configured', async () => {
    process.env.FROM_EMAIL = 'noreply@example.com';

    await sendNotification(rideRequested);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].Source).toBe('noreply@example.com');
    expect(mockSendEmail.mock.calls[0][0].Destination.ToAddresses).toEqual(['rider@example.com']);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(utils.dbPut).toHaveBeenCalledTimes(1);
  });

  test('skips email but still texts and logs when no sender address is configured', async () => {
    delete process.env.FROM_EMAIL;

    await sendNotification(rideRequested);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(utils.dbPut).toHaveBeenCalledTimes(1);
  });
});
