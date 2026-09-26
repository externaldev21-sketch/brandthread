import { describe, expect, it, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

describe("shopifyCrypto", () => {
  it("round-trips a secret through encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("../shopifyCrypto");
    const secret = "shpat_" + crypto.randomBytes(16).toString("hex");
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const { encryptSecret } = await import("../shopifyCrypto");
    const a = encryptSecret("same-secret");
    const b = encryptSecret("same-secret");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with a tampered auth tag", async () => {
    const { encryptSecret, decryptSecret } = await import("../shopifyCrypto");
    const encrypted = encryptSecret("tamper-test");
    const [iv, tag, data] = encrypted.split(".");
    const tampered = `${iv}.${tag.slice(0, -2)}AA.${data}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
