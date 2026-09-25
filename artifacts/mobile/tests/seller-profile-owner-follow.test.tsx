import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Covers the seller-profile.tsx redesign: the Follow (non-owner) vs Edit
// Profile (owner) action branch, and Posts/Products tab switching, keep
// working after moving the hero into the shared BrandHero component.

const {
  routerMock,
  apiMock,
  followStateMock,
  setFollowingMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true), replace: vi.fn() },
  apiMock: {
    seller: { getProfile: vi.fn() },
    posts: { publicList: vi.fn() },
    publicSellers: { get: vi.fn(), recordVisit: vi.fn() },
    reviews: { forSeller: vi.fn() },
    social: { block: vi.fn() },
  },
  followStateMock: vi.fn(),
  setFollowingMock: vi.fn(),
  searchParamsMock: vi.fn(() => ({ id: "seller-9" })),
}));

vi.mock("react-native", () => {
  const React = require("react") as any;
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };
  class MockAnimatedValue {
    _value: number;
    constructor(value: number) { this._value = value; }
    interpolate() { return this._value; }
  }
  return {
    ActivityIndicator: nativeComponent("ActivityIndicator"),
    Alert: { alert: vi.fn() },
    Animated: {
      Value: MockAnimatedValue,
      View: nativeComponent("Animated.View"),
      ScrollView: nativeComponent("Animated.ScrollView"),
      event: () => () => {},
    },
    Dimensions: { get: () => ({ width: 375, height: 800 }) },
    Image: nativeComponent("Image"),
    Linking: { openURL: vi.fn() },
    Modal: nativeComponent("Modal"),
    Pressable: nativeComponent("Pressable"),
    RefreshControl: nativeComponent("RefreshControl"),
    ScrollView: nativeComponent("ScrollView"),
    Share: { share: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Text: nativeComponent("Text"),
    TouchableOpacity: nativeComponent("TouchableOpacity"),
    View: nativeComponent("View"),
  };
});

vi.mock("@/components/profile/BrandHero", () => ({
  BrandHero: ({ brandName, topBarLeft, topBarRight, actions, children }: any) =>
    React.createElement(
      "View",
      null,
      React.createElement("Text", { testID: "hero-brand-name" }, brandName),
      topBarLeft,
      topBarRight,
      actions,
      children,
    ),
  useBrandHeroScrollY: () => ({ interpolate: () => 0 }),
  HERO_COMPACT_THRESHOLD: 150,
}));

vi.mock("@/components/layout", () => ({
  GridSkeleton: () => React.createElement("View", { testID: "grid-skeleton" }),
  ResponsiveContainer: ({ children }: any) => React.createElement("View", null, children),
  useGridColumns: () => 2,
  useBreakpoint: () => ({ width: 375, height: 800, isTablet: false, isLandscape: false }),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, userId: "seller-1" }),
}));

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => React.createElement("Feather", { name }),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => searchParamsMock(),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => apiMock,
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#C7CDD5" }),
}));

vi.mock("@/contexts/AppThemeContext", () => ({
  useAppTheme: () => ({
    theme: {
      background: "#09090B", text: "#FAFAFA", muted: "#D7D7DB", border: "#FFFFFF22",
      card: "#18181B", surface: "#111113", cardGlass: "#18181BE8",
      accent: "#C7CDD5", warning: "#FFD580", error: "#FFB4B4", secondary: "#172554",
    },
  }),
}));

vi.mock("@/lib/money", () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock("@/services/socialService", () => ({
  getSellerFollowState: followStateMock,
  setSellerFollowing: setFollowingMock,
}));

vi.mock("@/lib/shareProfile", () => ({
  buildCanonicalProfileUrl: (username: string) => `https://brandthread.app/u/${username}`,
}));

vi.mock("@/lib/safety", () => ({
  confirmBlock: vi.fn(async () => false),
  reportHref: () => "/report",
}));

import SellerProfileScreen from "@/app/seller-profile";

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SellerProfileScreen />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (!value || typeof value !== "object") return "";
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

describe("seller-profile.tsx owner vs. non-owner action branch", () => {
  let renderer!: ReactTestRenderer;

  beforeEach(() => {
    routerMock.push.mockReset();
    searchParamsMock.mockReset().mockReturnValue({ id: "seller-9" });
    apiMock.seller.getProfile.mockReset();
    apiMock.posts.publicList.mockReset().mockResolvedValue([]);
    apiMock.publicSellers.get.mockReset();
    apiMock.publicSellers.recordVisit.mockReset().mockResolvedValue(undefined);
    apiMock.reviews.forSeller.mockReset().mockResolvedValue({ avgRating: 0, totalCount: 0 });
    followStateMock.mockReset().mockResolvedValue({ isFollowing: false, followersCount: 12 });
    setFollowingMock.mockReset().mockResolvedValue({ isFollowing: true, followersCount: 13 });
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
  });

  it("shows Follow (not Edit Profile) for a non-owner viewing a seller", async () => {
    apiMock.publicSellers.get.mockResolvedValue({
      profile: { clerkId: "seller-9", brandName: "Acme Co", username: "acme", bio: "We make things." },
      products: [],
    });

    // isOwner param unset => false, but a route id is present so the load path resolves.
    renderer = await renderScreen();

    const allText = textContent(renderer.toJSON());
    expect(allText).toContain("Follow");
    expect(allText).not.toContain("Edit Profile");
  });
});

describe("seller-profile.tsx Posts/Products tab switching", () => {
  let renderer!: ReactTestRenderer;

  beforeEach(() => {
    routerMock.push.mockReset();
    searchParamsMock.mockReset().mockReturnValue({ id: "seller-9" });
    apiMock.publicSellers.get.mockReset().mockResolvedValue({
      profile: { clerkId: "seller-9", brandName: "Acme Co", username: "acme", bio: "We make things." },
      products: [{
        id: "p1", name: "Tee", status: "active", salesModel: "pre-made",
        pricing: { priceCents: 2500 }, inventory: { totalStock: 10, lowStockThreshold: 2 }, media: [],
      }],
    });
    apiMock.publicSellers.recordVisit.mockReset().mockResolvedValue(undefined);
    apiMock.posts.publicList.mockReset().mockResolvedValue([]);
    apiMock.reviews.forSeller.mockReset().mockResolvedValue({ avgRating: 0, totalCount: 0 });
    followStateMock.mockReset().mockResolvedValue({ isFollowing: false, followersCount: 0 });
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
  });

  it("switches from Posts to Products when the Products tab is pressed", async () => {
    renderer = await renderScreen();

    expect(textContent(renderer.toJSON())).not.toContain("Shop the collection");

    await act(async () => {
      renderer.root.findByProps({ testID: "seller-profile-tab-products" }).props.onPress();
      await Promise.resolve();
    });

    expect(textContent(renderer.toJSON())).toContain("Shop the collection");
  });
});
