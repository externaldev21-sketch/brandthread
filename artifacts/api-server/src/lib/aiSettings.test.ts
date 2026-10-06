import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_ASSISTANT_SETTINGS,
  actionConfirmationReason,
  applyConfirmationPolicy,
  dataSourcePromptNote,
  mergeStricter,
  normalizeAiSettings,
  redactSnapshotForAi,
  sanitizeScreenContext,
  suggestionCategoryAllowed,
  type AiAssistantSettings,
} from "./aiSettings";

function settings(overrides: Partial<AiAssistantSettings> = {}, ds: Partial<AiAssistantSettings["dataSources"]> = {}): AiAssistantSettings {
  return {
    ...DEFAULT_AI_ASSISTANT_SETTINGS,
    ...overrides,
    dataSources: { ...DEFAULT_AI_ASSISTANT_SETTINGS.dataSources, ...ds },
  };
}

describe("normalizeAiSettings", () => {
  it("fills defaults for missing / non-boolean values and drops unknown keys", () => {
    const out = normalizeAiSettings({
      enabled: "no",
      suggestionsEnabled: false,
      dataSources: { customers: false, orders: 0, bogus: false },
      extra: 1,
    });
    expect(out.enabled).toBe(true);
    expect(out.suggestionsEnabled).toBe(false);
    expect(out.dataSources.customers).toBe(false);
    expect(out.dataSources.orders).toBe(true);
    expect(out).not.toHaveProperty("extra");
    expect(out.dataSources).not.toHaveProperty("bogus");
  });

  it("returns defaults for garbage input", () => {
    expect(normalizeAiSettings(null)).toEqual(DEFAULT_AI_ASSISTANT_SETTINGS);
    expect(normalizeAiSettings([1, 2])).toEqual(DEFAULT_AI_ASSISTANT_SETTINGS);
  });
});

describe("mergeStricter", () => {
  it("lets the client turn things off and add confirmations", () => {
    const stored = settings({ confirmSending: false });
    const out = mergeStricter(stored, {
      enabled: false,
      confirmSending: true,
      dataSources: { customers: false },
    });
    expect(out.enabled).toBe(false);
    expect(out.confirmSending).toBe(true);
    expect(out.dataSources.customers).toBe(false);
  });

  it("never lets the client re-enable something the account turned off", () => {
    const stored = settings({ enabled: false, brandMemoryEnabled: false, confirmDestructiveActions: true }, { customers: false });
    const out = mergeStricter(stored, {
      enabled: true,
      brandMemoryEnabled: true,
      confirmDestructiveActions: false,
      dataSources: { customers: true },
    });
    expect(out.enabled).toBe(false);
    expect(out.brandMemoryEnabled).toBe(false);
    expect(out.confirmDestructiveActions).toBe(true);
    expect(out.dataSources.customers).toBe(false);
  });

  it("does not mutate the stored settings", () => {
    const stored = settings();
    mergeStricter(stored, { dataSources: { orders: false } });
    expect(stored.dataSources.orders).toBe(true);
  });
});

describe("redactSnapshotForAi", () => {
  const snapshot = {
    snapshotAt: "2026-01-01T00:00:00.000Z",
    seller: { brandName: "X" },
    storefront: {}, shipping: {}, products: {}, inventory: {}, orders: {},
    revenue: {}, content: {}, customers: {}, conversations: {}, boosts: {},
    discountCodes: {}, manufacturerOrders: {},
  };

  it("keeps everything when all sources are on", () => {
    expect(Object.keys(redactSnapshotForAi(snapshot, settings())).sort()).toEqual(Object.keys(snapshot).sort());
  });

  it("drops customers and customer conversations when Customers is off", () => {
    const out = redactSnapshotForAi(snapshot, settings({}, { customers: false }));
    expect(out).not.toHaveProperty("customers");
    expect(out).not.toHaveProperty("conversations");
    expect(out).toHaveProperty("orders");
    expect(out).toHaveProperty("seller");
  });

  it("drops revenue when either Orders or Analytics is off", () => {
    expect(redactSnapshotForAi(snapshot, settings({}, { analytics: false }))).not.toHaveProperty("revenue");
    const noOrders = redactSnapshotForAi(snapshot, settings({}, { orders: false }));
    expect(noOrders).not.toHaveProperty("revenue");
    expect(noOrders).not.toHaveProperty("orders");
  });

  it("maps store, marketing, manufacturers, products, inventory and content", () => {
    const out = redactSnapshotForAi(snapshot, settings({}, {
      store: false, marketing: false, manufacturers: false, products: false, inventory: false, content: false,
    }));
    for (const k of ["storefront", "shipping", "boosts", "discountCodes", "manufacturerOrders", "products", "inventory", "content"]) {
      expect(out).not.toHaveProperty(k);
    }
    expect(out.snapshotAt).toBe(snapshot.snapshotAt);
  });
});

