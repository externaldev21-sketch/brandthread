import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Results handed to successive select queries, in order. */
  results: [] as unknown[][],
  blocked: false,
  remixAudience: "everyone" as "everyone" | "following" | "off",
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : String(key),
  });
  const next = () => Promise.resolve(state.results.shift() ?? []);
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => next(),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject),
  };
  return {
    db: { select: () => chain },
    follows: table("follows"),
    posts: table("posts"),
    users: table("users"),
  };
});

vi.mock("../postVisibility", () => ({ publicPostCondition: () => "public" }));
vi.mock("../safety", () => ({ isBlockedEitherWay: async () => state.blocked }));
vi.mock("../interactionSettings", () => ({
  loadInteractionSettings: async () => ({ remixAudience: state.remixAudience }),
}));

import { checkRemix, composedObjectPath, remixAllowedByAudience, remixCredits } from "../remix";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const videoPost = (over: Record<string, unknown> = {}) => ({
  id: POST_ID,
  authorId: "author",
  mediaType: "video",
  mediaUrl: "https://api.example.com/api/posts/media/uploads/composed-1.mp4",
  thumbnailUrl: null,
  authorUsername: "maison",
  ...over,
});

beforeEach(() => {
  state.results = [];
  state.blocked = false;
  state.remixAudience = "everyone";
});

describe("remixAllowedByAudience", () => {
  it("maps Everyone / People you follow / Off", () => {
    expect(remixAllowedByAudience({ audience: "everyone", authorFollowsViewer: false })).toBe(true);
    expect(remixAllowedByAudience({ audience: "following", authorFollowsViewer: false })).toBe(false);
    expect(remixAllowedByAudience({ audience: "following", authorFollowsViewer: true })).toBe(true);
    expect(remixAllowedByAudience({ audience: "off", authorFollowsViewer: true })).toBe(false);
  });
});

describe("composedObjectPath", () => {
  it("only accepts composed uploads", () => {
    expect(composedObjectPath("https://x/api/posts/media/uploads/a.mp4")).toBe("/objects/uploads/a.mp4");
    expect(composedObjectPath("https://cdn.example.com/video.mp4")).toBeNull();
    expect(composedObjectPath("https://x/api/posts/media/../secret")).toBeNull();
    expect(composedObjectPath(null)).toBeNull();
  });
});

describe("checkRemix", () => {
  it("allows a public video when the author allows everyone", async () => {
    state.results = [[videoPost()]];
    const result = await checkRemix(POST_ID, "viewer");
    expect(result).toMatchObject({ allowed: true, source: { id: POST_ID, authorUsername: "maison", objectPath: "/objects/uploads/composed-1.mp4" } });
  });

  it("refuses with REMIX_NOT_ALLOWED when the author turned remixes off", async () => {
    state.remixAudience = "off";
    state.results = [[videoPost()]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ allowed: false, code: "REMIX_NOT_ALLOWED", status: 403 });
  });

  it("'People you follow' needs the author to follow the viewer", async () => {
    state.remixAudience = "following";
    state.results = [[videoPost()], []];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ allowed: false, code: "REMIX_NOT_ALLOWED" });
    state.results = [[videoPost()], [{ followerId: "author" }]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ allowed: true });
  });

  it("refuses photos, your own video, blocked pairs, unknown ids and non-composed media", async () => {
    state.results = [[videoPost({ mediaType: "photo" })]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ code: "NOT_A_VIDEO" });
    state.results = [[videoPost({ authorId: "viewer" })]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ code: "OWN_POST" });
    state.blocked = true;
    state.results = [[videoPost()]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ code: "POST_NOT_FOUND", status: 404 });
    state.blocked = false;
    expect(await checkRemix("nope", "viewer")).toMatchObject({ code: "POST_NOT_FOUND" });
    state.results = [[]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ code: "POST_NOT_FOUND" });
    state.results = [[videoPost({ mediaUrl: "https://cdn.example.com/v.mp4" })]];
    expect(await checkRemix(POST_ID, "viewer")).toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});

describe("remixCredits", () => {
  it("credits the source author of each remix", async () => {
    state.results = [[{ id: "src", authorId: "author", username: "maison" }]];
    const credits = await remixCredits([{ id: "remix", remixOfPostId: "src" }, { id: "plain", remixOfPostId: null }]);
    expect(credits.get("remix")).toEqual({ postId: "src", authorId: "author", username: "maison" });
    expect(credits.has("plain")).toBe(false);
  });

  it("skips the query when nothing is a remix", async () => {
    expect((await remixCredits([{ id: "plain" }])).size).toBe(0);
    expect(state.results).toEqual([]);
  });
});
