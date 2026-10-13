import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyKeyword, composeOrderSms, computeTwilioSignature, nextSendWindow, normalizeE164,
  recipientZones, sendSms, smsEnabled, twiml, validateTwilioSignature, withinSendWindow,
} from "../sms";

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_FROM_NUMBER"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function clearTwilioEnv() {
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
}

describe("smsEnabled", () => {
  it("is off unless SID, token and a sender are all present", () => {
    clearTwilioEnv();
    expect(smsEnabled()).toBe(false);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    expect(smsEnabled()).toBe(false);
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
    expect(smsEnabled()).toBe(true);
    vi.stubEnv("TWILIO_FROM_NUMBER", "");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG123");
    expect(smsEnabled()).toBe(true);
  });

  it("never calls fetch when the flag is off", async () => {
    clearTwilioEnv();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await sendSms("+15551234567", "hi");
    expect(result).toEqual({ ok: false, error: "sms_disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the Messages resource with basic auth, preferring the Messaging Service", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG999");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await sendSms("+15551234567", "hello");
    expect(result).toEqual({ ok: true, sid: "SM1" });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("MessagingServiceSid")).toBe("MG999");
    expect(body.get("From")).toBeNull();
    expect(body.get("To")).toBe("+15551234567");
  });

  it("returns an error instead of throwing when Twilio rejects or the network fails", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 21610, message: "unsubscribed" }), { status: 400 })));
    const rejected = await sendSms("+15551234567", "x");
    expect(rejected).toMatchObject({ ok: false, code: 21610 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(sendSms("+15551234567", "x")).resolves.toMatchObject({ ok: false, error: "ECONNRESET" });
  });
});

describe("Twilio signature validation", () => {
  // Worked example from Twilio's webhook security docs.
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };

  it("matches Twilio's documented signature", () => {
    expect(computeTwilioSignature(token, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("accepts the right signature and rejects tampering", () => {
    const sig = computeTwilioSignature(token, url, params);
    expect(validateTwilioSignature(token, sig, url, params)).toBe(true);
    expect(validateTwilioSignature(token, sig, url, { ...params, Digits: "9999" })).toBe(false);
    expect(validateTwilioSignature(token, sig, "https://evil.example/myapp.php?foo=1&bar=2", params)).toBe(false);
    expect(validateTwilioSignature("other", sig, url, params)).toBe(false);
    expect(validateTwilioSignature(token, undefined, url, params)).toBe(false);
    expect(validateTwilioSignature(token, "short", url, params)).toBe(false);
  });

  it("sorts keys before hashing", () => {
    const expected = crypto.createHmac("sha1", "t").update("https://x/yA1B2").digest("base64");
    expect(computeTwilioSignature("t", "https://x/y", { B: "2", A: "1" })).toBe(expected);
  });
});

describe("keywords", () => {
  it.each([
    ["STOP", "stop"], ["stop", "stop"], [" Unsubscribe ", "stop"], ["STOPALL", "stop"], ["cancel", "stop"],
    ["END", "stop"], ["quit", "stop"], ["START", "start"], ["unstop", "start"], ["HELP", "help"], ["info", "help"],
    ["where is my order", null], ["", null],
  ])("%s -> %s", (body, expected) => {
    expect(classifyKeyword(body)).toBe(expected);
  });

  it("escapes TwiML replies", () => {
    expect(twiml("a & <b>")).toContain("<Message>a &amp; &lt;b&gt;</Message>");
    expect(twiml(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});

describe("phone normalisation and copy", () => {
  it("normalises to E.164", () => {
    expect(normalizeE164("(555) 123-4567")).toBe("+15551234567");
    expect(normalizeE164("1 555 123 4567")).toBe("+15551234567");
    expect(normalizeE164("+44 7700 900123")).toBe("+447700900123");
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164(42)).toBeNull();
  });

  it("writes short order texts", () => {
    expect(composeOrderSms("shipped", { orderNumber: "1042", storeName: "Kith", trackingUrl: "https://t.example/1" }))
      .toBe("Brandthread: Your order #1042 from Kith shipped. Track: https://t.example/1");
    expect(composeOrderSms("out_for_delivery", { storeName: "Kith" })).toBe("Brandthread: Your order from Kith is out for delivery today.");
    expect(composeOrderSms("refunded", { orderNumber: "7", amountCents: 2500 })).toBe("Brandthread: A $25.00 refund for your order #7 was issued.");
  });
});

describe("send window (8am-9pm local)", () => {
  it("uses a stored zone", () => {
    // 13:00 UTC = 9am New York (EDT)
    expect(withinSendWindow(new Date("2026-07-01T13:00:00Z"), ["America/New_York"])).toBe(true);
    // 02:00 UTC = 10pm New York
    expect(withinSendWindow(new Date("2026-07-02T02:00:00Z"), ["America/New_York"])).toBe(false);
  });

  it("requires both US coasts when the zone was never set", () => {
    const zones = recipientZones("UTC", "+15551234567");
    expect(zones).toEqual(["America/New_York", "America/Los_Angeles"]);
    // 9am New York = 6am Los Angeles: too early on the west coast
    expect(withinSendWindow(new Date("2026-07-01T13:00:00Z"), zones)).toBe(false);
    // 3pm New York = noon Los Angeles
    expect(withinSendWindow(new Date("2026-07-01T19:00:00Z"), zones)).toBe(true);
    expect(recipientZones("Not/AZone", "+447700900123")).toEqual(["UTC"]);
    expect(recipientZones("Europe/London", "+15551234567")).toEqual(["Europe/London"]);
  });

  it("defers to the next morning", () => {
    const next = nextSendWindow(new Date("2026-07-02T02:10:00Z"), ["America/New_York"]);
    // 8:00am EDT = 12:00 UTC
    expect(next.toISOString()).toBe("2026-07-02T12:00:00.000Z");
  });
});
