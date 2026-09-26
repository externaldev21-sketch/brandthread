/**
 * Integration test (real DB): the Brandthread Agent's profile/messages can
 * never be reported as spam/abuse — POST /api/reports acknowledges the
 * request without creating a report row or a message_reports row.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, and } from "drizzle-orm";
import {
  db, users, conversations, conversationParticipants, messages, agentConversations,
  reports, messageReports,
} from "@workspace/db";
import { BRANDTHREAD_AGENT_CLERK_ID, createWelcomeConversationOnce } from "../../lib/brandthreadAgent";

const TEST_REPORTER = `agent-report-immune-buyer-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = TEST_REPORTER;
    next();
  },
  requireModerator: (_req: any, res: any) => res.status(403).json({ error: "Not a moderator" }),
}));

async function cleanup() {
  const rows = await db.select({ conversationId: agentConversations.conversationId })
    .from(agentConversations).where(eq(agentConversations.userId, TEST_REPORTER));
  for (const row of rows) {
    const msgs = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, row.conversationId));
    for (const m of msgs) await db.delete(messageReports).where(eq(messageReports.messageId, m.id));
    await db.delete(messages).where(eq(messages.conversationId, row.conversationId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.conversationId));
    await db.delete(conversations).where(eq(conversations.id, row.conversationId));
  }
  await db.delete(agentConversations).where(eq(agentConversations.userId, TEST_REPORTER));
  await db.delete(reports).where(and(eq(reports.reporterId, TEST_REPORTER)));
  await db.delete(users).where(eq(users.clerkId, TEST_REPORTER));
}

let server: Server;
let baseUrl = "";

describe("system account report immunity", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values({
      clerkId: TEST_REPORTER, email: `${TEST_REPORTER}@example.test`, name: "Report Test Buyer",
      displayName: "Report Test Buyer", accountType: "buyer", onboardingComplete: true,
    });

    if (!server) {
      const { default: reportsRouter } = await import("../reports");
      const app = express();
      app.use(express.json());
      app.use("/api/reports", reportsRouter);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("refuses to create a report against the Brandthread Agent's profile", async () => {
    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "profile", targetId: BRANDTHREAD_AGENT_CLERK_ID, reason: "spam" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; code?: string };
    expect(body.status).toBe("not_reportable");
    expect(body.code).toBe("SYSTEM_ACCOUNT_IMMUNE");

    const rows = await db.select().from(reports).where(and(
      eq(reports.reporterId, TEST_REPORTER), eq(reports.targetId, BRANDTHREAD_AGENT_CLERK_ID),
    ));
    expect(rows).toHaveLength(0);
  });

  it("refuses to create a report against a message sent by the Brandthread Agent", async () => {
    const { conversationId } = await createWelcomeConversationOnce(TEST_REPORTER, "buyer", {
      name: "Report Test Buyer", handle: "", initials: "RB", color: "#8B5CF6",
    });
    const [agentMessage] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.senderId, BRANDTHREAD_AGENT_CLERK_ID)))
      .limit(1);
    expect(agentMessage).toBeDefined();

    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "message", targetId: agentMessage.id, reason: "spam" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; code?: string };
    expect(body.status).toBe("not_reportable");
    expect(body.code).toBe("SYSTEM_ACCOUNT_IMMUNE");

    const messageReportRows = await db.select().from(messageReports).where(eq(messageReports.messageId, agentMessage.id));
    expect(messageReportRows).toHaveLength(0);
  });
});
