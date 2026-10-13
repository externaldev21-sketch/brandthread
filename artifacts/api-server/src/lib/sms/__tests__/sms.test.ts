import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneLast4, toE164 } from "../phone";
import { sendSms, smsEnabled } from "../twilio";

describe("toE164", () => {
  it("normalizes US numbers in any punctuation", () => {
    expect(toE164("(415) 555-2671")).toBe("+14155552671");
    expect(toE164("415.555.2671")).toBe("+14155552671");
    expect(toE164("1 415 555 2671")).toBe("+14155552671");
    expect(toE164("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("keeps international numbers given with +", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects what isn't dialable", () => {
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("555-2671")).toBeNull();
    expect(toE164("call me")).toBeNull();
    expect(toE164("(015) 555-2671")).toBeNull(); // area code can't start with 0/1
    expect(toE164("415 155 2671")).toBeNull(); // exchange can't start with 0/1
    expect(toE164("+0123456789")).toBeNull();
    expect(toE164("+1234567890123456")).toBeNull();
  });

  it("last 4", () => {
    expect(phoneLast4("+14155552671")).toBe("2671");
    expect(phoneLast4(null)).toBeNull();
  });
});

describe("twilio sendSms", () => {
  const ENV = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"] as const;
  afterEach(() => { for (const key of ENV) vi.unstubAllEnvs(); });

  function configure(extra: Partial<Record<(typeof ENV)[number], string>> = {}) {
    for (const key of ENV) vi.stubEnv(key, "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
  }

  it("is off and never calls out when not configured", async () => {
    for (const key of ENV) vi.stubEnv(key, "");
    const fetchImpl = vi.fn();
    expect(smsEnabled()).toBe(false);
    expect(await sendSms("+14155552671", "hi", fetchImpl as any)).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("needs a sender as well as credentials", () => {
    configure();
    expect(smsEnabled()).toBe(false);
    configure({ TWILIO_FROM_NUMBER: "+15005550006" });
    expect(smsEnabled()).toBe(true);
  });

  it("posts the message with basic auth and the From number", async () => {
    configure({ TWILIO_FROM_NUMBER: "+15005550006" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    expect(await sendSms("+14155552671", "Hello there", fetchImpl as any)).toEqual({ sent: true, sid: "SM1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get("To")).toBe("+14155552671");
    expect(form.get("From")).toBe("+15005550006");
    expect(form.get("Body")).toBe("Hello there");
  });

  it("prefers a messaging service when set", async () => {
    configure({ TWILIO_FROM_NUMBER: "+15005550006", TWILIO_MESSAGING_SERVICE_SID: "MG9" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: "SM2" }), { status: 201 }));
    await sendSms("+14155552671", "x", fetchImpl as any);
    const form = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(form.get("MessagingServiceSid")).toBe("MG9");
    expect(form.get("From")).toBeNull();
  });

  it("reports API errors and network failures without throwing", async () => {
    configure({ TWILIO_FROM_NUMBER: "+15005550006" });
    const refused = vi.fn(async () => new Response(JSON.stringify({ code: 21211, message: "Invalid 'To'" }), { status: 400 }));
    expect(await sendSms("+14155552671", "x", refused as any)).toEqual({ sent: false, reason: "api_error" });
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); });
    expect(await sendSms("+14155552671", "x", down as any)).toEqual({ sent: false, reason: "api_error" });
    const badTo = vi.fn();
    expect(await sendSms("4155552671", "x", badTo as any)).toEqual({ sent: false, reason: "invalid_number" });
    expect(badTo).not.toHaveBeenCalled();
  });
});

import crypto from "node:crypto";
import {
  computeTwilioSignature, isSmsConfigured, isValidTwilioSignature, maskPhone, normalizePhone, sendSms as sendDropSms,
} from "..";

describe("normalizePhone", () => {
  it("defaults to +1 and accepts common US formats", () => {
    expect(normalizePhone("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("415.555.2671")).toBe("+14155552671");
    expect(normalizePhone("1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhone("+1 415-555-2671")).toBe("+14155552671");
  });

  it("accepts other countries in E.164 or with a separate country code", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("07700 900123", "+44")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("151 23456789", "49")).toBe("+4915123456789");
  });

  it("rejects invalid input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(4155552671 as unknown)).toBeNull();
    expect(normalizePhone("555-2671")).toBeNull(); // too short for +1
    expect(normalizePhone("(015) 555-2671")).toBeNull(); // NANP area code can't start with 0/1
    expect(normalizePhone("415 155 2671")).toBeNull(); // NANP exchange can't start with 0/1
    expect(normalizePhone("call me 4155552671")).toBeNull();
    expect(normalizePhone("+0 123 456 789")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull(); // > 15 digits
    expect(normalizePhone("4155552671", "abc")).toBeNull();
  });

  it("masks all but the last four digits", () => {
    expect(maskPhone("+14155552671")).toBe("+1 ••• ••• 2671");
    expect(maskPhone("+447700900123")).toBe("+44 ••• 0123");
  });
});

describe("Twilio request signature", () => {
  // Worked example from Twilio's webhook security documentation.
  const authToken = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };

  it("matches Twilio's documented HMAC-SHA1 example", () => {
    expect(computeTwilioSignature(authToken, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("validates against any candidate URL and rejects tampering", () => {
    const sig = computeTwilioSignature(authToken, url, params);
    expect(isValidTwilioSignature(authToken, sig, ["https://other.example/x", url], params)).toBe(true);
    expect(isValidTwilioSignature(authToken, sig, [url], { ...params, Digits: "9999" })).toBe(false);
    expect(isValidTwilioSignature("wrong", sig, [url], params)).toBe(false);
    expect(isValidTwilioSignature(authToken, undefined, [url], params)).toBe(false);
    expect(isValidTwilioSignature(authToken, "", [url], params)).toBe(false);
  });

  it("sorts params by name and concatenates name+value", () => {
    const manual = crypto.createHmac("sha1", "tok").update("https://x.test/hookA1B2").digest("base64");
    expect(computeTwilioSignature("tok", "https://x.test/hook", { B: "2", A: "1" })).toBe(manual);
  });
});

describe("sendDropSms", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is off without all three env vars", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG123");
    expect(isSmsConfigured()).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendDropSms("+14155552671", "hi")).toEqual({ ok: false, status: 503, code: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a form to the Messages API with basic auth and the messaging service", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG456");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SM1" }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendDropSms("+14155552671", "Drop is live")).toEqual({ ok: true, sid: "SM1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const body = new URLSearchParams(init.body);
    expect(body.get("To")).toBe("+14155552671");
    expect(body.get("MessagingServiceSid")).toBe("MG456");
    expect(body.get("Body")).toBe("Drop is live");
  });

  it("reports provider errors without throwing", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG456");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 21610 }) }));
    expect(await sendDropSms("+14155552671", "x")).toEqual({ ok: false, status: 400, code: 21610 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await sendDropSms("+14155552671", "x")).toEqual({ ok: false, status: 0, code: null });
  });
});
