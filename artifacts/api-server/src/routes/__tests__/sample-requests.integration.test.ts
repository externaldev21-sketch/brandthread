import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, manufacturerProducts, manufacturers, sellerQuoteRequests } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = auth.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

vi.mock("../../lib/brandthreadEmail", () => ({
  sendManufacturerSignupEmail: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      return `https://objects.test${path}`;
    }
  },
}));

let sellerHubServer: Server;
let manufacturersServer: Server;
let sellerHubBase = "";
let manufacturersBase = "";
const prefix = `sample-requests-${crypto.randomBytes(8).toString("hex")}`;
const createdManufacturerIds: string[] = [];
const seller = `${prefix}-seller`;

async function request(base: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedManufacturer(clerkId: string | null, overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    clerkId,
    businessName: `${prefix}-factory-${createdManufacturerIds.length}`,
    country: "US",
    specialty: "Cut and sew",
    status: "active",
    isPublicDirectory: true,
    ...overrides,
  }).returning();
  createdManufacturerIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const { default: sellerHubRouter } = await import("../seller-hub");
  const { default: manufacturersRouter } = await import("../manufacturers");

  const sellerHubApp = express();
  sellerHubApp.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  sellerHubApp.use(express.json());
  sellerHubApp.use("/api/seller-hub", sellerHubRouter);
  await new Promise<void>((resolve) => {
    sellerHubServer = sellerHubApp.listen(0, "127.0.0.1", () => resolve());
  });
  sellerHubBase = `http://127.0.0.1:${(sellerHubServer.address() as AddressInfo).port}`;

  const manufacturersApp = express();
  manufacturersApp.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  manufacturersApp.use(express.json());
  manufacturersApp.use("/api/manufacturers", manufacturersRouter);
  await new Promise<void>((resolve) => {
    manufacturersServer = manufacturersApp.listen(0, "127.0.0.1", () => resolve());
  });
  manufacturersBase = `http://127.0.0.1:${(manufacturersServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdManufacturerIds.length) {
    const ids = createdManufacturerIds.splice(0);
    await db.delete(sellerQuoteRequests).where(inArray(sellerQuoteRequests.manufacturerId, ids));
    await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  }
  auth.userId = "";
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => sellerHubServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => manufacturersServer.close((error) => error ? reject(error) : resolve())),
  ]);
});


async function seedProduct(manufacturerId: string, overrides: Partial<typeof manufacturerProducts.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturerProducts).values({
    manufacturerId,
    name: "Heavyweight French Terry Crew",
    category: "Sweatshirts",
    images: ["https://cdn.test/crew.jpg"],
    samplePriceCents: 6500,
    samplePriceLabel: "$65 sample",
    customizationOptions: ["Woven label", "Embroidery"],
    status: "active",
    ...overrides,
  }).returning();
  return row;
}

const SHIP_TO = {
  recipientName: "Alex Rivera",
  street: "1226 University Dr",
  line2: "Unit 4",
  city: "Menlo Park",
  state: "CA",
  postalCode: "94025",
  country: "us",
};

function sampleBody(manufacturerId: string, extra: Record<string, unknown> = {}) {
  return {
    manufacturerId,
    type: "sample",
    productName: "Heavyweight French Terry Crew sample",
    productType: "Sweatshirts",
    quantity: 3,
    colorways: "Washed black",
    details: "Garment dyed if possible",
    ...extra,
  };
}

describe("sample requests from a manufacturer's catalog", () => {
  it("stores the catalog product, sizes, options and ship-to address", async () => {
    const mfr = await seedManufacturer(`${prefix}-mfr-a`);
    const product = await seedProduct(mfr.id);
    auth.userId = seller;

    const created = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      productId: product.id,
      sizes: ["M", " L ", "M"],
      options: ["Embroidery"],
      shipTo: { ...SHIP_TO, phone: "+1 650 555 0134" },
    }));
    expect(created.status).toBe(201);
    const row = await json<Record<string, any>>(created);
    expect(row.catalogProductId).toBe(product.id);
    expect(row.sizes).toBe("M, L");
    expect(row.sampleOptions).toEqual(["Embroidery"]);
    expect(row.shipTo).toEqual({ ...SHIP_TO, country: "US" });
    // No contact details travel with the address.
    expect(JSON.stringify(row.shipTo)).not.toContain("650");
  });

  it("keeps the free-form path working without any new fields", async () => {
    const mfr = await seedManufacturer(`${prefix}-mfr-b`);
    auth.userId = seller;
    const created = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      productName: "Hoodie sample", productType: "Hoodie",
    }));
    expect(created.status).toBe(201);
    const row = await json<Record<string, any>>(created);
    expect(row.catalogProductId).toBeNull();
    expect(row.shipTo).toBeNull();
    expect(row.sampleOptions).toBeNull();
  });

  it("rejects a product from another manufacturer, an inactive product, or a malformed id", async () => {
    const mfr = await seedManufacturer(`${prefix}-mfr-c`);
    const other = await seedManufacturer(`${prefix}-mfr-d`);
    const otherProduct = await seedProduct(other.id);
    const archived = await seedProduct(mfr.id, { status: "archived" });
    auth.userId = seller;

    for (const productId of [otherProduct.id, archived.id, "not-a-uuid", 42]) {
      const response = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, { productId }));
      expect(response.status).toBe(400);
    }
    const stored = await db.select().from(sellerQuoteRequests).where(inArray(sellerQuoteRequests.manufacturerId, [mfr.id]));
    expect(stored).toHaveLength(0);
  });

  it("rejects options the product does not offer, and options without a product", async () => {
    const mfr = await seedManufacturer(`${prefix}-mfr-e`);
    const product = await seedProduct(mfr.id);
    auth.userId = seller;

    const unknownOption = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      productId: product.id, options: ["Screen print"],
    }));
    expect(unknownOption.status).toBe(400);
    expect((await json<{ error: string }>(unknownOption)).error).toContain("Screen print");

    const noProduct = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      options: ["Embroidery"],
    }));
    expect(noProduct.status).toBe(400);
  });

  it.each([
    ["not an object", "1226 University Dr"],
    ["missing street", { ...SHIP_TO, street: "  " }],
    ["missing recipient", { ...SHIP_TO, recipientName: undefined }],
    ["bad country", { ...SHIP_TO, country: "USA" }],
    ["bad postal code", { ...SHIP_TO, postalCode: "!!" }],
    ["too long", { ...SHIP_TO, city: "x".repeat(200) }],
    ["array", [SHIP_TO]],
  ])("rejects a ship-to address that is %s", async (_label, shipTo) => {
    const mfr = await seedManufacturer(`${prefix}-mfr-f`);
    auth.userId = seller;
    const response = await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, { shipTo }));
    expect(response.status).toBe(400);
  });

  it("shows the manufacturer the product, options, sizes and ship-to in the portal inbox", async () => {
    const mfrClerk = `${prefix}-mfr-portal`;
    const mfr = await seedManufacturer(mfrClerk);
    const product = await seedProduct(mfr.id);
    auth.userId = seller;
    await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      productId: product.id, sizes: "S, M", options: ["Woven label"], shipTo: SHIP_TO,
    }));
    await request(sellerHubBase, "/api/seller-hub/quote-requests", "POST", sampleBody(mfr.id, {
      productName: "Custom tote sample", productType: "Custom",
    }));

    auth.userId = mfrClerk;
    const inbox = await request(manufacturersBase, "/api/manufacturers/me/quote-requests");
    expect(inbox.status).toBe(200);
    const rows = await json<Array<Record<string, any>>>(inbox);
    expect(rows).toHaveLength(2);
    const fromCatalog = rows.find((row) => row.catalogProductId === product.id)!;
    expect(fromCatalog.catalogProduct).toEqual({
      id: product.id,
      name: "Heavyweight French Terry Crew",
      imageUrl: "https://cdn.test/crew.jpg",
      samplePriceCents: 6500,
      samplePriceLabel: "$65 sample",
    });
    expect(fromCatalog.sizes).toBe("S, M");
    expect(fromCatalog.sampleOptions).toEqual(["Woven label"]);
    expect(fromCatalog.shipTo).toMatchObject({ recipientName: "Alex Rivera", postalCode: "94025", country: "US" });
    const freeForm = rows.find((row) => row.productName === "Custom tote sample")!;
    expect(freeForm.catalogProduct).toBeNull();
    expect(freeForm.shipTo).toBeNull();
  });
});
