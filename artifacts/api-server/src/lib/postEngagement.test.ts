import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, interactions: {}, savedItems: {} }));
vi.mock("./postVisibility", () => ({ visibleCommentCounts: async () => new Map() }));

import { engagementFields } from "./postEngagement";

describe("engagementFields (For You parity with /api/public/posts)", () => {
  const counts = { likes: 12, reposts: 3, shares: 2, saves: 5, comments: 7 };

  it("returns the same count fields public posts return", () => {
    expect(engagementFields({ showLikeCount: true }, counts)).toEqual({
      likesCount: 12, repostsCount: 3, sharesCount: 2, savesCount: 5, commentsCount: 7,
    });
  });

  it("hides the like count when the seller turned it off", () => {
    expect(engagementFields({ showLikeCount: false }, counts).likesCount).toBeNull();
  });

  it("defaults to zero for posts with no interactions", () => {
    expect(engagementFields(null, undefined)).toEqual({
      likesCount: 0, repostsCount: 0, sharesCount: 0, savesCount: 0, commentsCount: 0,
    });
  });
});
