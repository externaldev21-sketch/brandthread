import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";

const ORIGINAL_KEY = process.env.META_TOKEN_ENCRYPTION_KEY;

function freshKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

describe("metaCrypto", () => {
  beforeEach(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = freshKey();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("round-trips a plaintext token", async () => {
    const { encryptToken, decryptToken } = await import("../metaCrypto");
    const plaintext = "EAAG_test_long_lived_user_access_token_value";
    const ciphertext = encryptToken(plaintext);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(ciphertext.split(":").length).toBe(4);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const { encryptToken } = await import("../metaCrypto");
    const a = encryptToken("same-value");
    const b = encryptToken("same-value");
    expect(a).not.toBe(b);
  });

  it("reports the key as present via hasMetaTokenEncryptionKey", async () => {
    const { hasMetaTokenEncryptionKey } = await import("../metaCrypto");
    expect(hasMetaTokenEncryptionKey()).toBe(true);
  });

  it("throws clearly when the key is missing", async () => {
    delete process.env.META_TOKEN_ENCRYPTION_KEY;
    const { encryptToken, hasMetaTokenEncryptionKey } = await import("../metaCrypto");
    expect(() => encryptToken("x")).toThrow(/META_TOKEN_ENCRYPTION_KEY is not set/);
    expect(hasMetaTokenEncryptionKey()).toBe(false);
  });

  it("throws clearly when the key is the wrong length", async () => {
    process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    const { encryptToken, hasMetaTokenEncryptionKey } = await import("../metaCrypto");
    expect(() => encryptToken("x")).toThrow(/must decode to exactly 32 bytes/);
    expect(hasMetaTokenEncryptionKey()).toBe(false);
  });

  it("throws when decrypting with the wrong key (auth tag mismatch)", async () => {
    const { encryptToken, decryptToken } = await import("../metaCrypto");
    const ciphertext = encryptToken("secret-token");
    process.env.META_TOKEN_ENCRYPTION_KEY = freshKey();
    expect(() => decryptToken(ciphertext)).toThrow();
  });

  it("throws on an unrecognized ciphertext format", async () => {
    const { decryptToken } = await import("../metaCrypto");
    expect(() => decryptToken("not-a-valid-token")).toThrow(/Unrecognized encrypted token format/);
  });
});
