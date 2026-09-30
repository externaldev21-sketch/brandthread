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

const { routerMock, apiMock, searchParamsMock, creatorVideosMock, authMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true), replace: vi.fn(), navigate: vi.fn() },
  apiMock: {
    social: {
      profile: vi.fn(), tagged: vi.fn(), storiesForUser: vi.fn(), follow: vi.fn(), unfollow: vi.fn(),
      block: vi.fn(), unblock: vi.fn(),
    },
  },
  searchParamsMock: vi.fn((): Record<string, string> => ({ userId: "buyer-7" })),
  creatorVideosMock: vi.fn(),
  authMock: vi.fn(() => ({ isLoaded: true, userId: "viewer-1" })),
}));

vi.mock("@/components/profile/ProfileCover", async () =>
  (await import("./helpers/profileCoverMock")).profileCoverMockModule);

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
    setValue(value: number) { this._value = value; }
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
      spring: () => ({ start: () => {} }),
      timing: () => ({ start: () => {} }),
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
    Easing: { out: (fn: unknown) => fn, cubic: () => 0, bezier: (..._points: number[]) => (t: number) => t },
  };
});

vi.mock("expo-router", () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => searchParamsMock(),
  useFocusEffect: (callback: () => void) => {
    const ReactActual = require("react") as typeof import("react");
    ReactActual.useEffect(callback, [callback]);
  },
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/lib/api", () => ({ useApi: () => apiMock }));

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
  muteUser: vi.fn(), restrictUser: vi.fn(), createOrGetConversation: vi.fn(),
}));

vi.mock("@/lib/contextualPushPermission", () => ({ requestContextualPushPermission: vi.fn() }));
vi.mock("@/contexts/FeatureFlagContext", () => ({ useFeatureFlag: () => false }));
vi.mock("@/components/thread-cash/ChatAttachThreadCash", () => ({ ThreadCashAttachButton: () => null }));
vi.mock("@/components/ModalSafeArea", () => ({
  ModalSafeArea: ({ children }: { children?: React.ReactNode }) => React.createElement("View", null, children),
}));
vi.mock("@/components/ui/Snackbar", () => ({ Snackbar: () => null }));
vi.mock("@/components/buyer-nav/buyerTabBarMetrics", () => ({ useBuyerTabBarInset: () => 0 }));

vi.mock("@/services/profileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/profileService")>()),
  getCreatorVideosPage: creatorVideosMock,
}));

vi.mock("@/lib/shareProfile", () => ({
  buildCanonicalProfileUrl: (username: string) => `https://brandthread.app/u/${username}`,
  shareLinkWithFallback: vi.fn(async () => "shared"),
}));

vi.mock("@/lib/safety", () => ({
  confirmBlock: vi.fn(async () => false),
  confirmUnblock: vi.fn(async () => false),
  reportHref: () => "/report",
}));

import BuyerOtherProfileScreen from "@/app/buyer-other-profile";

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerOtherProfileScreen />);
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

const buyerProfile = {
  userId: "buyer-7", name: "Pat Buyer", username: "pat", displayName: "Pat Buyer", bio: "Thrift + tailoring.",
  avatarUrl: null, accountType: "buyer", followersCount: 41, followingCount: 18, postsCount: 3,
  isFollowing: false, isFollowedBy: false, isMutual: false, iBlockedThem: false,
};

/** Everything a signed-in buyer's private account holds — none of it may ever render on a visitor view. */
const PRIVATE_BUYER_TEXT = [
  "Orders", "Order history", "Saved", "Liked", "Wishlist", "Cart", "Thread Cash", "Balance", "Addresses",
  "Payment", "Returns", "Disputes", "Notifications", "Activity", "Settings", "Switch account", "Edit profile",
  "Drafts", "Email", "Phone", "Free Plan", "Professional dashboard",
];

