import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sellerFromUnsubscribeToken, sellerTipsEnabled, sellerTipsUnsubscribeUrl } from "../unsubscribe";
import { signToken } from "../../emailMarketing/tokens";

describe("seller tips unsubscribe link", () => {
  const prev = process.env.EMAIL_TOKEN_SECRET;
  beforeEach(() => { process.env.EMAIL_TOKEN_SECRET = "test-secret-123456"; });
  afterEach(() => { process.env.EMAIL_TOKEN_SECRET = prev; });

  it("round-trips the seller id", () => {
    const url = sellerTipsUnsubscribeUrl("user_abc")!;
    const token = decodeURIComponent(url.split("/").pop()!);
    expect(sellerFromUnsubscribeToken(token)).toBe("user_abc");
  });
  it("rejects a tampered token and an email-list token", () => {
    const url = sellerTipsUnsubscribeUrl("user_abc")!;
    const token = decodeURIComponent(url.split("/").pop()!);
    expect(sellerFromUnsubscribeToken(token.replace("user_abc", "user_xyz"))).toBeNull();
    expect(sellerFromUnsubscribeToken(signToken("unsub", "subscriber-raw-token"))).toBeNull();
  });
  it("defaults on and honours an explicit off", () => {
    expect(sellerTipsEnabled(null, "email")).toBe(true);
    expect(sellerTipsEnabled({ "email:seller_tips": false }, "email")).toBe(false);
    expect(sellerTipsEnabled({ "email:seller_tips": false }, "push")).toBe(true);
    expect(sellerTipsEnabled({ seller_tips: false }, "push")).toBe(false);
  });
});
