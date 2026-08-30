export type PendingOperation = {
  clientRequestId: string;
  metadata?: Record<string, string>;
};

/**
 * Keeps idempotency keys stable while a user retries the same payload. A changed
 * payload has a different signature and intentionally receives a new key.
 */
export class PendingManufacturerOperations {
  private pending = new Map<string, PendingOperation>();

  get(kind: string, signature: string): PendingOperation {
    const key = `${kind}:${signature}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = {
      clientRequestId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    this.pending.set(key, operation);
    return operation;
  }

  complete(kind: string, signature: string): void {
    this.pending.delete(`${kind}:${signature}`);
  }
}