import { logger } from "../lib/logger";
import { publishDuePosts } from "../lib/postPublish";
import { scheduleJob } from "./runner";

const INTERVAL_MS = 60 * 1000;

/**
 * Publishes scheduled posts whose time has come. Safe to run on every
 * instance: the claim in publishDuePosts uses FOR UPDATE SKIP LOCKED.
 */
export async function runScheduledPostPublisher(now = new Date()): Promise<number> {
  try {
    const published = await publishDuePosts(now);
    if (published.length > 0) {
      logger.info({ job: "scheduledPostPublisher", published: published.length }, "Scheduled posts published");
    }
    return published.length;
  } catch (err) {
    logger.error({ err, job: "scheduledPostPublisher" }, "Scheduled post publisher failed");
    return 0;
  }
}

export function startScheduledPostPublisherJob(): void {
  scheduleJob("scheduledPostPublisher", () => runScheduledPostPublisher(), { intervalMs: INTERVAL_MS, initialDelayMs: 15_000 });
}