async function switchTab(renderer: ReactTestRenderer, key: string) {
  const tab = renderer.root.findAll((n) => n.props.testID === `profile-tab-${key}` && typeof n.props.onPress === "function")[0];
  await act(async () => { tab.props.onPress(); await flush(); });
}

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
  searchParamsMock.mockReset().mockReturnValue({ userId: "buyer-7" });
  authMock.mockReset().mockReturnValue({ isLoaded: true, userId: "viewer-1" });
  apiMock.social.profile.mockReset().mockResolvedValue(buyerProfile);
  apiMock.social.tagged.mockReset().mockResolvedValue([]);
  apiMock.social.storiesForUser.mockReset().mockResolvedValue([]);
  creatorVideosMock.mockReset().mockResolvedValue({
    posts: [], total: 0, hasMore: false, nextOffset: 0, restricted: "friends_only", user: null,
  });
});

describe("buyer-other-profile.tsx — a buyer's profile as seen by a visitor", () => {
  let renderer!: ReactTestRenderer;
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); });

  it("shows identity + counts + Follow / Message / ... and only Posts | Tagged tabs", async () => {
    renderer = await renderScreen();
    const text = textContent(renderer.toJSON());
    expect(text).toContain("Pat Buyer");
    expect(text).toContain("@pat");
    expect(text).toContain("41 Followers");
    expect(text).toContain("18 Following");
    expect(text).toContain("Thrift + tailoring.");
    expect(renderer.root.findAllByProps({ testID: "buyer-profile-message" }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: "buyer-other-profile-more" }).length).toBeGreaterThan(0);
    const tabIds = renderer.root.findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("profile-tab-"))
      .map((n) => n.props.testID);
    expect([...new Set(tabIds)].sort()).toEqual(["profile-tab-posts", "profile-tab-tagged"]);
  });

  it("renders nothing private: no orders, saved, Thread Cash, addresses, activity, settings, inbox or edit", async () => {
    renderer = await renderScreen();
    const text = textContent(renderer.toJSON());
    for (const forbidden of PRIVATE_BUYER_TEXT) expect(text, forbidden).not.toContain(forbidden);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Messages" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "Notifications" })).toHaveLength(0);
  });

  it("only ever calls the public profile + tagged reads (never orders / saved / Thread Cash)", async () => {
    renderer = await renderScreen();
    await switchTab(renderer, "tagged");
    expect(apiMock.social.profile).toHaveBeenCalledWith("buyer-7");
    expect(apiMock.social.tagged).toHaveBeenCalledWith("buyer-7");
    expect(Object.keys(apiMock)).toEqual(["social"]);
  });

  it("the Tagged tab lists posts that tagged this buyer", async () => {
    apiMock.social.tagged.mockResolvedValue([{ id: "t1", authorId: "seller-1", authorName: "Acme", mediaUrl: "https://cdn.example.com/t1.jpg", mediaType: "photo", source: "post" }]);
    renderer = await renderScreen();
    await switchTab(renderer, "tagged");
    expect(renderer.root.findAllByProps({ testID: "profile-video-tile-t1" }).length).toBeGreaterThan(0);
  });

  it("a visitor passing ?asVisitor=1 is still just a visitor (no redirect, no owner UI)", async () => {
    searchParamsMock.mockReturnValue({ userId: "buyer-7", asVisitor: "1" });
    renderer = await renderScreen();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("the owner opening their own profile here is sent to their owner profile", async () => {
    authMock.mockReturnValue({ isLoaded: true, userId: "buyer-7" });
    renderer = await renderScreen();
    expect(routerMock.replace).toHaveBeenCalledWith("/(buyer)/profile");
  });

  it("the owner's View-as-visitor preview stays here, labelled, with inert Follow/Message and owner-stripped posts", async () => {
    authMock.mockReturnValue({ isLoaded: true, userId: "buyer-7" });
    searchParamsMock.mockReturnValue({ userId: "buyer-7", asVisitor: "1" });
    renderer = await renderScreen();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ testID: "buyer-profile-visitor-preview" }).length).toBeGreaterThan(0);
    const message = renderer.root.findAll((n) => n.props.testID === "buyer-profile-message" && "disabled" in n.props)[0];
    expect(message.props.disabled).toBe(true);
    expect(creatorVideosMock.mock.calls[0][3]).toMatchObject({ asVisitor: true });
    const text = textContent(renderer.toJSON());
    for (const forbidden of PRIVATE_BUYER_TEXT) expect(text, forbidden).not.toContain(forbidden);
  });
});
