/** The database bindings for new-device sign-in alerts (sign_in_events, migration 522). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, notificationsFeed, signInEvents, users } from "@workspace/db";

vi.mock("../../push", () => ({ sendPushToUser: vi.fn().mockResolvedValue(true) }));
vi.mock("../newLoginEmail", () => ({ sendNewLoginEmail: vi.fn().mockResolvedValue(true) }));

import { dbSignInDeps, recordSignIn } from "../signInAlerts";
import { sendPushToUser } from "../../push";

const suffix = crypto.randomBytes(6).toString("hex");
const USER = `sie-user-${suffix}`;
const OFF = `sie-off-${suffix}`;

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: USER, email: `${USER}@t.local`, name: "U", username: `sieu_${suffix}`, role: "buyer", accountType: "buyer" },
    { clerkId: OFF, email: `${OFF}@t.local`, name: "O", username: `sieo_${suffix}`, role: "buyer", accountType: "buyer",
      notificationPreferences: { login_alerts: false } as any },
  ]);
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, [USER, OFF]));
  await db.delete(signInEvents).where(inArray(signInEvents.userId, [USER, OFF]));
  await db.delete(users).where(inArray(users.clerkId, [USER, OFF]));
});

const phone = { deviceType: "iPhone", browserName: "CFNetwork", isMobile: true, city: "Portland", country: "US" };
const laptop = { deviceType: "Macintosh", browserName: "Chrome", isMobile: false, city: "Austin", country: "US" };

describe("sign-in alerts against the database", () => {
  it("records the first session quietly, then alerts once for a new device kind", async () => {
    expect(await recordSignIn(dbSignInDeps, { userId: USER, sessionId: `sess_a_${suffix}`, activity: phone })).toBe("first_session");
    expect(await recordSignIn(dbSignInDeps, { userId: USER, sessionId: `sess_a_${suffix}`, activity: phone })).toBe("already_recorded");
    expect(await recordSignIn(dbSignInDeps, { userId: USER, sessionId: `sess_b_${suffix}`, activity: phone })).toBe("known_device");
    expect(await recordSignIn(dbSignInDeps, { userId: USER, sessionId: `sess_c_${suffix}`, activity: laptop })).toBe("alerted");

    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, USER));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: "new_login", targetType: "login_session", targetId: `sess_c_${suffix}`, title: "New login" });
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(signInEvents).where(eq(signInEvents.sessionId, `sess_c_${suffix}`));
    expect(row).toMatchObject({ alerted: 1, deviceLabel: "Chrome on Macintosh", location: "Austin, US" });
  });

  it("stays quiet when the person turned login alerts off", async () => {
    await recordSignIn(dbSignInDeps, { userId: OFF, sessionId: `sess_x_${suffix}`, activity: phone });
    expect(await recordSignIn(dbSignInDeps, { userId: OFF, sessionId: `sess_y_${suffix}`, activity: laptop })).toBe("alerts_off");
  });
});
