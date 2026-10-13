import { describe, expect, it } from "vitest";
import { GIFT_CARD_CLAIM_URL, SMS_MESSAGE_MAX, cleanSmsMessage, giftCardSmsBody } from "../sms";
import { purchaseSchema } from "../purchaseSchema";

describe("gift card text", () => {
  it("says who sent it, the amount, the store, the note, the code and the claim link", () => {
    const body = giftCardSmsBody({ senderName: "Alex", storeName: "Atelier North", amountCents: 2_500, message: "Happy birthday", code: "ABCD-EFGH-JKLM-NPQR" });
    expect(body).toBe(`Alex sent you a $25 Atelier North gift card.\n"Happy birthday"\nCode: ABCD-EFGH-JKLM-NPQR\nClaim it: ${GIFT_CARD_CLAIM_URL}`);
  });

  it("works without a sender or note, and keeps cents when there are any", () => {
    const body = giftCardSmsBody({ storeName: "Shop", amountCents: 2_550, code: "C" });
    expect(body.startsWith("You have a $25.50 Shop gift card.\nCode: C")).toBe(true);
  });

  it("strips links from the buyer's note and caps its length", () => {
    expect(cleanSmsMessage("Enjoy! see https://evil.example/x and www.bad.io and bad.com/path ok")).toBe("Enjoy! see and and ok");
    const long = cleanSmsMessage("a".repeat(400));
    expect(long.length).toBe(SMS_MESSAGE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(cleanSmsMessage(null)).toBe("");
  });
});

describe("purchase body", () => {
  const base = { sellerId: "s1", amountCents: 2_500, clientIdempotencyKey: "key-12345" };

  it("keeps email purchases unchanged", () => {
    const parsed = purchaseSchema.parse({ ...base, recipientEmail: " Friend@Test.Local " });
    expect(parsed.recipientEmail).toBe("friend@test.local");
    expect(parsed.recipientPhone).toBeUndefined();
  });

  it("accepts a phone instead, normalized to E.164", () => {
    expect(purchaseSchema.parse({ ...base, recipientPhone: "(415) 555-2671" }).recipientPhone).toBe("+14155552671");
  });

  it("needs an email or a phone, and a valid phone", () => {
    expect(purchaseSchema.safeParse(base).success).toBe(false);
    expect(purchaseSchema.safeParse({ ...base, recipientPhone: "12345" }).success).toBe(false);
    expect(purchaseSchema.safeParse({ ...base, recipientEmail: "nope" }).success).toBe(false);
  });
});
