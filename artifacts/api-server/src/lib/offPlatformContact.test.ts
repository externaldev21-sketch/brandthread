import { describe, expect, it } from "vitest";
import {
  OFF_PLATFORM_MASK,
  detectOffPlatformContact,
  maskOffPlatformContact,
  type OffPlatformKind,
} from "./contentModerator";

function kinds(text: string): OffPlatformKind[] {
  return detectOffPlatformContact(text).kinds;
}

describe("detectOffPlatformContact: contact details", () => {
  const emails = [
    "email me: john.factory@gmail.com",
    "JOHN.FACTORY@GMAIL.COM",
    "john.factory @ gmail . com",
    "john.factory(at)gmail(dot)com",
    "john.factory [at] gmail [dot] com",
    "john.factory {at} qq {dot} com",
    "john_factory at gmail dot com",
    "sales at saigonknit dot vn",
    "j o h n @ g m a i l . c o m",
    "ｊｏｈｎ＠ｇｍａｉｌ．ｃｏｍ",
    "my gmail is johnfactory88",
    "sales@factory.com.cn please",
  ];
  it.each(emails)("flags the email in %j", (text) => {
    expect(kinds(text)).toContain("email");
  });

  const phones = [
    "call me +86 138 1234 5678",
    "+1 (415) 555-0134",
    "my number is 0912 345 678",
    "WhatsApp +84 90 123 4567",
    "415-555-0134",
    "4155550134",
    "0086-13812345678",
    "5 5 5 1 2 3 4 5 6 7",
    "five five five one two three four five six seven",
    "06 12 34 56 78",
    "tel: 2345 6789",
    "１３８１２３４５６７８",
    "+44 7700 900123",
  ];
  it.each(phones)("flags the phone number in %j", (text) => {
    expect(kinds(text)).toContain("phone");
  });

  const messaging = [
    "WeChat: factory_amy88",
    "wechat id amy2024",
    "add me on WhatsApp",
    "let's move to WeChat",
    "my telegram is @amy_factory",
    "Skype: live:amy.factory_1",
    "line id: amy0815",
    "wa.me/8613812345678",
  ];
  it.each(messaging)("flags the messaging app handle in %j", (text) => {
    expect(kinds(text)).toContain("messaging_id");
  });

  it("flags websites but leaves file-sharing links alone", () => {
    expect(kinds("see www.saigonknit.vn for our catalog")).toContain("link");
    expect(kinds("our site is https://saigon-knit.com/catalog")).toContain("link");
    expect(kinds("saigonknit.com")).toContain("link");
    expect(kinds("tech pack: https://drive.google.com/file/d/abc123/view")).not.toContain("link");
    expect(kinds("figma: https://www.figma.com/file/xyz")).not.toContain("link");
    expect(kinds("I uploaded techpack.pdf")).not.toContain("link");
  });

  it("flags requests for contact details", () => {
    expect(kinds("can you send me your email?")).toContain("contact_request");
    expect(kinds("what's your WhatsApp")).toContain("contact_request");
    expect(kinds("text me at the number below")).toContain("contact_request");
  });
});

describe("detectOffPlatformContact: payment steering", () => {
  it.each([
    ["IBAN DE89 3704 0044 0532 0130 00", "iban"],
    ["GB29NWBK60161331926819", "iban"],
    ["SWIFT: BOFAUS3NXXX", "swift"],
    ["swift code ICBKCNBJ", "swift"],
    ["account number 1234 5678 9012", "bank_account"],
    ["routing #021000021", "bank_account"],
    ["paypal.me/amyfactory", "payment_handle"],
    ["venmo @amy-factory", "payment_handle"],
    ["cashapp $amyfactory", "payment_handle"],
    ["pay with PayPal and I'll ship faster", "payment_app"],
    ["Zelle works for me", "payment_app"],
    ["send it through Wise", "payment_app"],
    ["we accept Western Union", "payment_app"],
    ["you can pay me directly", "off_platform_payment"],
    ["pay us directly and we give 5% off", "off_platform_payment"],
    ["bank transfer is cheaper", "off_platform_payment"],
    ["T/T 30% deposit, 70% before shipping", "off_platform_payment"],
    ["we can wire the deposit", "off_platform_payment"],
    ["let's do it outside Brandthread", "off_platform_payment"],
    ["to avoid the fees", "off_platform_payment"],
    ["I'll invoice you directly", "off_platform_payment"],
  ] as Array<[string, OffPlatformKind]>)("flags %j as %s", (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });
});

describe("detectOffPlatformContact: ordinary production talk stays clean", () => {
  const clean = [
    "Sizes 36 38 40 42 44",
    "sizes: 34 36 38 40",
    "MOQ 500 pcs, 1000 pcs for the second colorway",
    "Price is $12.50 per piece, $11.80 above 1,000 units",
    "US$8 – 20 per piece",
    "Quantity 1200 pieces",
    "Sample ready 2026-10-21",
    "Ship date 10/21/2026",
    "Deadline 21.10.2026",
    "fabric 280 gsm, 60 x 90 cm",
    "Order #123456789 is in cutting",
    "tracking number 1Z999AA10123456784",
    "style no. 20261021",
    "PO 4500012345",
    "We work 9:00-18:00 Monday to Friday",
    "Total 3,450.00 USD for 300 pieces",
    "colors: black, white, heather grey",
    "Can you do 100 200 300 pieces tiers?",
    "we have 40 machines and 60 workers",
    "line up the seams at the shoulder",
    "our product line is mostly knitwear",
    "that's a wise choice for the lining",
    "great, see you at the sample review",
    "We ship via DHL in 5-7 days",
    "please pay the card in the chat when you're ready",
    "send the tech pack here",
    "v2.1 of the pattern",
    "size chart: S 36, M 38, L 40",
    "I'll call you tomorrow about the sample",
    "Deposit 30% via the card in chat",
    "kids sizes 2 4 6 8 10 12 14",
    "quantities 50 / 100 / 250 / 500",
    "can we talk at 10am your time?",
    "the wire frame of the bag needs to be stiffer",
    "zip 10001, New York",
    "Lot 2026-0042-118",
  ];
  it.each(clean)("does not flag %j", (text) => {
    expect(detectOffPlatformContact(text).kinds).toEqual([]);
  });
});

describe("maskOffPlatformContact", () => {
  it("masks identifiers and keeps the rest of the message", () => {
    const text = "Thanks! Email john@factory.com or WhatsApp +86 138 1234 5678 for faster replies.";
    const masked = maskOffPlatformContact(text);
    expect(masked).not.toContain("john@factory.com");
    expect(masked).not.toContain("1234 5678");
    expect(masked.startsWith("Thanks! Email ")).toBe(true);
    expect(masked).toContain(OFF_PLATFORM_MASK);
    expect(masked.endsWith("for faster replies.")).toBe(true);
  });

  it("leaves phrasing-only flags readable", () => {
    const text = "Can you pay me directly?";
    expect(kinds(text)).toContain("off_platform_payment");
    expect(maskOffPlatformContact(text)).toBe(text);
  });

  it("merges overlapping spans into one mask", () => {
    const masked = maskOffPlatformContact("WeChat: amy_88 / +86 13812345678");
    expect(masked).not.toMatch(/amy_88|13812345678/);
  });

  it("returns the text unchanged when nothing is found", () => {
    expect(maskOffPlatformContact("Sample looks great, approved.")).toBe("Sample looks great, approved.");
  });
});
