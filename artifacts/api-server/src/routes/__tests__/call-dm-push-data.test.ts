/**
 * The incoming-call notification is stored in the Activity feed against the
 * conversation (tapping it later opens the chat), while the push itself
 * carries the call: extraData overrides targetType/targetId in push data only.
 * Mocked `@workspace/db`, like notifications-feed-comment-id.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

const inserted = vi.hoisted(() => [] as any[]);
const pushes = vi.hoisted(() => [] as any[]);

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({}, {
    get: (_t, prop) => (typeof prop === "string" ? `${name}.${prop}` : undefined),
  });
  const chain = (result: any): any => {
    const obj: any = {
      from: () => obj, where: () => obj, orderBy: () => obj, limit: () => obj, offset: () => obj,
      values: (v: any) => { inserted.push(v); return obj; },
      onConflictDoNothing: () => obj,
      returning: () => Promise.resolve([{ id: "n-1" }]),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  };
  return {
    users: tableStub("users"),
    blocks: tableStub("blocks"),
    follows: tableStub("follows"),
    activityMutes: tableStub("activityMutes"),
    notificationsFeed: tableStub("notificationsFeed"),
    conversationParticipants: tableStub("conversationParticipants"),
    db: { select: vi.fn(() => chain([])), insert: vi.fn(() => chain([])) },
  };
});

vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: () => "message",
  // lib/notificationChannels.ts (in-app channel switch): no per-type key → enabled.
  preferenceKey: () => null,
  sendPushToUser: vi.fn(async (_userId: string, payload: any) => { pushes.push(payload); }),
}));

describe("incoming DM call notification", () => {
  it("feed row targets the conversation; push data targets the call", async () => {
    const { publishNotification } = await import("../notifications-feed");
    await publishNotification({
      userId: "callee-user",
      category: "message",
      type: "dm_call_incoming",
      title: "Incoming voice call",
      body: "Ava Stone is calling you",
      actorName: "Ava Stone",
      targetId: "conv-1",
      targetType: "conversation",
      pushCategory: "message",
      pushChannelId: "calls",
      pushSound: "default",
      pushPriority: "high",
      pushInterruptionLevel: "time-sensitive",
      extraData: {
        targetType: "dm_call", targetId: "call-1", callId: "call-1",
        conversationId: "conv-1", mode: "voice", actorName: "Ava Stone",
        notificationId: "must-not-override",
      },
    });
    expect(inserted[0]).toMatchObject({ type: "dm_call_incoming", targetType: "conversation", targetId: "conv-1" });
    expect(pushes[0]).toMatchObject({
      channelId: "calls",
      sound: "default",
      priority: "high",
      interruptionLevel: "time-sensitive",
      data: {
        notificationId: "n-1",
        type: "dm_call_incoming",
        targetType: "dm_call",
        targetId: "call-1",
        callId: "call-1",
        conversationId: "conv-1",
        mode: "voice",
        actorName: "Ava Stone",
      },
    });
  });
});
