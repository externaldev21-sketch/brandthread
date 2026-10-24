/**
 * Materialize ASC credentials outside the checkout, never in app/public assets.
 * Secrets may arrive with flattened PEM line breaks; validate the DER payload,
 * then export canonical PEM rather than treating formatting as an invalid key.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function normalizePrivateKey(value) {
  const input = String(value || '').trim().replace(/\\r\\n|\\n|\\r/g, '\n');
  const block = input.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (!block) throw new Error('ASC_PRIVATE_KEY must contain a complete PKCS#8 PEM private key.');
  const body = block[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('ASC_PRIVATE_KEY contains invalid PEM payload characters.');
  }
  let key;
  try {
    key = crypto.createPrivateKey({
      key: Buffer.from(body, 'base64'), format: 'der', type: 'pkcs8',
    });
  } catch {
    throw new Error('ASC_PRIVATE_KEY is not a valid PKCS#8 private key.');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('ASC_PRIVATE_KEY must be an ES256 (P-256) Apple API private key.');
  }
  return key.export({ format: 'pem', type: 'pkcs8' }).toString();
}

function prepareAppleApiCredentials(env = process.env) {
  if (!/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID || '')) {
    throw new Error('ASC_KEY_ID must be the 10-character Apple API key ID.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.ASC_ISSUER_ID || '')) {
    throw new Error('ASC_ISSUER_ID must be the Apple API issuer UUID.');
  }
  const pem = normalizePrivateKey(env.ASC_PRIVATE_KEY);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brandthread-asc-'));
  fs.chmodSync(directory, 0o700);
  const keyPath = path.join(directory, 'AuthKey.p8');
  try {
    fs.writeFileSync(keyPath, pem, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    env: {
      ...env,
      EXPO_APPLE_ID: env.APPLE_ID_EMAIL || env.EXPO_APPLE_ID || env.EAS_APPLE_ID,
      EXPO_APPLE_TEAM_ID: env.APPLE_TEAM_ID || env.EXPO_APPLE_TEAM_ID || env.EAS_APPLE_TEAM_ID,
      EXPO_ASC_API_KEY_PATH: keyPath,
      EXPO_ASC_KEY_ID: env.ASC_KEY_ID,
      EXPO_ASC_ISSUER_ID: env.ASC_ISSUER_ID,
    },
    submitValues: {
      ascApiKeyPath: keyPath,
      ascApiKeyId: env.ASC_KEY_ID,
      ascApiKeyIssuerId: env.ASC_ISSUER_ID,
    },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

module.exports = { normalizePrivateKey, prepareAppleApiCredentials };
