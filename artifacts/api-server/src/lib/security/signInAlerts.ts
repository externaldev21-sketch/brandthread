/**
 * New-device sign-in alerts (feature 74), copied from Instagram's login
 * alerts: when someone signs in on a kind of device this account has never
 * used, the owner gets a push ("New login on iPhone near Portland, US"), an
 * email, and an Activity row that opens Login activity, where any session
 * can be signed out.
 *
 * Detection runs on POST /api/auth/sync, which the app calls on every sign-in
 * and launch. Each Clerk session is recorded once (sign_in_events); the very
 * first session of an account never alerts, and neither does signing in again
 * on a device kind already seen.
 *
 * Opt-out: notification preference `login_alerts: false`.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { db, notificationsFeed, signInEvents, users } from "@workspace/db";
import { logger } from "../logger";

export type SessionActivity = {
  deviceType?: string | null;
  browserName?: string | null;
  isMobile?: boolean | null;
  city?: string | null;
  country?: string | null;
};

export const LOGIN_ALERTS_PREF = "login_alerts";

export function deviceKeyFor(activity: SessionActivity | null | undefined): string {
  const kind = activity?.isMobile ? "mobile" : "desktop";
  const device = (activity?.deviceType ?? "").trim().toLowerCase();
  const browser = (activity?.browserName ?? "").trim().toLowerCase();
  return `${kind}|${device}|${browser}`;
}

export function deviceLabelFor(activity: SessionActivity | null | undefined): string {
  const device = activity?.deviceType?.trim();
  const browser = activity?.browserName?.trim();
  if (device && browser && !/app|expo|okhttp|cfnetwork|brandthread/i.test(browser)) return `${browser} on ${device}`;
  if (device) return device;
  if (browser) return activity?.isMobile ? `${browser} on a phone` : `${browser} on a computer`;
  return activity?.isMobile ? "a phone" : "a computer";
}

export function locationFor(activity: SessionActivity | null | undefined): string | null {
  return [activity?.city, activity?.country].filter((v) => !!v && String(v).trim()).join(", ") || null;
}

export type AlertContent = { title: string; body: string };

export function alertContent(label: string, location: string | null): AlertContent {
  return {
    title: "New login",
    body: `Someone signed in to your account on ${label}${location ? ` near ${location}` : ""}. If this wasn't you, sign that device out.`,
  };
}

export type SignInDeps = {
  /** Inserts the session; false when it was already recorded. */
  record(row: { sessionId: string; userId: string; deviceKey: string; deviceLabel: string; location: string | null }): Promise<boolean>;
  /** Earlier sessions on this account: how many, and whether one used this device key. */
  history(userId: string, sessionId: string, deviceKey: string): Promise<{ priorSessions: number; seenDevice: boolean }>;
  alertsEnabled(userId: string): Promise<boolean>;
  notify(userId: string, sessionId: string, content: AlertContent): Promise<void>;
};

export type SignInOutcome = "already_recorded" | "first_session" | "known_device" | "alerts_off" | "alerted";

export async function recordSignIn(
  deps: SignInDeps,
  input: { userId: string; sessionId: string; activity: SessionActivity | null | undefined },
): Promise<SignInOutcome> {
  const deviceKey = deviceKeyFor(input.activity);
  const deviceLabel = deviceLabelFor(input.activity);
  const location = locationFor(input.activity);
  const fresh = await deps.record({ sessionId: input.sessionId, userId: input.userId, deviceKey, deviceLabel, location });
  if (!fresh) return "already_recorded";
  const { priorSessions, seenDevice } = await deps.history(input.userId, input.sessionId, deviceKey);
  if (priorSessions === 0) return "first_session";
  if (seenDevice) return "known_device";
  if (!(await deps.alertsEnabled(input.userId))) return "alerts_off";
  await deps.notify(input.userId, input.sessionId, alertContent(deviceLabel, location));
  return "alerted";
}

// ─── Database + delivery bindings ────────────────────────────────────────────

export const dbSignInDeps: SignInDeps = {
  async record(row) {
    const inserted = await db.insert(signInEvents).values(row).onConflictDoNothing().returning({ id: signInEvents.sessionId });
    return inserted.length > 0;
  },
  async history(userId, sessionId, deviceKey) {
    const [row] = await db.select({
      prior: sql<number>`count(*)::int`,
      seen: sql<boolean>`coalesce(bool_or(${signInEvents.deviceKey} = ${deviceKey}), false)`,
    }).from(signInEvents).where(and(eq(signInEvents.userId, userId), ne(signInEvents.sessionId, sessionId)));
    return { priorSessions: Number(row?.prior ?? 0), seenDevice: row?.seen === true };
  },
  async alertsEnabled(userId) {
    const [row] = await db.select({ prefs: users.notificationPreferences }).from(users).where(eq(users.clerkId, userId)).limit(1);
    return (row?.prefs as Record<string, unknown> | null | undefined)?.[LOGIN_ALERTS_PREF] !== false;
  },
  async notify(userId, sessionId, content) {
    await db.update(signInEvents).set({ alerted: 1 }).where(eq(signInEvents.sessionId, sessionId));
    await db.insert(notificationsFeed).values({
      userId, category: "system", type: "new_login", title: content.title, body: content.body,
      targetType: "login_session", targetId: sessionId, cta: "Review",
    });
    // Imported lazily so this module stays loadable in unit tests.
    const { sendPushToUser } = await import("../push");
    await sendPushToUser(userId, {
      title: content.title, body: content.body,
      data: { type: "new_login", targetType: "login_session", targetId: sessionId, notificationId: `new-login/${sessionId}` },
    });
    const { sendNewLoginEmail } = await import("./newLoginEmail");
    await sendNewLoginEmail(userId, sessionId, content).catch((err) => logger.warn({ err, userId }, "New login email failed"));
  },
};
