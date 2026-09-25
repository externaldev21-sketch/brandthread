import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Covers the seller-profile.tsx redesign onto the shared ProfileShell:
//  - Follow (non-owner) vs Edit profile (owner) action branch,
//  - the videos grid is the main content: a tile opens the feed player for
//    this creator, starting at the tapped video,
//  - the floating "Shop N products" pill opens the seller's product list,
//  - follow/unfollow updates the follower count immediately.

const {
  routerMock,
  apiMock,
  followStateMock,
  setFollowingMock,
  searchParamsMock,
  creatorVideosMock,
  authMock,
} = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true), replace: vi.fn() },
  apiMock: {
    seller: { getProfile: vi.fn() },
    publicSellers: { get: vi.fn(), recordVisit: vi.fn() },
    reviews: { forSeller: vi.fn() },
    social: { block: vi.fn(), profile: vi.fn() },
  },
  followStateMock: vi.fn(),
  setFollowingMock: vi.fn(),
  searchParamsMock: vi.fn(() => ({ id: "seller-9" })),
  creatorVideosMock: vi.fn(),
  authMock: vi.fn(() => ({ isLoaded: true, userId: "buyer-1" })),
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
  function MockPressable(props: Record<string, unknown>) {
    const { children, ...rest } = props;
    const content = typeof children === "function"
      ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false })
      : children;
    return React.createElement("Pressable", rest, content as React.ReactNode);
  }
  MockPressable.displayName = "Pressable";
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
    Platform: { OS: "ios", select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    Pressable: MockPressable,
    RefreshControl: nativeComponent("RefreshControl"),
    ScrollView: nativeComponent("ScrollView"),
    Share: { share: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Text: nativeComponent("Text"),
    TouchableOpacity: nativeComponent("TouchableOpacity"),
    View: nativeComponent("View"),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock("@/components/profile/ProfileShell", async () =>
  (await import("./helpers/profileShellMock")).profileShellMockModule);

vi.mock("@/components/BrandDropsCard", () => ({ BrandDropsCard: () => null }));
vi.mock("@/components/ShareProfileSheet", () => ({ ShareProfileSheet: () => null }));
vi.mock("@/components/CachedImage", () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement("CachedImage", props),
}));
vi.mock("@/components/layout", () => ({
  SkeletonBlock: () => React.createElement("View", { testID: "skeleton-block" }),
}));
vi.mock("@/components/ui/ErrorState", () => ({
  ErrorState: ({ message }: { message: string }) => React.createElement("Text", null, message),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => authMock(),
}));

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => React.createElement("Feather", { name }),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("LinearGradient", {}, children),
}));

vi.mock("react-native-svg", () => ({
  default: ({ children }: { children?: React.ReactNode }) => React.createElement("Svg", {}, children),
  Line: (props: Record<string, unknown>) => React.createElement("SvgLine", props),
}));

vi.mock("react-native-reanimated", () => {
  const makeAnimatedComponent = (name: string) =>
    (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  return {
    default: {
      View: makeAnimatedComponent("Animated.View"),
      Text: makeAnimatedComponent("Animated.Text"),
    },
    useSharedValue: (initial: number) => ({
      value: initial,
      set(next: number) { this.value = next; },
    }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (toValue: unknown) => toValue,
    withSpring: (toValue: unknown) => toValue,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    interpolateColor: (value: number, input: number[], output: string[]) => {
      const index = input.indexOf(value);
      return index >= 0 ? output[index] : output[value >= (input[input.length - 1] ?? 1) ? output.length - 1 : 0];
    },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
  };
});

vi.mock("expo-router", () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => searchParamsMock(),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/hooks/useApi", () => ({ useApi: () => apiMock }));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#C7CDD5", foreground: "#FAFAFA", mutedForeground: "#D7D7DB" }),
}));

