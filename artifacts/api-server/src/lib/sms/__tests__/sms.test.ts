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
