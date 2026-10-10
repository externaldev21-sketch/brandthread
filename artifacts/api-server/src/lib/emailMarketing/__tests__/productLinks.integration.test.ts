/** Email product tiles link to the product and show a public photo (BT-314/327). */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, products, productVariants, users } from "@workspace/db";
import { loadRenderProducts } from "../sender";
import { emailLink, renderCampaign } from "../render";

const sfx = crypto.randomBytes(4).toString("hex");
const seller = `em-${sfx}`;
let liveId = "";
let draftId = "";

beforeAll(async () => {
  await db.insert(users).values({ clerkId: seller, email: `${seller}@example.test`, name: "S", username: `em_${sfx}`, accountType: "seller", onboardingComplete: true });
  const [live] = await db.insert(products).values({ ownerId: seller, name: "Aurora Hoodie", status: "active", images: ["/objects/uploads/aurora"] }).returning();
  const [draft] = await db.insert(products).values({ ownerId: seller, name: "Draft", status: "draft", images: ["https://cdn.example.test/d.jpg"] }).returning();
  liveId = live.id;
  draftId = draft.id;
  await db.insert(productVariants).values({ productId: liveId, sku: `em-${sfx}`, priceCents: 4500 });
});

afterAll(async () => {
  await db.delete(products).where(eq(products.ownerId, seller));
  await db.delete(users).where(eq(users.clerkId, seller));
});

describe("email product tiles (BT-327)", () => {
  it("loads the product page and a public https photo for each tile", async () => {
    const [live, draft] = await loadRenderProducts(seller, [liveId, draftId]);
    expect(live).toMatchObject({
      name: "Aurora Hoodie", priceCents: 4500,
      url: `https://brandthread.app/store/product/${liveId}`,
      imageUrl: `https://brandthread.app/api/v1/public/media/products/${liveId}/0`,
    });
    expect(draft.url).toBeNull(); // not public: the tile falls back to the store
  });

  it("links each tile to its product with email UTM tags, in html and text", async () => {
    const tiles = await loadRenderProducts(seller, [liveId, draftId]);
    const { html, text } = renderCampaign({
      storeName: "Northline", subject: "s", preheader: "p",
      body: { headline: "New in", text: null, imageUrl: null, productIds: [liveId, draftId], cta: null } as any,
      products: tiles, storeUrl: "https://brandthread.app/store/northline", postalAddress: "1 Main St", unsubscribeUrl: "https://x/u", campaignId: "cmp-1",
    });
    const productHref = `https://brandthread.app/store/product/${liveId}?utm_source=brandthread_email&amp;utm_medium=email&amp;utm_campaign=cmp-1`;
    expect(html).toContain(`href="${productHref}"`);
    expect(html).toContain(`href="https://brandthread.app/store/northline?utm_source=brandthread_email&amp;utm_medium=email&amp;utm_campaign=cmp-1"`);
    expect(html).toContain(`src="https://brandthread.app/api/v1/public/media/products/${liveId}/0"`);
    expect(text).toContain(`Aurora Hoodie - $45.00: https://brandthread.app/store/product/${liveId}?utm_source=brandthread_email`);
  });

  it("leaves a tile unlinked only when there is neither a product page nor a store", () => {
    const { html } = renderCampaign({
      storeName: "N", subject: "s", preheader: "p", body: { headline: null, text: null, imageUrl: null, productIds: [], cta: null } as any,
      products: [{ id: "1", name: "Tee", imageUrl: null, priceCents: null, url: null }],
      storeUrl: null, postalAddress: null, unsubscribeUrl: null,
    });
    expect(html).toContain("<a style=");
    expect(emailLink("not a url", "c")).toBe("not a url");
  });
});
