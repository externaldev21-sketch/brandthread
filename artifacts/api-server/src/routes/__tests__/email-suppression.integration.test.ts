/**
 * Resend bounce/complaint events for ANY email (not just campaigns) add the
 * recipient to email_suppressions, and transactional email skips them.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import webhookRouter from "../email-marketing-webhook";
import { isEmailSuppressed } from "../../lib/emailSuppression";
import { sendBrandthreadEmail } from "../../lib/brandthreadEmail";

const key = crypto.randomBytes(24);
const suffix = crypto.randomUUID().slice(0, 8);
const bounced = `Bounce-${suffix}@Example.test`;
const complained = `complaint-${suffix}@example.test`;
let server: Server;
let base = "";

beforeAll(async () => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${key.toString("base64")}`);
  const app = express();
  app.use("/hook", express.raw({ type: "*/*" }), webhookRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.execute(sql`DELETE FROM email_suppressions WHERE email IN (${bounced.toLowerCase()}, ${complained})`);
  await new Promise<void>((r) => server.close(() => r()));
});

function post(payload: unknown) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", key).update(`id1.${ts}.${body}`).digest("base64");
  return fetch(`${base}/hook`, {
    method: "POST",
    headers: { "content-type": "application/json", "svix-id": "id1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
    body,
  });
}

describe("account-wide email suppression", () => {
  it("records hard bounces and complaints for transactional emails, ignores soft bounces", async () => {
    expect((await post({ type: "email.bounced", data: { email_id: `re_${suffix}_soft`, to: [complained], bounce: { type: "Transient" } } })).status).toBe(200);
    expect(await isEmailSuppressed(complained)).toBe(false);

    await post({ type: "email.bounced", data: { email_id: `re_${suffix}_1`, to: [bounced], bounce: { type: "Permanent" } } });
    await post({ type: "email.complained", data: { email_id: `re_${suffix}_2`, to: [complained] } });
    expect(await isEmailSuppressed(bounced)).toBe(true);
    expect(await isEmailSuppressed(complained.toUpperCase())).toBe(true);
  });

  it("skips sending to a suppressed address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const sent = await sendBrandthreadEmail({ to: bounced, subject: "Order shipped", html: "<p>hi</p>" });
      expect(sent).toBe(false);
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("resend.com"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      vi.stubEnv("RESEND_API_KEY", "");
    }
  });
});