describe("sanitizeScreenContext", () => {
  it("strips customer details from an order when Customers is off", () => {
    const out = sanitizeScreenContext(
      { screen: "order_detail", orderNumber: "A-1", customerName: "Jane", status: "paid" },
      settings({}, { customers: false }),
    );
    expect(out).toEqual({ screen: "order_detail", orderNumber: "A-1", status: "paid" });
  });

  it("reduces the context to the screen name when that screen's source is off", () => {
    expect(sanitizeScreenContext({ screen: "customers", customerName: "Jane" }, settings({}, { customers: false })))
      .toEqual({ screen: "customers", restricted: true });
    expect(sanitizeScreenContext({ screen: "order_detail", orderNumber: "A-1" }, settings({}, { orders: false })))
      .toEqual({ screen: "order_detail", restricted: true });
  });

  it("strips stock from a product when Inventory is off", () => {
    expect(sanitizeScreenContext({ screen: "product_detail", productName: "Tee", inventory: 3 }, settings({}, { inventory: false })))
      .toEqual({ screen: "product_detail", productName: "Tee" });
  });
});

describe("actionConfirmationReason", () => {
  const all = settings();
  const none = settings({
    confirmSensitiveActions: false, confirmDestructiveActions: false, confirmPublishing: false, confirmSending: false,
  });

  it("classifies destructive, publishing, sending and sensitive actions", () => {
    expect(actionConfirmationReason({ type: "edit", title: "Delete product", isDestructive: true }, all)).toBe("destructive");
    expect(actionConfirmationReason({ type: "schedule", title: "Schedule post" }, all)).toBe("publishing");
    expect(actionConfirmationReason({ type: "apply", title: "Publish your store" }, all)).toBe("publishing");
    expect(actionConfirmationReason({ type: "create_draft", title: "Send win-back email" }, all)).toBe("sending");
    expect(actionConfirmationReason({ type: "edit", title: "Update price" }, all)).toBe("sensitive");
    expect(actionConfirmationReason({ type: "recommend", title: "Try a bundle" }, all)).toBeNull();
  });

  it("returns null for every class when the matching toggle is off", () => {
    expect(actionConfirmationReason({ type: "edit", title: "Delete product", isDestructive: true }, none)).toBeNull();
    expect(actionConfirmationReason({ type: "schedule", title: "Schedule post" }, none)).toBeNull();
    expect(actionConfirmationReason({ type: "create_draft", title: "Send email" }, none)).toBeNull();
    expect(actionConfirmationReason({ type: "edit", title: "Update price", requiresConfirmation: true }, none)).toBeNull();
  });

  it("falls through to the next applicable rule when one toggle is off", () => {
    const s = settings({ confirmDestructiveActions: false });
    expect(actionConfirmationReason({ type: "edit", title: "Delete product", isDestructive: true }, s)).toBe("sensitive");
  });

  it("applyConfirmationPolicy stamps requiresConfirmation from the rules, overriding the model", () => {
    expect(applyConfirmationPolicy({ type: "edit", title: "Update price", requiresConfirmation: false }, all).requiresConfirmation).toBe(true);
    expect(applyConfirmationPolicy({ type: "edit", title: "Update price", requiresConfirmation: true }, none).requiresConfirmation).toBe(false);
  });
});

describe("suggestionCategoryAllowed", () => {
  it("blocks every category when the assistant or suggestions are off", () => {
    expect(suggestionCategoryAllowed("orders", settings({ enabled: false }))).toBe(false);
    expect(suggestionCategoryAllowed("orders", settings({ suggestionsEnabled: false }))).toBe(false);
  });
  it("blocks a category whose data source is off", () => {
    expect(suggestionCategoryAllowed("inventory", settings({}, { inventory: false }))).toBe(false);
    expect(suggestionCategoryAllowed("production", settings({}, { manufacturers: false }))).toBe(false);
    expect(suggestionCategoryAllowed("orders", settings({}, { inventory: false }))).toBe(true);
  });
});

describe("dataSourcePromptNote", () => {
  it("is empty when nothing is off and names the off areas otherwise", () => {
    expect(dataSourcePromptNote(settings())).toBe("");
    expect(dataSourcePromptNote(settings({}, { customers: false }))).toMatch(/turned off AI access to: customers/);
  });
});
