import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, launchWaitlistSignups, pool } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { resetRateLimitStateForTests } from '../../middlewares/rateLimit';

vi.mock('@clerk/express', () => ({ getAuth: () => ({ userId: null }) }));
import router from '../launch-waitlist';

const prefix = `launch-test-${crypto.randomBytes(5).toString('hex')}`;
let server: Server;
let base = '';
let ipSequence = 1;
function email(name: string) { return `${prefix}-${name}@example.com`; }
async function submit(body: unknown, ip = `10.91.${Math.floor(ipSequence / 250)}.${ipSequence++ % 250}`) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
}
beforeAll(async () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2kb' }));
  app.use('/api/launch-waitlist', router);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/launch-waitlist`;
});
beforeEach(() => resetRateLimitStateForTests());
afterAll(async () => {
  await pool.query('DELETE FROM launch_waitlist_signups WHERE email LIKE $1', [`${prefix}%`]);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('public launch waitlist', () => {
  it('stores only normalized email, signup time and source without authentication', async () => {
    const address = email('first');
    expect(await submit({ email: `  ${address.toUpperCase()}  `, source: 'instagram' })).toMatchObject({
      status: 200, body: { ok: true, message: "You're on the list." },
    });
    const [row] = await db.select().from(launchWaitlistSignups).where(eq(launchWaitlistSignups.email, address));
    expect(row.email).toBe(address);
    expect(row.source).toBe('instagram');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'email', 'source']);
  });

  it('accepts case-insensitive duplicates silently without replacing original signup data', async () => {
    const address = email('duplicate');
    const first = await submit({ email: address, source: 'instagram' });
    const again = await submit({ email: address.toUpperCase(), source: 'landing' });
    expect(again).toEqual(first);
    const rows = await db.select().from(launchWaitlistSignups).where(eq(launchWaitlistSignups.email, address));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('instagram');
  });

  it('deduplicates simultaneous submissions at the database boundary', async () => {
    const address = email('concurrent');
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => submit({ email: i % 2 ? address.toUpperCase() : address })));
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(await db.select().from(launchWaitlistSignups).where(eq(launchWaitlistSignups.email, address))).toHaveLength(1);
  });

  it('defaults source to landing', async () => {
    const address = email('default');
    expect((await submit({ email: address })).status).toBe(200);
    const [row] = await db.select().from(launchWaitlistSignups).where(eq(launchWaitlistSignups.email, address));
    expect(row.source).toBe('landing');
  });

  it.each([{}, { email: 'invalid' }, { email: '' }, { email: 123 }, { email: 'a'.repeat(260) + '@example.com' }, { email: 'valid@example.com', source: 'anything' }, { email: 'valid@example.com', name: 'Not collected' }])('rejects invalid or extra personal data: %j', async body => {
    expect((await submit(body)).status).toBe(400);
  });

  it('limits public signup attempts to five per IP per hour', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push(await submit({ email: email(`rate-${i}`) }, '10.92.1.1'));
    expect(statuses.map(result => result.status)).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(statuses[5].retryAfter)).toBeGreaterThan(0);
  });

  it('does not expose the list publicly', async () => {
    expect((await fetch(base)).status).toBe(404);
  });

  it('reports storage failure rather than claiming a signup succeeded', async () => {
    const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    try {
      expect(await submit({ email: email('failure') })).toMatchObject({ status: 503, body: { code: 'WAITLIST_UNAVAILABLE' } });
    } finally { insert.mockRestore(); }
  });
});
