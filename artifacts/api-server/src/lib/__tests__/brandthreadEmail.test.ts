import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOrderConfirmationEligibleStatus,
  renderBrandthreadEmail,
  sendBrandthreadEmail,
  sendManufacturerSignupEmail,
  sendOrderConfirmationEmail,
  sendOrderShippingEmail,
  sendReturnStatusEmail,
  sendTeamInviteEmail,
  sendWelcomeEmail,
} from "../brandthreadEmail";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Brandthread transactional email", () => {
  it("never confirms orders that are being refunded or are cancelled", () => {
    expect(isOrderConfirmationEligibleStatus("pending")).toBe(true);
    expect(isOrderConfirmationEligibleStatus("shipped")).toBe(true);
    expect(isOrderConfirmationEligibleStatus("refund_pending")).toBe(false);
    expect(isOrderConfirmationEligibleStatus("cancelled")).toBe(false);
  });

  it("renders the canonical logo and chrome, black, and white brand frame", () => {
    const html = renderBrandthreadEmail({
      preheader: "A short preview",
      eyebrow: "Order confirmed",
      title: "Thanks for your order",
      bodyHtml: "<p>Your order is ready.</p>",
    });

    expect(html).toContain('src="cid:brandthread-logo"');
    expect(html).toContain("linear-gradient(135deg,#050505");
    expect(html).toContain("background:#ffffff");
    expect(html).toContain("max-width:620px");
    expect(html).toContain('alt="Brandthread"');
  });

  it("escapes recipient-facing content and links", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    await sendReturnStatusEmail({
      to: "buyer@example.com",
      orderNumber: 'BT-1"><script>alert(1)</script>',
      status: "denied",
      sellerResponse: "<img src=x onerror=alert(1)>",
      idempotencyKey: "return-status/1/denied",
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.html).not.toContain("<script>");
    expect(body.html).not.toContain("<img src=x");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("uses one branded frame for every transactional email type", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    await sendWelcomeEmail({
      to: "buyer@example.com",
      name: "Alex",
      accountType: "buyer",
      idempotencyKey: "welcome/user-1",
    });
    await sendOrderConfirmationEmail({
      to: "buyer@example.com",
      orderNumber: "BT-00001",
      items: [{ productName: "Chrome Tee", quantity: 2, priceCents: 2500 }],
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
      idempotencyKey: "order-confirmation/order-1",
    });
    await sendOrderShippingEmail({
      to: "buyer@example.com",
      orderNumber: "BT-00001",
      carrier: "UPS",
      trackingNumber: "1Z999",
      idempotencyKey: "order-shipped/order-1",
    });
    await sendOrderShippingEmail({
      to: "buyer@example.com",
      orderNumber: "BT-00001",
      carrier: "UPS",
      trackingNumber: "1Z999",
      trackingUpdate: true,
      idempotencyKey: "order-tracking/order-1/fingerprint",
    });
    await sendReturnStatusEmail({
      to: "buyer@example.com",
      orderNumber: "BT-00001",
      status: "refunded",
      refundAmountCents: 5000,
      idempotencyKey: "return-status/return-1/refunded",
    });
    await sendManufacturerSignupEmail({
      to: "factory@example.com",
      businessName: "North Factory",
      idempotencyKey: "manufacturer-signup/manufacturer-1",
    });
    await sendTeamInviteEmail({
      to: "member@example.com",
      ownerName: "Studio One",
      role: "staff",
      inviteUrl: "https://brandthread.app/team-invite?token=one",
      idempotencyKey: "team-invite/invite-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    for (const [, request] of fetchMock.mock.calls) {
      const body = JSON.parse(request.body);
      expect(body.html).toContain('src="cid:brandthread-logo"');
      expect(body.html).toContain("linear-gradient(135deg,#050505");
      expect(body.from).toContain("Brandthread");
      expect(body.attachments).toEqual([
        expect.objectContaining({
          filename: "brandthread-logo.png",
          content_id: "brandthread-logo",
        }),
      ]);
      expect(body.attachments[0].content).toMatch(/^iVBOR/);
    }
  });

  it("passes stable idempotency keys to Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendBrandthreadEmail({
      to: "buyer@example.com",
      subject: "Order confirmed",
      html: "<p>Confirmed</p>",
      idempotencyKey: "order-confirmation/order-1",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "order-confirmation/order-1",
        }),
      }),
    );
  });

  it("does not throw when configuration is missing or Resend rejects a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendBrandthreadEmail({
      to: "buyer@example.com",
      subject: "Welcome",
      html: "<p>Welcome</p>",
    })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("RESEND_API_KEY", "test-key");
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(sendBrandthreadEmail({
      to: "buyer@example.com",
      subject: "Welcome",
      html: "<p>Welcome</p>",
    })).resolves.toBe(false);
  });
});