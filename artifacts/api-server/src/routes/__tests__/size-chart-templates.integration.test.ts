import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, sizeChartTemplates } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/activityLog", () => ({ logActivity: () => undefined, reqActor: () => ({}) }));

let server: Server;
let base = "";
const prefix = `sizechart-${crypto.randomBytes(8).toString("hex")}`;
const seller = `${prefix}-seller`;
const other = `${prefix}-other`;
const productIds: string[] = [];
const templateIds: string[] = [];

const chart = { columns: ["Chest", "Length"], rows: [{ size: "S", values: ["36", "26"] }, { size: "M", values: ["38", "27"] }], unit: "inches" };

async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}/api/size-chart-templates${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
async function makeProduct(ownerId: string, sizeChart: unknown = null) {
  const [p] = await db.insert(products).values({ ownerId, name: `${prefix} tee`, sizeChart: sizeChart as any }).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

beforeAll(async () => {
  const { default: router } = await import("../size-chart-templates");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/size-chart-templates", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { auth.userId = seller; });
afterAll(async () => {
  if (templateIds.length) await db.delete(sizeChartTemplates).where(inArray(sizeChartTemplates.id, templateIds));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

describe("size chart templates", () => {
  it("requires auth", async () => {
    auth.userId = "";
    expect((await call("")).status).toBe(401);
  });

  it("creates, lists with presets, rejects duplicate names and invalid charts", async () => {
    auth.userId = seller;
    const created = await call("", "POST", { name: "Tees", chart });
    expect(created.status).toBe(201);
    templateIds.push(created.body.id);
    expect((await call("", "POST", { name: "tees", chart })).status).toBe(409);
    expect((await call("", "POST", { name: "Bad", chart: { columns: [], rows: [] } })).status).toBe(400);
    expect((await call("", "POST", { name: "", chart })).status).toBe(400);

    const list = await call("");
    expect(list.body.templates.map((t: any) => t.name)).toContain("Tees");
    expect(list.body.presets.length).toBeGreaterThan(0);
    auth.userId = other;
    expect((await call("")).body.templates).toHaveLength(0);
  });

  it("creates a template from a product's existing chart", async () => {
    const pid = await makeProduct(seller, chart);
    const res = await call("", "POST", { name: "From product", fromProductId: pid });
    expect(res.status).toBe(201);
    templateIds.push(res.body.id);
    expect(res.body.chart.rows).toHaveLength(2);
    const foreign = await makeProduct(other, chart);
    expect((await call("", "POST", { name: "Steal", fromProductId: foreign })).status).toBe(404);
  });

  it("applies to owned products only, then syncs after an edit", async () => {
    const t = await call("", "POST", { name: "Apply me", chart });
    templateIds.push(t.body.id);
    const a = await makeProduct(seller);
    const b = await makeProduct(seller);
    const foreign = await makeProduct(other);

    expect((await call(`/${t.body.id}/apply`, "POST", { productIds: [a, foreign] })).status).toBe(404);
    expect((await call(`/${t.body.id}/apply`, "POST", { productIds: [] })).status).toBe(400);
    expect((await call(`/${t.body.id}/apply`, "POST", { productIds: [a, b] })).body.applied).toBe(2);

    const [pa] = await db.select({ c: products.sizeChart }).from(products).where(eq(products.id, a));
    expect((pa.c as any).columns).toEqual(["Chest", "Length"]);

    const edited = await call(`/${t.body.id}`, "PUT", { convertTo: "cm" });
    expect(edited.body.chart.unit).toBe("cm");
    const [still] = await db.select({ c: products.sizeChart }).from(products).where(eq(products.id, a));
    expect((still.c as any).unit).toBe("inches");

    expect((await call(`/${t.body.id}/sync`, "POST")).body.synced).toBe(2);
    const [after] = await db.select({ c: products.sizeChart }).from(products).where(eq(products.id, b));
    expect((after.c as any).unit).toBe("cm");

    const detail = await call(`/${t.body.id}`);
    expect(detail.body.products).toHaveLength(2);
    expect((await call("")).body.templates.find((x: any) => x.id === t.body.id).productCount).toBe(2);

    auth.userId = other;
    expect((await call(`/${t.body.id}`)).status).toBe(404);
    expect((await call(`/${t.body.id}/sync`, "POST")).status).toBe(404);
    expect((await call(`/${t.body.id}`, "DELETE")).status).toBe(404);
  });

  it("deleting a template keeps the copied chart on products", async () => {
    const t = await call("", "POST", { name: "Temp", chart });
    const pid = await makeProduct(seller);
    await call(`/${t.body.id}/apply`, "POST", { productIds: [pid] });
    expect((await call(`/${t.body.id}`, "DELETE")).body.success).toBe(true);
    const [p] = await db.select({ c: products.sizeChart }).from(products).where(eq(products.id, pid));
    expect(p.c).not.toBeNull();
  });
});
