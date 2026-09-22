import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mobileRoot = path.resolve(__dirname, "..");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"),
);

describe("order notification sound configuration", () => {
  it("registers the documented order sound with expo-notifications", () => {
    const plugin = appConfig.expo.plugins.find(
      (entry: unknown) => Array.isArray(entry) && entry[0] === "expo-notifications",
    );

    expect(plugin?.[1]?.sounds).toContain("./assets/sounds/order_received.wav");
  });

  it("documents the exact drop-in asset path", () => {
    const guide = fs.readFileSync(
      path.join(mobileRoot, "assets/sounds/README.md"),
      "utf8",
    );

    expect(guide).toContain(
      "artifacts/mobile/assets/sounds/order_received.wav",
    );
  });
});