/**
 * Background job runner.
 *
 * Every job below used to start inside each web-server process. With two
 * copies of the server (autoscale, or a deploy overlap) each job ran twice:
 * duplicate refunds checks, payout releases, broadcasts and reminders. And on
 * autoscale the jobs only ran while a request kept an instance awake.
 *
 * Now:
 *  - Singleton jobs only run in the one process that holds a Postgres
 *    advisory lock (leader election). Other copies stay followers and retry,
 *    so if the leader dies the next copy takes over within LEADER_RETRY_MS.
 *  - BACKGROUND_JOBS=off stops a web process from competing for the lock.
 *    Pair it with the always-on worker entry (src/worker.ts, `pnpm start:worker`)
 *    so jobs keep running when no one is using the app.
 *  - Per-instance jobs (live viewer counts broadcast over this process's
 *    WebSockets, community push that skips users connected to this process)
 *    keep running in every web process; they already claim work atomically.
 */
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { startAbandonedCartJob } from "./abandonedCartRecovery";
import { startTrendingJob } from "./computeTrending";
import { startSellerRankingJob } from "./computeSellerRanking";
import { startTeamInviteReminderJob } from "./teamInviteReminder";
import { startScheduledDropBroadcastJob } from "./scheduledDropBroadcasts";
import { startProductLaunchJob } from "./productLaunches";
import { startSellerTrialReminderJob } from "./sellerTrialReminder";
import { startDisputeEvidenceReminderJob } from "./disputeEvidenceReminder";
import { startDesignStudioObjectCleanupJob } from "./designStudioObjectCleanup";
import { startMoneySweepJob } from "./moneySweep";
import { startAffiliatePayoutsJob } from "./affiliatePayouts";
import { startDeliveryDeadlinesJob } from "./deliveryDeadlines";
import { startStoryCleanupJob } from "./storyCleanup";
import { startAnalyticsRetentionJob } from "./analyticsRetention";
import { startAccountPurgeJob } from "./accountPurge";
import { startDataExportJob } from "./dataExportJob";
import { startPushReceiptCleanupJob } from "./pushReceiptCleanup";
import { startNotificationBatchFlushJob } from "./notificationBatchFlush";
import { startLiveRecordingFinalizeJob } from "./liveRecordingFinalize";
import { startLiveViewersPresenceJob } from "./liveViewersPresence";
import { startThreadCashExpiryJob } from "./threadCashExpiry";
import { startScheduledLiveReminderJob } from "./scheduledLiveReminders";
import { startEmailCampaignJob } from "./emailCampaigns";
import { startScheduledPostPublisherJob } from "./scheduledPostPublisher";
import { startCommunityPushJob } from "../lib/communityPush";

/** Jobs that must run in exactly one process across the whole deployment. */
export const SINGLETON_JOBS: ReadonlyArray<readonly [string, () => void]> = [
  ["abandonedCart", startAbandonedCartJob],
  ["trending", startTrendingJob],
  ["sellerRanking", startSellerRankingJob],
  ["teamInviteReminder", startTeamInviteReminderJob],
  ["scheduledDropBroadcast", startScheduledDropBroadcastJob],
  ["productLaunch", startProductLaunchJob],
  ["sellerTrialReminder", startSellerTrialReminderJob],
  ["disputeEvidenceReminder", startDisputeEvidenceReminderJob],
  ["designStudioObjectCleanup", startDesignStudioObjectCleanupJob],
  ["moneySweep", startMoneySweepJob],
  ["affiliatePayouts", startAffiliatePayoutsJob],
  ["deliveryDeadlines", startDeliveryDeadlinesJob],
  ["storyCleanup", startStoryCleanupJob],
  ["analyticsRetention", startAnalyticsRetentionJob],
  ["accountPurge", startAccountPurgeJob],
  ["dataExport", startDataExportJob],
  ["pushReceiptCleanup", startPushReceiptCleanupJob],
  ["notificationBatchFlush", startNotificationBatchFlushJob],
  ["liveRecordingFinalize", startLiveRecordingFinalizeJob],
  ["threadCashExpiry", startThreadCashExpiryJob],
  ["scheduledLiveReminder", startScheduledLiveReminderJob],
  ["emailCampaign", startEmailCampaignJob],
  ["scheduledPostPublisher", startScheduledPostPublisherJob],
];

/** Jobs tied to this process's own WebSocket connections: run in every web process. */
export const PER_INSTANCE_JOBS: ReadonlyArray<readonly [string, () => void]> = [
  ["liveViewersPresence", startLiveViewersPresenceJob],
  ["communityPush", startCommunityPushJob],
];

