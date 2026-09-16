export function isValidPayoutIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function cashOutableAmount(providerAvailable: number, reserved: number): number {
  if (!Number.isSafeInteger(providerAvailable) || !Number.isSafeInteger(reserved)) return 0;
  return Math.max(0, providerAvailable - Math.max(0, reserved));
}