/**
 * QA-0080/0081: the Brandthread subdomain is claimed server-side (the
 * storefront slug), validated, unique case-insensitively, and reported as
 * 'active' by the server — never self-marked verified by the client.
 * QA-0163: PUT /api/store must not wipe description / branding.tagline /
 * seo.keywords when the client omits them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  ownerId: "seller-1",
  tables: { storefronts: [] as Row[], users: [] as Row[] },
  failNextUpdateWithUniqueViolation: false,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  desc: (v: unknown) => v,
  inArray: (col: unknown, vals: unknown) => ({ op: "in", col, vals }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "lowerEq", col: values[0], val: values[1] }),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) =>
    new Proxy({ __table: name } as Record<string, unknown>, {
      get: (target, key) => (key === "__table" ? target.__table : String(key)),
    });
  const matches = (row: Row, cond: any): boolean => {
    if (!cond) return true;
    if (cond.op === "and") return cond.conds.every((c: unknown) => matches(row, c));
    if (cond.op === "eq") return row[cond.col] === cond.val;
    if (cond.op === "lowerEq") return String(row[cond.col]).toLowerCase() === cond.val;
    if (cond.op === "isNull") return row[cond.col] == null;
    return true;
  };
  const rowsOf = (t: any): Row[] => (state.tables as any)[t.__table] ?? [];
  const db = {
    select: (fields?: Record<string, string>) => ({
      from: (t: any) => ({
        where: (cond: unknown) => ({
          limit: async (n: number) =>
            rowsOf(t)
              .filter(r => matches(r, cond))
              .slice(0, n)
              .map(r => (fields ? Object.fromEntries(Object.entries(fields).map(([k, col]) => [k, r[col]])) : { ...r })),
        }),
      }),
    }),
    insert: (t: any) => ({
      values: (v: Row) => ({
        returning: async () => {
          const row = { id: `sf-${rowsOf(t).length + 1}`, ...v };
          rowsOf(t).push(row);
          return [row];
        },
      }),
    }),
    update: (t: any) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            if (state.failNextUpdateWithUniqueViolation) {
              state.failNextUpdateWithUniqueViolation = false;
              throw Object.assign(new Error("duplicate key"), { code: "23505" });
            }
            const hit = rowsOf(t).filter(r => matches(r, cond));
            hit.forEach(r => Object.assign(r, patch));
            return hit.map(r => ({ ...r }));
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return {
    db,
    storefronts: table("storefronts"),
    storefrontVersions: table("storefrontVersions"),
    storefrontCustomDomains: table("storefrontCustomDomains"),
    products: table("products"),
    productVariants: table("productVariants"),
    users: table("users"),
  };
});

import storeRouter from "../store";

let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/store${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

function mySf(): Row {
  return state.tables.storefronts.find(r => r.ownerId === state.ownerId)!;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).clerkUserId = state.ownerId; next(); });
  app.use("/api/store", storeRouter);
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  state.failNextUpdateWithUniqueViolation = false;
  state.tables.storefronts = [
    {
      id: "sf-mine", ownerId: "seller-1", slug: "store-1a2b3c4d", title: "My Store",
      description: "Hand-dyed knitwear.", subdomainClaimedAt: null,
      branding: { tagline: "Slow fashion", logoUrl: "", targetAudience: "makers" },
      seo: { metaTitle: "Old", metaDescription: "Old", keywords: ["knit"] },
      theme: {}, sections: [],
    },
    { id: "sf-other", ownerId: "seller-2", slug: "taken-name", title: "Other", subdomainClaimedAt: new Date("2026-01-01") },
  ];
  state.tables.users = [{ clerkId: "seller-1", username: "Atelier_Noire", brandName: "Noire Studio" }];
});

describe("GET /api/store/subdomain", () => {
  it("reports an unclaimed subdomain with a suggestion from the seller handle", async () => {
    const r = await call("GET", "/subdomain");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      subdomain: null, status: "unclaimed", assignedSlug: "store-1a2b3c4d",
      suggestion: "atelier-noire", url: null,
    });
  });

  it("skips a suggestion another store already owns", async () => {
    state.tables.storefronts[1].slug = "Atelier-Noire";
    const r = await call("GET", "/subdomain");
    expect(r.body.suggestion).toBe("noire-studio");
  });

  it("reports a claimed subdomain as active", async () => {
    Object.assign(mySf(), { slug: "noire", subdomainClaimedAt: new Date("2026-05-01T00:00:00Z") });
    const r = await call("GET", "/subdomain");
    expect(r.body).toMatchObject({
      subdomain: "noire", status: "active", suggestion: null,
      url: "https://noire.brandthread.app", claimedAt: "2026-05-01T00:00:00.000Z",
    });
  });
});

describe("GET /api/store/subdomain/availability", () => {
  it.each([
    ["-noire", "hyphen_edge"],
    ["ab", "too_short"],
    ["no ire", "invalid_characters"],
    ["www", "reserved"],
    ["Brandthread", "reserved"],
  ])("rejects %s (%s)", async (name, reason) => {
    const r = await call("GET", `/subdomain/availability?name=${encodeURIComponent(name)}`);
    expect(r.body).toMatchObject({ available: false, reason });
  });

  it("is case-insensitive when checking for a taken name", async () => {
    const r = await call("GET", "/subdomain/availability?name=TAKEN-NAME");
    expect(r.body).toMatchObject({ subdomain: "taken-name", available: false, reason: "taken" });
  });

  it("treats the seller's own slug as available", async () => {
    const r = await call("GET", "/subdomain/availability?name=store-1a2b3c4d");
    expect(r.body).toMatchObject({ available: true });
  });
});

describe("PUT /api/store/subdomain", () => {
  it("400s on an invalid name and leaves the slug alone", async () => {
    const r = await call("PUT", "/subdomain", { subdomain: "api" });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe("reserved");
    expect(mySf().slug).toBe("store-1a2b3c4d");
  });

  it("409s when another store owns the name (any case)", async () => {
    const r = await call("PUT", "/subdomain", { subdomain: "Taken-Name" });
    expect(r.status).toBe(409);
    expect(mySf().slug).toBe("store-1a2b3c4d");
  });

  it("claims the lowercased name and reports it active", async () => {
    const r = await call("PUT", "/subdomain", { subdomain: "  Noire-Studio " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ subdomain: "noire-studio", status: "active", url: "https://noire-studio.brandthread.app" });
    expect(mySf().slug).toBe("noire-studio");
    expect(mySf().subdomainClaimedAt).toBeInstanceOf(Date);
  });

  it("409s when a concurrent claim wins the unique index", async () => {
    state.failNextUpdateWithUniqueViolation = true;
    const r = await call("PUT", "/subdomain", { subdomain: "noire" });
    expect(r.status).toBe(409);
  });
});

describe("PUT /api/store (storefront sync)", () => {
  it("merges partial branding / seo and leaves omitted description alone", async () => {
    const r = await call("PUT", "/", {
      title: "Noire",
      branding: { logoUrl: "https://cdn/logo.png" },
      seo: { metaTitle: "New", metaDescription: "New desc" },
    });
    expect(r.status).toBe(200);
    const sf = mySf();
    expect(sf.title).toBe("Noire");
    expect(sf.description).toBe("Hand-dyed knitwear.");
    expect(sf.branding).toEqual({ tagline: "Slow fashion", logoUrl: "https://cdn/logo.png", targetAudience: "makers" });
    expect(sf.seo).toEqual({ metaTitle: "New", metaDescription: "New desc", keywords: ["knit"] });
  });
});
