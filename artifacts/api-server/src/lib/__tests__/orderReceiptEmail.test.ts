import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { proxyMock, listConnectionsMock } = vi.hoisted(() => ({
  proxyMock: vi.fn(),
  listConnectionsMock: vi.fn(),
}));

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    proxy = proxyMock;
    listConnections = listConnectionsMock;
  },
}));

import {
  renderOrderReceiptHtml,
  renderOrderReceiptSubject,
  renderOrderReceiptText,
  sendOrderConfirmationEmail,
  sendOrderShippingEmail,
  sendReturnStatusEmail,
  type OrderReceiptInput,
} from "../brandthreadEmail";
import { storeBrandingFromRow } from "../orderReceipt";

const sample: OrderReceiptInput = {
  orderNumber: "BT-00042",
  items: [
    {
      productName: "Chrome Logo Tee",
      variantLabel: "M / Black",
      quantity: 2,
      priceCents: 3_500,
      imageUrl: "https://cdn.example.com/tee.jpg",
    },
    { productName: "Silver Cap", variantLabel: null, quantity: 1, priceCents: 2_800, imageUrl: null },
  ],
  subtotalCents: 9_800,
  discountCents: 980,
  threadCashCents: 500,
  shippingCents: 795,
  taxCents: 812,
  totalCents: 9_927,
  store: { name: "Northbound Studio", logoUrl: "https://cdn.example.com/logo.png", contactEmail: "hello@northbound.example" },
  shippingAddress: {
    name: "Alex Rivera",
    street: "12 Mercer St",
    line2: "Apt 4",
    city: "New York",
    state: "NY",
    zip: "10013",
    country: "US",
  },
};

