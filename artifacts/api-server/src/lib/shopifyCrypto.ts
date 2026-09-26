/**
 * AES-256-GCM at-rest encryption for the Shopify Admin API access token.
 * Unlike Stripe (where only a non-secret account id is stored — Stripe holds
 * the actual secret) a Shopify access token IS the bearer credential for the
 * seller's store, so it is encrypted before it ever reaches the database.
 *
 * SHOPIFY_TOKEN_ENCRYPTION_KEY must be a 32-byte key, base64-encoded.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function loadKey(): Buffer {
  const raw = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY is not configured");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** Returns "<iv-base64>.<authTag-base64>.<ciphertext-base64>". */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(encoded: string): string {
  const key = loadKey();
  const [ivB64, tagB64, dataB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
