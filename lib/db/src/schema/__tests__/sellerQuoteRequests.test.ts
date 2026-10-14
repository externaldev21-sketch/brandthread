import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import { sellerQuoteRequests } from '../index';

describe('seller quote request storage compatibility', () => {
  it('keeps the original text primary key so Publish needs no text-to-uuid conversion', () => {
    expect(sellerQuoteRequests.id.getSQLType()).toBe('text');
    expect(sellerQuoteRequests.id.primary).toBe(true);
    expect(sellerQuoteRequests.id.notNull).toBe(true);
  });

  it('still generates UUID strings for new requests', () => {
    const defaultValue = sellerQuoteRequests.id.default;
    expect(defaultValue).toBeInstanceOf(SQL);
    expect(new PgDialect().sqlToQuery(defaultValue as SQL).sql).toBe('gen_random_uuid()::text');
  });
});
