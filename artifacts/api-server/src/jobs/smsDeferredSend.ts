/**
 * Sends order texts that were deferred because they fell outside 8am-9pm in
 * the buyer's time zone (see lib/sms.ts). Runs every 10 minutes; a no-op when
 * Twilio isn't configured.
 */
import { logger } from "../lib/logger";
import { sendDueDeferredSms, smsEnabled } from "../lib/sms";

const INTERVAL_MS = 10 * 60 * 1000;

export async function runSmsDeferredSend(now = new Date()) {
  try {
    return await sendDueDeferredSms(now);
  } catch (err) {
    logger.error({ err, job: "smsDeferredSend" }, "Deferred SMS job failed");
    return { sent: 0, skipped: 0, rescheduled: 0 };
  }
}

export function startSmsDeferredSendJob(): void {
  if (!smsEnabled()) {
    logger.info({ job: "smsDeferredSend" }, "SMS not configured; deferred SMS job not scheduled");
    return;
  }
  setTimeout(() => { void runSmsDeferredSend(); }, 90 * 1000);
  setInterval(() => { void runSmsDeferredSend(); }, INTERVAL_MS);
  logger.info({ job: "smsDeferredSend", intervalMs: INTERVAL_MS }, "Deferred SMS job scheduled");
}
