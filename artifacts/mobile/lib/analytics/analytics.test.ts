import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalyticsClient } from './client';
import { ANALYTICS_EVENTS, resolveHost, resolveKey, sanitizeProperties } from './events';
import { analyticsAllowed } from './gate';

afterEach(() => vi.useRealTimers());

const newClient = (fetchImpl: any, extra: object = {}) =>
  createAnalyticsClient({ key: 'phc_test_123', fetchImpl, ...extra });

describe('sanitizeProperties', () => {
  it('drops keys that are not allow-listed', () => {
    const out = sanitizeProperties('follow', { surface: 'profile', email: 'a@b.co', name: 'Jane', phone: '555' });
    expect(out).toEqual({ surface: 'profile' });
  });
  it('drops free text, emails, spaces and objects even under allowed keys', () => {
    expect(sanitizeProperties('product_viewed', { surface: 'hello there friend' })).toEqual({});
    expect(sanitizeProperties('product_viewed', { surface: 'jane@example.com' })).toEqual({});
    expect(sanitizeProperties('product_viewed', { surface: { a: 1 } })).toEqual({});
    expect(sanitizeProperties('product_viewed', { surface: 'x'.repeat(200) })).toEqual({});
  });
  it('never carries message text or search text, for any event', () => {
    const banned = ['text', 'message', 'body', 'query', 'search', 'email', 'name', 'phone', 'address', 'caption'];
    for (const keys of Object.values(ANALYTICS_EVENTS)) {
      for (const key of keys as readonly string[]) expect(banned).not.toContain(key);
    }
  });
  it('rejects unknown events and prototype keys', () => {
    expect(sanitizeProperties('not_an_event', {})).toBeNull();
    expect(sanitizeProperties('toString', {})).toBeNull();
  });
});

describe('config resolution', () => {
  it('treats missing and placeholder keys as off', () => {
    expect(resolveKey(undefined)).toBeNull();
    expect(resolveKey('  ')).toBeNull();
    expect(resolveKey('replace_me')).toBeNull();
    expect(resolveKey('phc_real')).toBe('phc_real');
  });
  it('defaults the host and ignores bad values', () => {
    expect(resolveHost(undefined)).toBe('https://us.i.posthog.com');
    expect(resolveHost('javascript:alert(1)')).toBe('https://us.i.posthog.com');
    expect(resolveHost('https://eu.i.posthog.com/')).toBe('https://eu.i.posthog.com');
  });
});

describe('analyticsAllowed', () => {
  const base = { platform: 'web', webAnalyticsConsent: false, previewSession: false, devBypass: false };
  it('web needs the analytics category', () => {
    expect(analyticsAllowed(base).consent).toBe(false);
    expect(analyticsAllowed({ ...base, webAnalyticsConsent: true }).consent).toBe(true);
  });
  it('native has no banner, so it is allowed (events stay anonymous/opaque)', () => {
    expect(analyticsAllowed({ ...base, platform: 'ios' }).consent).toBe(true);
    expect(analyticsAllowed({ ...base, platform: 'android' }).consent).toBe(true);
  });
  it('preview and dev-bypass sessions are suppressed', () => {
    expect(analyticsAllowed({ ...base, previewSession: true }).suppressed).toBe(true);
    expect(analyticsAllowed({ ...base, devBypass: true }).suppressed).toBe(true);
    expect(analyticsAllowed(base).suppressed).toBe(false);
  });
});

describe('client with no key', () => {
  it('is a total no-op: nothing thrown, no network, no timers', async () => {
    const fetchImpl = vi.fn();
    vi.useFakeTimers();
    const c = createAnalyticsClient({ fetchImpl });
    expect(c.enabled).toBe(false);
    c.setConsent(true);
    c.identify('user_1');
    c.track('app_opened', { platform: 'ios' });
    await c.flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('client gating', () => {
  it('sends nothing before consent, and drops (does not replay) earlier events', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl);
    c.track('app_opened', { platform: 'web' });
    c.setConsent(true);
    await c.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('stops and clears the queue when consent is withdrawn', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl);
    c.setConsent(true);
    c.track('app_opened', { platform: 'web' });
    c.setConsent(false);
    await c.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('sends nothing for a suppressed (preview) session even with consent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl);
    c.setConsent(true);
    c.setSuppressed(true);
    c.track('follow', { surface: 'profile' });
    await c.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('client batching', () => {
  it('posts one batch with the opaque id and scrubbed properties', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl, { host: 'https://eu.i.posthog.com', platform: 'ios' });
    c.setConsent(true);
    c.identify('user_2abc');
    c.track('message_sent', { surface: 'dm', has_attachment: true, text: 'hi there' } as any);
    c.track('follow', { surface: 'profile' });
    await c.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    const body = JSON.parse(init.body);
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].distinct_id).toBe('user_2abc');
    expect(body.batch[0].properties.text).toBeUndefined();
    expect(body.batch[0].properties.has_attachment).toBe(true);
    expect(body.batch[0].properties.$geoip_disable).toBe(true);
  });
  it('uses an anonymous id without profile when signed out', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl);
    c.setConsent(true);
    c.identify('jane@example.com'); // not an opaque token: ignored
    c.track('app_opened', { platform: 'ios' });
    await c.flush();
    const evt = JSON.parse(fetchImpl.mock.calls[0][1].body).batch[0];
    expect(evt.distinct_id.startsWith('anon_')).toBe(true);
    expect(evt.properties.$process_person_profile).toBe(false);
  });
  it('flushes automatically at the batch size and on a timer', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const c = newClient(fetchImpl, { batchSize: 2, flushIntervalMs: 1000 });
    c.setConsent(true);
    c.track('app_opened', { platform: 'ios' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.track('app_opened', { platform: 'ios' });
    c.track('app_opened', { platform: 'ios' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('swallows a failing or throwing fetch', async () => {
    const c = newClient(vi.fn().mockRejectedValue(new Error('offline')));
    c.setConsent(true);
    c.track('app_opened', { platform: 'ios' });
    await expect(c.flush()).resolves.toBeUndefined();
    const d = newClient((() => { throw new Error('boom'); }) as any);
    d.setConsent(true);
    d.track('app_opened', { platform: 'ios' });
    await expect(d.flush()).resolves.toBeUndefined();
  });
  it('ignores unknown events', async () => {
    const fetchImpl = vi.fn();
    const c = newClient(fetchImpl);
    c.setConsent(true);
    c.track('secret_event' as any, {});
    await c.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
