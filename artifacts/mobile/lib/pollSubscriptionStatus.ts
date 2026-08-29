interface PollSubscriptionStatusOptions<T> {
  loadStatus: () => Promise<T>;
  shouldStop: (status: T) => boolean;
  maxAttempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
  onStatus?: (status: T) => void;
}

export async function pollSubscriptionStatus<T>({
  loadStatus,
  shouldStop,
  maxAttempts = 8,
  intervalMs = 1500,
  wait = sleep,
  onStatus,
}: PollSubscriptionStatusOptions<T>): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await wait(intervalMs);
    }

    try {
      const status = await loadStatus();
      onStatus?.(status);
      if (shouldStop(status)) return true;
    } catch {
      // Retry transient status failures until the bounded polling window ends.
    }
  }

  return false;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}