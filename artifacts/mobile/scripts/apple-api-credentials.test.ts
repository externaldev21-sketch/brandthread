import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
const { normalizePrivateKey, prepareAppleApiCredentials } = require('./apple-api-credentials');
const { resolveIosSubmitValues } = require('./verify-submit-config');
const { submitWithValues } = require('./eas-submit');

function testEnvironment() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    ASC_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ASC_KEY_ID: 'ABCDEFGHIJ',
    ASC_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
    APPLE_TEAM_ID: '0123456789',
    APPLE_ID_EMAIL: 'release@example.invalid',
    ASC_APP_ID: '1234567890',
  };
}

describe('secure Apple API credential wiring', () => {
  it('normalizes flattened and escaped PEM without changing the actual key', () => {
    const env = testEnvironment();
    const canonical = normalizePrivateKey(env.ASC_PRIVATE_KEY);
    expect(normalizePrivateKey(env.ASC_PRIVATE_KEY.replace(/\n/g, ''))).toBe(canonical);
    expect(normalizePrivateKey(env.ASC_PRIVATE_KEY.replace(/\n/g, '\\n'))).toBe(canonical);
  });

  it('rejects damaged payloads and unsupported keys without echoing them', () => {
    expect(() => normalizePrivateKey('-----BEGIN PRIVATE KEY-----invalid!-----END PRIVATE KEY-----'))
      .toThrow('ASC_PRIVATE_KEY contains invalid PEM payload characters.');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    expect(() => normalizePrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' })))
      .toThrow('ASC_PRIVATE_KEY must be an ES256 (P-256) Apple API private key.');
  });

  it('accepts the secure prompt names without requiring duplicate secret aliases', () => {
    const result = resolveIosSubmitValues({}, testEnvironment());
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({
      appleId: 'release@example.invalid', appleTeamId: '0123456789', ascAppId: '1234567890',
    });
  });

  it('creates a private file outside the checkout and removes it on cleanup', () => {
    const credentials = prepareAppleApiCredentials(testEnvironment());
    const keyPath = credentials.env.EXPO_ASC_API_KEY_PATH;
    try {
      expect(keyPath.startsWith(process.cwd())).toBe(false);
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      expect(normalizePrivateKey(readFileSync(keyPath, 'utf8'))).toBeTruthy();
      expect(credentials.env.EXPO_ASC_KEY_ID).toBe('ABCDEFGHIJ');
      expect(credentials.env.EXPO_APPLE_TEAM_ID).toBe('0123456789');
    } finally {
      credentials.cleanup();
    }
    expect(existsSync(keyPath)).toBe(false);
  });

  it('fills the six iOS submission fields only during EAS, then restores and cleans up', () => {
    const easPath = new URL('../eas.json', import.meta.url);
    const original = readFileSync(easPath, 'utf8');
    const env = testEnvironment();
    const { values } = resolveIosSubmitValues({}, env);
    let keyPath = '';
    const result = submitWithValues(values, [], env, (command: string, args: string[], options: any) => {
      expect(command).toBe('eas');
      expect(args).toContain('--non-interactive');
      const ios = JSON.parse(readFileSync(easPath, 'utf8')).submit.production.ios;
      expect(ios).toMatchObject({
        ...values, ascApiKeyId: env.ASC_KEY_ID, ascApiKeyIssuerId: env.ASC_ISSUER_ID,
      });
      keyPath = ios.ascApiKeyPath;
      expect(options.env.EXPO_ASC_API_KEY_PATH).toBe(keyPath);
      expect(existsSync(keyPath)).toBe(true);
      return 1;
    });
    expect(result).toBe(1);
    expect(readFileSync(easPath, 'utf8')).toBe(original);
    expect(existsSync(keyPath)).toBe(false);
  });
});
