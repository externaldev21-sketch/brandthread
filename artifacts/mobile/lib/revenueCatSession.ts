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