/** Stable key for pg_try_advisory_lock; any constant bigint shared by all copies works. */
export const JOBS_LEADER_LOCK_KEY = 727_001_001;
const LEADER_RETRY_MS = Number(process.env.JOBS_LEADER_RETRY_MS) || 30_000;
const LEADER_HEARTBEAT_MS = 30_000;

/** "off" keeps a web process out of singleton jobs (a separate worker runs them). */
export function backgroundJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.BACKGROUND_JOBS ?? "on").trim().toLowerCase();
  return !["off", "false", "0", "no", "disabled"].includes(value);
}

export interface LeaderLock {
  /** Resolves true when this process now holds the lock. */
  tryAcquire(): Promise<boolean>;
  /** Resolves false when the lock holder connection is gone. */
  stillHeld(): Promise<boolean>;
}

/** Session-level advisory lock held on one dedicated pool connection. */
export function postgresLeaderLock(key = JOBS_LEADER_LOCK_KEY): LeaderLock {
  let client: PoolClient | null = null;
  const drop = () => {
    try { client?.release(true); } catch { /* already gone */ }
    client = null;
  };
  return {
    async tryAcquire() {
      try {
        const connected: PoolClient = await pool.connect();
        client = connected;
        connected.on("error", (err: Error) => {
          logger.error({ err }, "Background jobs leader connection error");
          drop();
        });
        const res = await connected.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [key]);
        if (res.rows[0]?.locked) return true;
        drop();
        return false;
      } catch (err) {
        logger.warn({ err }, "Background jobs leader lock attempt failed");
        drop();
        return false;
      }
    },
    async stillHeld() {
      if (!client) return false;
      try {
        await client.query("SELECT 1");
        return true;
      } catch {
        drop();
        return false;
      }
    },
  };
}

export interface RunnerOptions {
  lock?: LeaderLock;
  singletonJobs?: ReadonlyArray<readonly [string, () => void]>;
  retryMs?: number;
  heartbeatMs?: number;
  /** Called if leadership is lost after jobs started; default asks the process to restart. */
  onLeadershipLost?: () => void;
}

/**
 * Competes for leadership and starts the singleton jobs once this process
 * wins. Returns a stop function (used by tests and shutdown).
 */
export function startSingletonJobsWithLeadership(opts: RunnerOptions = {}): () => void {
  const lock = opts.lock ?? postgresLeaderLock();
  const jobs = opts.singletonJobs ?? SINGLETON_JOBS;
  const retryMs = opts.retryMs ?? LEADER_RETRY_MS;
  const heartbeatMs = opts.heartbeatMs ?? LEADER_HEARTBEAT_MS;
  const onLost = opts.onLeadershipLost ?? (() => {
    // Interval timers can't be safely torn down mid-run, so restart cleanly;
    // the restarted process rejoins as a follower.
    logger.error("Background jobs leadership lost; restarting so only one copy runs jobs");
    process.kill(process.pid, "SIGTERM");
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const schedule = (fn: () => void, ms: number) => {
    if (stopped) return;
    timer = setTimeout(fn, ms);
    timer.unref?.();
  };

  const heartbeat = async () => {
    if (stopped) return;
    if (await lock.stillHeld()) return schedule(() => void heartbeat(), heartbeatMs);
    // Try to take the lock straight back (e.g. a dropped connection); only one
    // process can, so keep running if we win.
    if (await lock.tryAcquire()) return schedule(() => void heartbeat(), heartbeatMs);
    if (!stopped) onLost();
  };

  const attempt = async () => {
    if (stopped) return;
    if (!(await lock.tryAcquire())) {
      logger.info({ retryMs }, "Background jobs: another process is the leader; standing by");
      return schedule(() => void attempt(), retryMs);
    }
    if (stopped) return;
    logger.info({ jobs: jobs.length }, "Background jobs: this process is the leader; starting jobs");
    for (const [name, start] of jobs) {
      try {
        start();
      } catch (err) {
        logger.error({ err, job: name }, "Background job failed to start");
      }
    }
    schedule(() => void heartbeat(), heartbeatMs);
  };

  void attempt();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function startPerInstanceJobs(): void {
  for (const [name, start] of PER_INSTANCE_JOBS) {
    try {
      start();
    } catch (err) {
      logger.error({ err, job: name }, "Background job failed to start");
    }
  }
}
