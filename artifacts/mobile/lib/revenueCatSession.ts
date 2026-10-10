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