beforeEach(() => {
  proxyMock.mockReset();
  listConnectionsMock.mockReset();
  listConnectionsMock.mockResolvedValue([]);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("MAIL_FROM", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("seller-branded order receipt", () => {
  it("shows the seller's logo and name, the order number and the Shopify section order", () => {
    const html = renderOrderReceiptHtml(sample);
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('alt="Northbound Studio"');
    expect(html).toContain("Order #BT-00042");
    const order = [
      "Thank you for your purchase!",
      "View your order",
      "Order summary",
      "Subtotal",
      "Total",
      "Customer information",
      "Sold by Northbound Studio on Brandthread",
    ].map((needle) => html.indexOf(needle));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('href="https://brandthread.app/orders"');
  });

  it("lists every line item with thumbnail, variant, quantity and line price", () => {
    const html = renderOrderReceiptHtml(sample);
    expect(html).toContain("Chrome Logo Tee &times;&nbsp;2");
    expect(html).toContain("M / Black");
    expect(html).toContain("$70.00");
    expect(html).toContain("$35.00 each");
    expect(html).toContain('src="https://cdn.example.com/tee.jpg"');
    expect(html).toContain("Silver Cap &times;&nbsp;1");
    expect(html).toContain("$28.00");
  });

  it("formats every total from the order cents and the total matches the order row", () => {
    const html = renderOrderReceiptHtml(sample);
    expect(html).toContain("$98.00"); // subtotal
    expect(html).toContain("-$9.80"); // discount
    expect(html).toContain("-$5.00"); // Thread Cash
    expect(html).toContain("$7.95"); // shipping
    expect(html).toContain("$8.12"); // taxes
    expect(html).toContain("$99.27"); // total
    // The rows add up to the stored total.
    expect(9_800 - 980 - 500 + 795 + 812).toBe(sample.totalCents);
    for (const label of ["Discount", "Thread Cash", "Shipping", "Taxes"]) expect(html).toContain(`>${label}<`);
  });

  it("omits rows that are zero and sections with no data", () => {
    const html = renderOrderReceiptHtml({
      orderNumber: "BT-1",
      items: [{ productName: "Tee", quantity: 1, priceCents: 2_000 }],
      subtotalCents: 2_000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      threadCashCents: 0,
      giftCardCents: 0,
      totalCents: 2_000,
    });
    for (const label of ["Discount", "Thread Cash", "Gift card", "Shipping", "Taxes", "Duties"]) {
      expect(html).not.toContain(`>${label}<`);
    }
    expect(html).not.toContain("Customer information");
    expect(html).not.toContain("reply to this email");
    expect(html).toContain(">Subtotal<");
    expect(html).toContain(">Total<");
  });

  it("shows a gift card row when one paid part of the order", () => {
    const html = renderOrderReceiptHtml({ ...sample, giftCardCents: 1_000, totalCents: 8_927 });
    expect(html).toContain(">Gift card<");
    expect(html).toContain("-$10.00");
    expect(html).toContain("$89.27");
  });

  it("escapes HTML in product names, variants, store name and address", () => {
    const html = renderOrderReceiptHtml({
      ...sample,
      items: [{ productName: '<script>alert(1)</script> "Tee"', variantLabel: "<b>XL</b>", quantity: 1, priceCents: 100 }],
      store: { name: "<img src=x onerror=alert(1)>", contactEmail: null },
      shippingAddress: { ...sample.shippingAddress!, name: "<i>Alex</i>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>XL</b>");
    expect(html).not.toContain("<i>Alex</i>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;Tee&quot;");
    expect(html).toContain("&lt;b&gt;XL&lt;/b&gt;");
  });

  it("drops non-https images and falls back to the store name, then the Brandthread mark", () => {
    const withName = renderOrderReceiptHtml({
      ...sample,
      store: { name: "Northbound Studio", logoUrl: "/objects/uploads/logo.png" },
      items: [{ productName: "Tee", quantity: 1, priceCents: 100, imageUrl: "javascript:alert(1)" }],
    });
    expect(withName).not.toContain("/objects/uploads/logo.png");
    expect(withName).not.toContain("javascript:");
    expect(withName).toContain(">Northbound Studio</span>");

    const noStore = renderOrderReceiptHtml({ ...sample, store: null });
    expect(noStore).toContain('src="cid:brandthread-logo"');
    expect(noStore).toContain("Sold on Brandthread");
  });

  it("is bulletproof email HTML: tables, inline styles, max width 600, dark-mode aware", () => {
    const html = renderOrderReceiptHtml(sample);
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:560px");
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).not.toMatch(/<div[^>]*display:flex/);
    expect(html).not.toContain("#3b82f6");
  });

  it("renders a plain-text alternative with the same amounts", () => {
    const text = renderOrderReceiptText(sample);
    expect(text).toContain("Northbound Studio");
    expect(text).toContain("Order #BT-00042");
    expect(text).toContain("Chrome Logo Tee x 2  $70.00");
    expect(text).toContain("Thread Cash: -$5.00");
    expect(text).toContain("Total: $99.27");
    expect(text).toContain("12 Mercer St");
    expect(text).toContain("contact us at hello@northbound.example");
    expect(text).not.toContain("<");
  });

  it("names the store in the subject, falling back to Brandthread", () => {
    expect(renderOrderReceiptSubject(sample)).toBe("Order BT-00042 confirmed - Northbound Studio");
    expect(renderOrderReceiptSubject({ orderNumber: "BT-1", store: null })).toBe("Brandthread order BT-1 confirmed");
  });

  it("sends html + text with the seller as reply-to under the per-order idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendOrderConfirmationEmail({ ...sample, to: "buyer@example.com", idempotencyKey: "order-confirmation/o-1" }))
      .resolves.toBe(true);
    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(request.headers["Idempotency-Key"]).toBe("order-confirmation/o-1");
    expect(body.reply_to).toBe("hello@northbound.example");
    expect(body.text).toContain("Total: $99.27");
    expect(body.html).toContain("Thank you for your purchase!");
    // Seller logo present: no Brandthread inline attachment needed.
    expect(body.attachments).toBeUndefined();
  });

  it("never sends an invalid reply-to (Resend would reject the whole email)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    await sendOrderConfirmationEmail({
      ...sample,
      store: { name: "S", contactEmail: "not an email" },
      to: "buyer@example.com",
      idempotencyKey: "order-confirmation/o-2",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reply_to).toBeUndefined();
    expect(body.html).not.toContain("not an email");
  });

  it("renders byte-identical payloads for a repeat send, so Resend's idempotency key dedupes it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    const send = () => sendOrderConfirmationEmail({ ...sample, to: "buyer@example.com", idempotencyKey: "order-confirmation/o-3" });
    await send();
    await send();
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init);
    expect(first.headers["Idempotency-Key"]).toBe(second.headers["Idempotency-Key"]);
    expect(first.body).toBe(second.body);
  });

  it("puts the store name and logo in the shipping and return email header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    await sendOrderShippingEmail({
      to: "buyer@example.com",
      orderNumber: "BT-1",
      store: { name: "Northbound Studio", logoUrl: "https://cdn.example.com/logo.png" },
      idempotencyKey: "order-shipped/o-1",
    });
    await sendReturnStatusEmail({
      to: "buyer@example.com",
      orderNumber: "BT-1",
      status: "refunded",
      refundAmountCents: 500,
      store: { name: "Northbound Studio" },
      idempotencyKey: "return-status/r-1/refunded",
    });
    const [shipping, returned] = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).html as string);
    expect(shipping).toContain('src="https://cdn.example.com/logo.png"');
    expect(shipping).toContain(">Northbound Studio</div>");
    expect(shipping).not.toContain(">BRANDTHREAD</div>");
    // No store logo: keeps the Brandthread mark, store name replaces the label.
    expect(returned).toContain('src="cid:brandthread-logo"');
    expect(returned).toContain(">Northbound Studio</div>");
  });
});

describe("storeBrandingFromRow", () => {
  const base = { brandName: null, displayName: null, name: null, logoUrl: null, profileImageUrl: null, contactEmail: null };

  it("prefers brand name, then display name, then name", () => {
    expect(storeBrandingFromRow({ ...base, brandName: " Brand ", displayName: "Disp", name: "N" })?.name).toBe("Brand");
    expect(storeBrandingFromRow({ ...base, displayName: "Disp", name: "N" })?.name).toBe("Disp");
    expect(storeBrandingFromRow({ ...base, name: "N" })?.name).toBe("N");
    expect(storeBrandingFromRow({ ...base })).toBeNull();
    expect(storeBrandingFromRow(undefined)).toBeNull();
  });

  it("keeps only https logos, logo before profile image", () => {
    expect(storeBrandingFromRow({ ...base, name: "N", logoUrl: "/objects/a", profileImageUrl: "https://x/p.png" })?.logoUrl)
      .toBe("https://x/p.png");
    expect(storeBrandingFromRow({ ...base, name: "N", logoUrl: "https://x/l.png", profileImageUrl: "https://x/p.png" })?.logoUrl)
      .toBe("https://x/l.png");
    expect(storeBrandingFromRow({ ...base, name: "N", logoUrl: "http://x/l.png" })?.logoUrl).toBeNull();
  });
});
