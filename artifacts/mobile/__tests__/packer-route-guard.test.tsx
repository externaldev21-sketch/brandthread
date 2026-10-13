import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "packer" as string,
  segments: ["(tabs)", "orders"] as string[],
  signedIn: true,
  preview: false,
  contextCalls: 0,
  replace: vi.fn(),
}));

vi.mock("react-native", () => {
  const React = require("react") as typeof import("react");
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };
  return {
    ActivityIndicator: nativeComponent("ActivityIndicator"),
    Alert: { alert: vi.fn() },
    Modal: nativeComponent("Modal"),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: nativeComponent("Text"),
    TouchableOpacity: nativeComponent("TouchableOpacity"),
    View: nativeComponent("View"),
  };
});
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { setItem: vi.fn(), getItem: vi.fn() } }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
  useSegments: () => state.segments,
  useGlobalSearchParams: () => ({}),
}));
vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: state.signedIn, userId: "user_1" }),
}));
vi.mock("@/lib/devPreview", () => ({ isSellerDevPreview: () => state.preview, isPreviewDemoMode: () => false }));
vi.mock("@/lib/api", () => {
  const api = {
    team: {
      context: vi.fn(async () => { state.contextCalls += 1; return { role: state.role }; }),
      myMemberships: vi.fn(async () => ({ memberships: [] })),
    },
  };
  return {
    useApi: () => api,
    subscribeStoreContext: () => () => {},
    getStoreContext: () => null,
    setStoreContext: vi.fn(),
    storeContextStorageKey: (id: string) => id,
  };
});
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ background: "bg" }) }));
vi.mock("@/hooks/useHeaderTopInset", () => ({ useHeaderTopInset: () => 0 }));
vi.mock("@/lib/theme", () => ({
  BG: "bg", BORDER: "b", CARD: "c", FONT: {}, FS: {}, FG: "fg", MUTED: "m", SP: {}, RADIUS: {},
}));
vi.mock("@/contexts/AppThemeContext", () => ({ useAppTheme: () => ({ theme: {} }) }));
vi.mock("@/components/ScreenHeader", () => ({
  ScreenHeader: ({ title }: { title: string }) => React.createElement("ScreenHeader", { title }),
}));
vi.mock("@/components/RoleLockedView", () => ({
  RoleLockedView: (props: { currentRole?: string }) => React.createElement("RoleLockedView", props),
}));

import PackerRouteGuard, { packerRouteDecision } from "../components/PackerRouteGuard";

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PackerRouteGuard />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

const locked = (r: ReactTestRenderer) => r.root.findAll((n) => n.props?.testID === "packer-route-locked").length > 0;

beforeEach(() => {
  state.role = "packer";
  state.segments = ["(tabs)", "orders"];
  state.signedIn = true;
  state.preview = false;
  state.contextCalls = 0;
  state.replace.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("packerRouteDecision", () => {
  it("allows order work", () => {
    for (const s of [["(tabs)", "orders"], ["(tabs)", "more"], ["order-detail"], ["fulfill-order"], ["fulfill-batch"], ["shipping-label"], ["orders"]]) {
      expect(packerRouteDecision(s)).toBe("allow");
    }
  });
  it("sends Home to Orders", () => {
    expect(packerRouteDecision(["(tabs)"])).toBe("land-on-orders");
    expect(packerRouteDecision(["(tabs)", "index"])).toBe("land-on-orders");
  });
  it("locks every other seller screen", () => {
    for (const s of [["(tabs)", "products"], ["(tabs)", "analytics"], ["(tabs)", "marketing"], ["payouts"], ["customers"], ["store-settings"], ["team"], ["finance"]]) {
      expect(packerRouteDecision(s)).toBe("locked");
    }
  });
  it("leaves buyer, auth and invite routes alone", () => {
    for (const s of [["(buyer)", "index"], ["buyer-order-detail"], ["sign-in"], ["team-invite"], ["onboarding"]]) {
      expect(packerRouteDecision(s)).toBe("allow");
    }
  });
});

describe("PackerRouteGuard", () => {
  it("renders nothing on the Orders tab", async () => {
    const r = await render();
    expect(locked(r)).toBe(false);
  });

  it("shows the locked view on Products for a packer", async () => {
    state.segments = ["(tabs)", "products"];
    const r = await render();
    expect(locked(r)).toBe(true);
    expect(r.root.findByType("RoleLockedView" as any).props.currentRole).toBe("packer");
    expect(r.root.findByType("ScreenHeader" as any).props.title).toBe("Products");
  });

  it("lands a packer on Orders from Home", async () => {
    state.segments = ["(tabs)"];
    await render();
    expect(state.replace).toHaveBeenCalledWith("/(tabs)/orders");
  });

  it("does nothing for other roles", async () => {
    for (const role of ["owner", "admin", "orders", "viewer", "finance"]) {
      state.role = role;
      state.segments = ["(tabs)", "products"];
      const r = await render();
      expect(locked(r)).toBe(false);
    }
    state.segments = ["(tabs)"];
    state.role = "orders";
    await render();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("never calls the API signed out or in the signed-out seller preview", async () => {
    state.signedIn = false;
    await render();
    state.signedIn = true;
    state.preview = true;
    await render();
    expect(state.contextCalls).toBe(0);
  });
});
