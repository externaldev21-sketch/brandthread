/**
 * Gift card codes: generated server-side with crypto, shown once, stored only
 * as a SHA-256 hash + the last 4 characters. 16 characters from a 32-symbol
 * alphabet (no 0/O/1/I) is 80 bits of entropy, so a hash of the code alone is
 * not brute-forceable; lookups are also rate limited (routes/gift-cards.ts).
 */
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;

/** A fresh random code, formatted XXXX-XXXX-XXXX-XXXX. */
export function generateGiftCardCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return raw.match(/.{4}/g)!.join("-");
}

/** Uppercases and strips separators/whitespace so "abcd efgh-…" and "ABCDEFGH…" are the same code. */
export function normalizeGiftCardCode(input: string): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when the input could be a code (right length, allowed symbols) — cheap pre-check before hashing. */
export function looksLikeGiftCardCode(input: string): boolean {
  const normalized = normalizeGiftCardCode(input);
  return normalized.length === CODE_LENGTH && [...normalized].every((ch) => ALPHABET.includes(ch));
}

export function hashGiftCardCode(input: string): string {
  return crypto.createHash("sha256").update(normalizeGiftCardCode(input)).digest("hex");
}

export function giftCardLast4(input: string): string {
  return normalizeGiftCardCode(input).slice(-4);
}
