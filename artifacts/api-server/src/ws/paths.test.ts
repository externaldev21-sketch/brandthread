import { describe, expect, it } from "vitest";
import { matchesWsPath } from "./paths";

describe("WebSocket upgrade paths", () => {
  it("accepts the /api-prefixed path the deployed router actually forwards", () => {
    expect(matchesWsPath("/api/ws/live", "/ws/live")).toBe(true);
    expect(matchesWsPath("/api/v1/ws/community", "/ws/community")).toBe(true);
  });

  it("still accepts the bare path for already-installed app builds", () => {
    expect(matchesWsPath("/ws/live", "/ws/live")).toBe(true);
  });

  it("ignores other hubs' and unrelated paths", () => {
    expect(matchesWsPath("/api/ws/community", "/ws/live")).toBe(false);
    expect(matchesWsPath("/api/ws/live/extra", "/ws/live")).toBe(false);
  });
});
