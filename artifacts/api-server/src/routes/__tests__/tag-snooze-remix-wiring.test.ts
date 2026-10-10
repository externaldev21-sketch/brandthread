/**
 * Source-level guards that the migration-119 settings stay enforced on the
 * routes that the mocked unit tests can't mount cheaply (posts.ts, public.ts,
 * feed.ts, social.ts, story-mentions.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

describe("migration 119 enforcement wiring", () => {
  it("POST /api/posts refuses a remix the author doesn't allow with 403 REMIX_NOT_ALLOWED", () => {
    const posts = src("posts.ts");
    expect(posts).toContain("const remix = await checkRemix(remixOfPostId, clerkId);");
    expect(posts).toContain('remix.code === "REMIX_NOT_ALLOWED" ? 403');
    expect(posts).toContain('remixOfPostId: typeof remixOfPostId === "string" ? remixOfPostId : null');
    expect(posts).toContain("await recordPostUserTags({");
  });

  it("snoozed viewers get followed accounts only from both suggested sources", () => {
    expect(src("public.ts")).toMatch(/const followedOnly = !ownerId && viewerId && await suggestedPostsSnoozed\(viewerId\)/);
    expect(src("public.ts")).toMatch(/ownerId \? eq\(posts\.userId, ownerId\) : undefined,\n\s+followedOnly,/);
    expect(src("feed.ts")).toContain("await withoutSuggestedWhenSnoozed(userId, await getForYouFeed(userId), (item) => item.sellerId)");
  });

  it("pending tags stay off the Tagged tab, the mentions rail and mention notifications", () => {
    const social = src("social.ts");
    expect(social).toContain('eq(postUserTags.status, "approved")');
    expect(social).toContain('eq(storyMentions.status, "approved")');
    expect(social).toContain("taggable.filter((m) => !pendingMentions?.has(m.userId))");
    expect(src("story-mentions.ts")).toContain('eq(storyMentions.status, "approved")');
  });

  it("feeds carry the remix credit", () => {
    expect(src("posts.ts")).toContain("remixOf:   remixOfByPost.get(p.id) ?? null");
    expect(src("public.ts")).toContain("remixOf:        remixOfByPost.get(p.id) ?? null");
  });
});
