import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { profileLanding } from "../profileLanding";

const suffix = crypto.randomBytes(4).toString("hex");
const live = `land_${suffix}`;
const suspended = `susp_${suffix}`;
const seller = `sell_${suffix}`;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: `c-${live}`, email: `${live}@example.test`, name: "Live", username: live, accountType: "buyer", displayName: `<script>alert(1)</script>`, bio: `"><img src=x onerror=alert(1)>`, onboardingComplete: true },
    { clerkId: `c-${suspended}`, email: `${suspended}@example.test`, name: "Susp", username: suspended, accountType: "buyer", suspendedAt: new Date(), onboardingComplete: true },
    { clerkId: `c-${seller}`, email: `${seller}@example.test`, name: "Sell", username: seller, accountType: "seller", displayName: "North Line", onboardingComplete: true },
  ]);
  const app = express();
  app.get("/u/:username", profileLanding);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.username, [live, suspended, seller]));
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /u/:username", () => {
  it("escapes user-controlled text and only exposes public fields", async () => {
    const res = await fetch(`${base}/u/${live.toUpperCase()}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(`${live}@example.test`);
  });
  it("404s for suspended, unknown, and malformed usernames", async () => {
    expect((await fetch(`${base}/u/${suspended}`)).status).toBe(404);
    expect((await fetch(`${base}/u/nobody_${suffix}`)).status).toBe(404);
    expect((await fetch(`${base}/u/a`)).status).toBe(404);
  });
  it("forwards a seller link (with its creator code) to the guest-browsable seller profile (BT-305/324)", async () => {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, seller));
    const res = await fetch(`${base}/u/${seller}?aff=NORTH10&utm_source=ig&evil=%22%3E`);
    const html = await res.text();
    expect(res.status).toBe(200);
    const target = `/seller-profile?sellerId=${row.id}&amp;isOwner=false&amp;aff=NORTH10&amp;utm_source=ig`;
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${target}">`);
    expect(html).toContain(`href="${target}">Shop North Line</a>`);
    expect(html).not.toContain("evil");
    expect(html).toContain('property="og:title"');
  });
  it("keeps buyers on the landing page", async () => {
    const html = await (await fetch(`${base}/u/${live}`)).text();
    expect(html).not.toContain("http-equiv=\"refresh\"");
    expect(html).toContain("Open in Brandthread");
  });
});
