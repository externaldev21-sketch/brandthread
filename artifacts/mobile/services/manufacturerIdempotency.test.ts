import { describe, expect, it } from 'vitest';
import { PendingManufacturerOperations } from './manufacturerIdempotency';

describe('PendingManufacturerOperations', () => {
  it('retains IDs for response-loss retries and replaces them after success', () => {
    const pending = new PendingManufacturerOperations();
    const first = pending.get('text', 'thread-1:hello');
    expect(pending.get('text', 'thread-1:hello').clientRequestId).toBe(first.clientRequestId);
    pending.complete('text', 'thread-1:hello');
    expect(pending.get('text', 'thread-1:hello').clientRequestId).not.toBe(first.clientRequestId);
  });

  it('uses independent stable IDs for an order and its card message', () => {
    const pending = new PendingManufacturerOperations();
    const signature = 'thread-1:manufacturer-1:sample_card:payload';
    const order = pending.get('order-card', signature);
    const message = pending.get('message-card', signature);
    expect(order.clientRequestId).not.toBe(message.clientRequestId);
    expect(pending.get('order-card', signature).clientRequestId).toBe(order.clientRequestId);
    expect(pending.get('message-card', signature).clientRequestId).toBe(message.clientRequestId);
  });
});