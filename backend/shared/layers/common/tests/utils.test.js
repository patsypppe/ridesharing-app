// backend/shared/layers/common/tests/utils.test.js
//
// The layer's token check must verify the Cognito RS256 signature. The old
// implementation used jwt.decode(), which accepts any token with a `sub`.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const REGION = 'us-east-1';
const POOL_ID = 'us-east-1_TESTPOOL';
const CLIENT_ID = 'test-client-id';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const KID = 'test-kid';

const poolKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const mockPoolPublicPem = poolKey.publicKey.export({ type: 'spki', format: 'pem' });

// Stand-in for the Cognito JWKS endpoint: only knows the pool's key.
jest.mock('jwks-rsa', () =>
  jest.fn(() => ({
    getSigningKey: (kid, cb) => {
      if (kid !== 'test-kid') return cb(new Error(`Unable to find a signing key that matches '${kid}'`));
      return cb(null, { getPublicKey: () => mockPoolPublicPem });
    },
  }))
);

process.env.AWS_REGION = REGION;
process.env.USER_POOL_ID = POOL_ID;
process.env.USER_POOL_CLIENT_ID = CLIENT_ID;

const utils = require('/opt/nodejs/utils');

const CLAIMS = { sub: 'user-sub-1', email: 'rider@example.com', token_use: 'id' };

const signRs256 = (privateKey, options = {}) =>
  jwt.sign(CLAIMS, privateKey, {
    algorithm: 'RS256',
    keyid: KID,
    issuer: ISSUER,
    audience: CLIENT_ID,
    expiresIn: '1h',
    ...options,
  });

describe('validateToken', () => {
  test('resolves the claims of a token signed by the user pool', async () => {
    const token = signRs256(poolKey.privateKey);

    const claims = await utils.validateToken(token);

    expect(claims.sub).toBe('user-sub-1');
    expect(claims.email).toBe('rider@example.com');
  });

  test('rejects a forged HS256 token (what jwt.decode used to accept)', async () => {
    const forged = jwt.sign({ ...CLAIMS, sub: 'attacker', iss: ISSUER, aud: CLIENT_ID }, 'any-secret', {
      algorithm: 'HS256',
      keyid: KID,
    });

    await expect(utils.validateToken(forged)).rejects.toThrow('Token validation failed');
  });

  test('rejects an unsigned (alg=none) token', async () => {
    const unsigned = jwt.sign({ ...CLAIMS, iss: ISSUER, aud: CLIENT_ID }, '', { algorithm: 'none', keyid: KID });

    await expect(utils.validateToken(unsigned)).rejects.toThrow('Token validation failed');
  });

  test('rejects a token signed by a key the pool does not know', async () => {
    const token = signRs256(strangerKey.privateKey);

    await expect(utils.validateToken(token)).rejects.toThrow('Token validation failed');
  });

  test('rejects a token from a different issuer', async () => {
    const token = signRs256(poolKey.privateKey, { issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER' });

    await expect(utils.validateToken(token)).rejects.toThrow('Token validation failed');
  });

  test('rejects a token issued to a different app client', async () => {
    const token = signRs256(poolKey.privateKey, { audience: 'some-other-client' });

    await expect(utils.validateToken(token)).rejects.toThrow('Token validation failed');
  });

  test('rejects an expired token', async () => {
    const token = signRs256(poolKey.privateKey, { expiresIn: -60 });

    await expect(utils.validateToken(token)).rejects.toThrow('Token validation failed');
  });

  test('fails closed when USER_POOL_CLIENT_ID is not configured', async () => {
    const token = signRs256(poolKey.privateKey);
    const saved = process.env.USER_POOL_CLIENT_ID;
    delete process.env.USER_POOL_CLIENT_ID;
    try {
      await expect(utils.validateToken(token)).rejects.toThrow('Token validation failed');
    } finally {
      process.env.USER_POOL_CLIENT_ID = saved;
    }
  });

  test('accepts an access token whose client_id matches the app client', async () => {
    const token = jwt.sign({ sub: 'user-sub-1', token_use: 'access', client_id: CLIENT_ID }, poolKey.privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      expiresIn: '1h',
    });

    const claims = await utils.validateToken(token);

    expect(claims.sub).toBe('user-sub-1');
  });

  test('rejects a missing token', async () => {
    await expect(utils.validateToken(undefined)).rejects.toThrow('Token validation failed');
    await expect(utils.validateToken('')).rejects.toThrow('Token validation failed');
  });
});

describe('authenticate', () => {
  test('returns the user id for a valid Bearer token', async () => {
    const token = signRs256(poolKey.privateKey);

    const result = await utils.authenticate({ headers: { Authorization: `Bearer ${token}` } });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe('user-sub-1');
    expect(result.claims.email).toBe('rider@example.com');
  });

  test('accepts a lowercase authorization header', async () => {
    const token = signRs256(poolKey.privateKey);

    const result = await utils.authenticate({ headers: { authorization: `Bearer ${token}` } });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe('user-sub-1');
  });

  test('returns a 401 response when the header is missing', async () => {
    const result = await utils.authenticate({ headers: {} });

    expect(result.ok).toBe(false);
    expect(result.response.statusCode).toBe(401);
    expect(JSON.parse(result.response.body).error).toBe('No authorization header');
  });

  test('returns a 401 response when headers are absent entirely', async () => {
    const result = await utils.authenticate({});

    expect(result.ok).toBe(false);
    expect(result.response.statusCode).toBe(401);
  });

  test('returns a 401 response for a forged token', async () => {
    const forged = jwt.sign({ ...CLAIMS, sub: 'attacker', iss: ISSUER, aud: CLIENT_ID }, 'any-secret', {
      algorithm: 'HS256',
      keyid: KID,
    });

    const result = await utils.authenticate({ headers: { Authorization: `Bearer ${forged}` } });

    expect(result.ok).toBe(false);
    expect(result.response.statusCode).toBe(401);
  });

  test('trusts claims already verified by the API Gateway JWT authorizer', async () => {
    const event = {
      headers: {},
      requestContext: { authorizer: { jwt: { claims: { sub: 'gateway-sub', email: 'gw@example.com' } } } },
    };

    const result = await utils.authenticate(event);

    expect(result.ok).toBe(true);
    expect(result.userId).toBe('gateway-sub');
  });
});

describe('exports', () => {
  test('exposes a dbScan helper for table-wide reads', () => {
    expect(typeof utils.dbScan).toBe('function');
  });
});
