import { describe, expect, it } from "vitest";
import { composeBatchedMessage } from "./notificationBatchFlush";

describe("composeBatchedMessage", () => {
  it("names the single actor when only one event was collapsed", () => {
    const message = composeBatchedMessage({ type: "post_liked", count: 1, actorNames: ["Maya"] });
    expect(message.body).toBe("Maya liked your post");
  });

  it("collapses multiple actors into '<first> and N others'", () => {
    const message = composeBatchedMessage({ type: "post_liked", count: 5, actorNames: ["Maya"] });
    expect(message.body).toBe("Maya and 4 others liked your post");
  });

  it("uses singular 'other' for exactly two collapsed events", () => {
    const message = composeBatchedMessage({ type: "post_liked", count: 2, actorNames: ["Maya"] });
    expect(message.body).toBe("Maya and 1 other liked your post");
  });

  it("falls back to a count when no actor name is known", () => {
    const message = composeBatchedMessage({ type: "post_liked", count: 3, actorNames: [] });
    expect(message.body).toBe("3 people liked your post");
  });

  it("has a generic fallback for an unrecognized batched type", () => {
    const message = composeBatchedMessage({ type: "mystery_event", count: 1, actorNames: ["Maya"] });
    expect(message.body).toBe("Maya interacted with your post");
  });
});
