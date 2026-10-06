/**
 * Add product → Save (signed in) mirrors the product POST /api/products just
 * created into the local product store under the SERVER's id, so product
 * detail (/product-detail?id=<server id>) and the Products tab can show it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));
vi.mock("@/lib/serviceConfig", () => ({ serviceRequest: vi.fn() }));
vi.mock("@/lib/devPreview", () => ({ isPreviewDemoMode: () => false }));

import { createProduct, getProduct, getProducts, initProductService } from "../productService";

describe("createProduct with a server-assigned id", () => {
  beforeEach(() => {
    storage.clear();
    initProductService(`server-id-user-${Math.random()}`);
  });

  it("is readable by that id (what product detail looks up after Save)", async () => {
    const saved = await createProduct({ name: "Ribbed Knit Beanie", status: "draft" }, { id: "b1f0c2a4-srv" });
    expect(saved.id).toBe("b1f0c2a4-srv");
    expect((await getProduct("b1f0c2a4-srv"))?.name).toBe("Ribbed Knit Beanie");
    expect((await getProducts()).map((p) => p.id)).toEqual(["b1f0c2a4-srv"]);
  });

  it("replaces rather than duplicates an existing row with the same id", async () => {
    await createProduct({ name: "First" }, { id: "same" });
    await createProduct({ name: "Second" }, { id: "same" });
    const all = await getProducts();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Second");
  });

  it("still mints a local id when none is given", async () => {
    const saved = await createProduct({ name: "Local" });
    expect(saved.id).toMatch(/^prod_/);
  });
});
