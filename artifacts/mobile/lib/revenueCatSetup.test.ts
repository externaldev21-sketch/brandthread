import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRevenueCatIdentityQueue,
  createRevenueCatSetup,
  switchRevenueCatIdentity,
  type RevenueCatIdentityClient,
} from './revenueCatSession';

/** In-memory stand-in for the store SDK: one process-wide customer, async calls. */
function fakeStore() {
  const log: string[] = [];
  let configured = false;
  let appUserId: string | null = null; // null = anonymous
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));
  const client: RevenueCatIdentityClient & {
    configure(): void;
    purchase(product: string): Promise<string>;
  } = {
    configure() {
      if (configured) return;
      configured = true;
      log.push('configure');
    },
    async isAnonymous() {
      await tick();
      return appUserId === null;
    },
    async logOut() {
      await tick();
      if (appUserId === null) throw new Error('LogOut was called but the current user is anonymous.');
      log.push(`logOut:${appUserId}`);
      appUserId = null;
    },
    async logIn(id: string) {
      await tick();
      log.push(`logIn:${id}`);
      appUserId = id;
    },
    async purchase(product: string) {
      if (!configured) throw new Error('not configured');
      const buyer = appUserId ?? 'anonymous';
      log.push(`purchase:${product}:${buyer}`);
      return buyer;
    },
  };
  return { client, log };
}

function setupFor(store: ReturnType<typeof fakeStore>) {
  return createRevenueCatSetup({
    configure: () => store.client.configure(),
    queue: createRevenueCatIdentityQueue(),
    switchTo: (id) => switchRevenueCatIdentity(store.client, id),
  });
}

describe('RevenueCat deferred setup: purchases wait for the account login', () => {
  it('a purchase before the deferred start-up timer fires starts setup, waits for logIn and runs as the signed-in user', async () => {
    const store = fakeStore();
    const ensure = setupFor(store);

    // The start-up setup is deferred until after first paint: model its timer.
    let deferredFired = false;
    const deferred = new Promise<void>((resolve) => setTimeout(() => {
      deferredFired = true;
      void ensure('user_a').then(resolve);
    }, 50));

    // A Boost purchase tapped right away, before the timer.
    await ensure('user_a');
    expect(deferredFired).toBe(false);
    const buyer = await store.client.purchase('boost_1');

    expect(buyer).toBe('user_a');
    expect(store.log).toEqual(['configure', 'logIn:user_a', 'purchase:boost_1:user_a']);

    // When the deferred setup finally runs it reuses the same setup: no second login.
    await deferred;
    expect(store.log.filter((l) => l.startsWith('logIn'))).toEqual(['logIn:user_a']);
  });

  it('concurrent callers for the same account share one setup', async () => {
    const store = fakeStore();
    const ensure = setupFor(store);
    await Promise.all([ensure('user_a'), ensure('user_a'), ensure('user_a')]);
    expect(store.log).toEqual(['configure', 'logIn:user_a']);
  });

  it('switching accounts logs the previous customer out before the next logs in', async () => {
    const store = fakeStore();
    const ensure = setupFor(store);
    await ensure('user_a');
    await ensure('user_b');
    expect(await store.client.purchase('credits')).toBe('user_b');
    expect(store.log).toEqual(['configure', 'logIn:user_a', 'logOut:user_a', 'logIn:user_b', 'purchase:credits:user_b']);
  });

  it('a failed login is not cached: the purchase fails, and the next attempt retries', async () => {
    const store = fakeStore();
    let failNext = true;
    const ensure = createRevenueCatSetup({
      configure: () => store.client.configure(),
      queue: createRevenueCatIdentityQueue(),
      switchTo: async (id) => {
        if (failNext) {
          failNext = false;
          throw new Error('offline');
        }
        await switchRevenueCatIdentity(store.client, id);
      },
    });
    await expect(ensure('user_a')).rejects.toThrow('offline');
    await ensure('user_a');
    expect(await store.client.purchase('boost_1')).toBe('user_a');
  });
});

describe('RevenueCatProvider wiring', () => {
  const source = readFileSync(resolve(__dirname, 'revenueCat.native.tsx'), 'utf8');

  it.each(['purchase', 'restore', 'purchaseConsumable', 'purchaseCreditPack', 'refresh'])(
    '%s awaits the account setup before touching the store SDK',
    (name) => {
      const start = source.indexOf(`const ${name} = useCallback(`);
      expect(start).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf('}, [', start));
      const ready = body.indexOf('await accountReady()');
      expect(ready).toBeGreaterThan(-1);
      expect(body.indexOf('Purchases!.')).toBeGreaterThan(ready);
    },
  );

  it('the start-up sync uses the same shared setup, after first paint', () => {
    expect(source).toContain('await accountSetup(Purchases!, key!)(clerkId)');
    expect(source).toContain('runAfterFirstPaint(() => { void start(); })');
    expect(source).not.toMatch(/await Purchases!\.logOut\(\)/);
  });
});
