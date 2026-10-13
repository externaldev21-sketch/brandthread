import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDER_SOUND_FILE, buildExpoPushMessages, resolvePushSound } from "./push";

describe("new order sound (Settings › Sounds & haptics)", () => {
  it("plays the order chime by default", () => {
    expect(resolvePushSound(ORDER_SOUND_FILE, {})).toBe(ORDER_SOUND_FILE);
    expect(resolvePushSound(ORDER_SOUND_FILE, null)).toBe(ORDER_SOUND_FILE);
    expect(resolvePushSound(ORDER_SOUND_FILE, { new_order_sound: true })).toBe(ORDER_SOUND_FILE);
  });

  it("falls back to the standard sound when the seller turns it off", () => {
    expect(resolvePushSound(ORDER_SOUND_FILE, { new_order_sound: false })).toBe("default");
    const [message] = buildExpoPushMessages([{ token: "t" }], {
      title: "New order!", body: "", sound: resolvePushSound(ORDER_SOUND_FILE, { new_order_sound: false }),
    });
    expect(message.sound).toBe("default");
  });

  it("leaves every other sound alone", () => {
    expect(resolvePushSound(undefined, { new_order_sound: false })).toBeUndefined();
    expect(resolvePushSound("default", { new_order_sound: false })).toBe("default");
  });

  it("uses the file the app actually bundles", () => {
    const asset = resolve(__dirname, "../../../mobile/assets/sounds", ORDER_SOUND_FILE);
    expect(() => readFileSync(asset)).not.toThrow();
    const webhooks = readFileSync(resolve(__dirname, "../routes/webhooks.ts"), "utf8");
    expect(webhooks).not.toMatch(/order-received\.wav/);
    expect(webhooks).toMatch(/pushSound: ORDER_SOUND_FILE/);
  });
});
