/** Serializes SDK identity transitions and rejects stale async completions. */
export function createRevenueCatSessionGuard() {
  let generation = 0;
  return {
    begin: () => ++generation,
    current: () => generation,
    isCurrent: (candidate: number) => candidate === generation,
  };
}

export async function runRevenueCatSessionOperation<T>(
  guard: ReturnType<typeof createRevenueCatSessionGuard>,
  operation: () => Promise<T>,
  onCurrent: (result: T, generation: number) => Promise<void>,
): Promise<T> {
  const generation = guard.current();
  const result = await operation();
  if (!guard.isCurrent(generation)) throw new Error('Your account changed. Please try again.');
  await onCurrent(result, generation);
  if (!guard.isCurrent(generation)) throw new Error('Your account changed. Please try again.');
  return result;
}

export interface RevenueCatIdentityClient {
  isAnonymous(): Promise<boolean>;
  logOut(): Promise<unknown>;
  logIn(appUserId: string): Promise<unknown>;
}

/**
 * Puts the SDK on `appUserId` (or on an anonymous customer when signed out).
 * Logs out first so account B never inherits account A's customer info. The
 * SDK rejects logOut() while its customer is already anonymous (e.g. the
 * first launch after install); that must not skip the logIn().
 */
export async function switchRevenueCatIdentity(client: RevenueCatIdentityClient, appUserId?: string): Promise<void> {
  if (!(await client.isAnonymous())) await client.logOut();
  if (appUserId) await client.logIn(appUserId);
}

/**
 * The one shared setup promise per account: configure the SDK, then switch it
 * to that account (serialized through the identity queue). The deferred
 * start-up setup and every path that can spend money or read entitlements
 * await the same promise, so a purchase made before the deferred setup has
 * run starts it and waits for the account login instead of running under the
 * anonymous customer. A failed setup is forgotten so the next call retries.
 */
export function createRevenueCatSetup(deps: {
  configure: () => void;
  queue: (task: () => Promise<void>) => Promise<void>;
  switchTo: (appUserId?: string) => Promise<void>;
}) {
  let current: { appUserId: string | undefined; promise: Promise<void> } | null = null;
  return (appUserId?: string): Promise<void> => {
    if (current && current.appUserId === appUserId) return current.promise;
    try {
      deps.configure();
    } catch (error) {
      return Promise.reject(error);
    }
    const entry = { appUserId, promise: deps.queue(() => deps.switchTo(appUserId)) };
    current = entry;
    entry.promise.catch(() => {
      if (current === entry) current = null;
    });
    return entry.promise;
  };
}

export function createRevenueCatIdentityQueue() {
  let queue: Promise<void> = Promise.resolve();
  return (task: () => Promise<void>): Promise<void> => {
    const next = queue.catch(() => {}).then(task);
    queue = next.catch(() => {});
    return next;
  };
}
/** The subset of the Purchases SDK the identity switch needs (keeps it testable). */
export type RevenueCatIdentityClient = {
  isAnonymous: () => Promise<boolean>;
  getAppUserID: () => Promise<string>;
  logIn: (appUserID: string) => Promise<unknown>;
  logOut: () => Promise<unknown>;
};

/**
 * Moves the SDK to `clerkId` (or to an anonymous customer when signed out).
 * logOut() throws LOGOUT_CALLED_WITH_ANONYMOUS_USER on an anonymous customer,
 * which is the state right after configure() on a fresh install, so it only
 * runs when an identified customer is active and differs from the target.
 */
export async function switchRevenueCatIdentity(
  sdk: RevenueCatIdentityClient,
  clerkId: string | undefined,
): Promise<void> {
  const anonymous = await sdk.isAnonymous();
  if (!anonymous) {
    const current = await sdk.getAppUserID();
    if (clerkId && current === clerkId) return;
    await sdk.logOut();
  }
  if (clerkId) await sdk.logIn(clerkId);
}