vi.mock("@/contexts/AppThemeContext", () => ({
  useAppTheme: () => ({
    theme: {
      background: "#09090B", text: "#FAFAFA", muted: "#D7D7DB", subtle: "#A8A8B1", border: "#FFFFFF22",
      card: "#18181B", cardElevated: "#18181B", surface: "#111113", cardGlass: "#18181BE8",
      accent: "#C7CDD5", onAccent: "#0A0A0B", accentDim: "#C7CDD52E", warning: "#FFD580",
      error: "#FFB4B4", secondary: "#172554", shadowColor: "#000000",
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

vi.mock("@/services/profileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/profileService")>()),
  getCreatorVideosPage: creatorVideosMock,
}));

vi.mock("@/lib/shareProfile", () => ({
  buildCanonicalProfileUrl: (username: string) => `https://brandthread.app/u/${username}`,
}));

vi.mock("@/lib/safety", () => ({
  confirmBlock: vi.fn(async () => false),
  reportHref: () => "/report",
}));

import SellerProfileScreen from "@/app/seller-profile";

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SellerProfileScreen />);
    await flush();
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

const sellerProfile = {
  clerkId: "seller-9", brandName: "Acme Co", username: "acme", bio: "We make things.",
  productsCount: 12, videosCount: 2,
};

const videoRow = (id: string) => ({
  id,
  authorId: "seller-9",
  authorAccountType: "seller",
  authorName: "Acme Co",
  contentType: "video",
  caption: `Clip ${id}`,
  mediaUris: [`https://cdn.example.com/${id}.mp4`],
  thumbnailUri: `https://cdn.example.com/${id}.jpg`,
  productTags: [],
  likesCount: 3,
  viewsCount: 1200,
  isDraft: false,
  scheduledAt: null,
});

beforeEach(() => {
  routerMock.push.mockReset();
  searchParamsMock.mockReset().mockReturnValue({ id: "seller-9" });
  authMock.mockReset().mockReturnValue({ isLoaded: true, userId: "buyer-1" });
  apiMock.seller.getProfile.mockReset();
  apiMock.publicSellers.get.mockReset().mockResolvedValue({ profile: sellerProfile, products: [] });
  apiMock.publicSellers.recordVisit.mockReset().mockResolvedValue(undefined);
  apiMock.reviews.forSeller.mockReset().mockResolvedValue({ avgRating: 4.8, totalCount: 10 });
  apiMock.social.profile.mockReset().mockResolvedValue({ followersCount: 12, followingCount: 3 });
  followStateMock.mockReset().mockResolvedValue({ isFollowing: false, followersCount: 12 });
  setFollowingMock.mockReset().mockResolvedValue({ isFollowing: true, followersCount: 13 });
  creatorVideosMock.mockReset().mockResolvedValue({
    posts: [videoRow("post-a"), videoRow("post-b")],
    total: 2, hasMore: false, nextOffset: 2, restricted: null, user: null,
  });
});

describe("seller-profile.tsx owner vs. non-owner action branch", () => {
  let renderer!: ReactTestRenderer;
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

  it("shows Follow (not Edit profile) for a non-owner viewing a seller", async () => {
    renderer = await renderScreen();
    const allText = textContent(renderer.toJSON());
    expect(allText).toContain("Follow");
    expect(allText).not.toContain("Edit profile");
    expect(renderer.root.findAllByProps({ testID: "seller-profile-follow-btn" }).length).toBeGreaterThan(0);
  });

  it("shows Edit profile (not Follow) when the seller opens their own profile", async () => {
    authMock.mockReturnValue({ isLoaded: true, userId: "seller-9" });
    renderer = await renderScreen();
    const allText = textContent(renderer.toJSON());
    expect(allText).toContain("Edit profile");
    expect(renderer.root.findAllByProps({ testID: "seller-profile-follow-btn" })).toHaveLength(0);
  });
});

describe("seller-profile.tsx videos grid and shop", () => {
  let renderer!: ReactTestRenderer;
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

  it("loads the creator's videos with the canonical seller id and renders a tile per video", async () => {
    renderer = await renderScreen();
    expect(creatorVideosMock).toHaveBeenCalled();
    expect(creatorVideosMock.mock.calls[0][0]).toBe("seller-9");
    expect(creatorVideosMock.mock.calls[0][1]).toBe(0);
    expect(renderer.root.findAllByProps({ testID: "profile-video-tile-post-a" }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: "profile-video-tile-post-b" }).length).toBeGreaterThan(0);
  });

  it("opens the full-screen feed player for this creator at the tapped video", async () => {
    renderer = await renderScreen();
    const tile = renderer.root.findAll((node) => node.props.testID === "profile-video-tile-post-b" && typeof node.props.onPress === "function")[0];
    await act(async () => { tile.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith(
      "/profile-videos?source=creator&id=seller-9&startPostId=post-b&title=Acme%20Co",
    );
  });

  it("opens the seller's product list from the Shop pill", async () => {
    renderer = await renderScreen();
    const pill = renderer.root.findAll((node) => node.props.testID === "profile-shop-pill" && typeof node.props.onPress === "function")[0];
    expect(textContent(renderer.toJSON())).toContain("Shop 12 products");
    await act(async () => { pill.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith("/profile-products?sellerId=seller-9&sellerName=Acme%20Co");
  });

  it("hides the Shop pill from visitors when the seller has no live products", async () => {
    apiMock.publicSellers.get.mockResolvedValue({ profile: { ...sellerProfile, productsCount: 0 }, products: [] });
    renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ testID: "profile-shop-pill" })).toHaveLength(0);
  });

  it("links follower / following counts to this seller's own lists", async () => {
    renderer = await renderScreen();
    const followers = renderer.root.findAll((node) => node.props.testID === "profile-stat-followers" && typeof node.props.onPress === "function")[0];
    await act(async () => { followers.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith("/connections?type=followers&userId=seller-9");
  });
});

describe("seller-profile.tsx follow", () => {
  let renderer!: ReactTestRenderer;
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

  it("updates the follower count from the server-confirmed follow", async () => {
    renderer = await renderScreen();
    expect(textContent(renderer.root.findByProps({ testID: "profile-stat-followers" }).props.children)).toContain("12");
    const follow = renderer.root.findAll((node) => node.props.accessibilityLabel === "Follow" && typeof node.props.onPress === "function")[0];
    await act(async () => { follow.props.onPress(); await flush(); });
    expect(setFollowingMock).toHaveBeenCalledWith("seller-9", true);
    expect(textContent(renderer.root.findByProps({ testID: "profile-stat-followers" }).props.children)).toContain("13");
  });
});
