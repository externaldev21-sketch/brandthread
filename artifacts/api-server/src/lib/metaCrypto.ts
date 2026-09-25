/**
 * AES-256-GCM encryption for Meta (Facebook/Instagram) long-lived user access
 * tokens at rest, keyed by META_TOKEN_ENCRYPTION_KEY (a base64-encoded 32-byte
 * key). Nothing else in the codebase encrypts/decrypts this column — every
 * read/write of metaAdAccounts.accessTokenEncrypted goes through these two
 * functions.
 *
 * Stored format: "v1:" + base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 * The "v1:" prefix lets us change the scheme later without a silent break.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV is the recommended/standard size for GCM
const KEY_BYTES = 32; // AES-256
const FORMAT_PREFIX = "v1";

function loadKey(): Buffer {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY is not set. Set a base64-encoded 32-byte key to encrypt/decrypt Meta tokens.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("META_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `META_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

/** True when META_TOKEN_ENCRYPTION_KEY is set and well-formed — used by routes to 503 cleanly instead of throwing. */
export function hasMetaTokenEncryptionKey(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptToken(ciphertext: string): string {
  const key = loadKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error("Unrecognized encrypted token format.");
  }
  const [, ivB64, authTagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
