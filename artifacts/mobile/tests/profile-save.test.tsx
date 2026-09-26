import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const {
  alertMock,
  apiMock,
  getSellerPostsMock,
  subscribeSocialMock,
  routerMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  apiMock: {
    auth: {
      updateProfile: vi.fn(),
    },
    seller: {
      getProfile: vi.fn(),
    },
    social: {
      followers: vi.fn(),
      following: vi.fn(),
      myStories: vi.fn(),
    },
  },
  getSellerPostsMock: vi.fn(),
  subscribeSocialMock: vi.fn(),
  routerMock: { push: vi.fn() },
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

  const AnimatedView = nativeComponent("Animated.View");
  const AnimatedScrollView = nativeComponent("Animated.ScrollView");

  return {
    ActivityIndicator: nativeComponent("ActivityIndicator"),
    Alert: { alert: alertMock },
    Animated: {
      Value: MockAnimatedValue,
      View: AnimatedView,
      ScrollView: AnimatedScrollView,
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
    },
    Image: nativeComponent("Image"),
    KeyboardAvoidingView: nativeComponent("KeyboardAvoidingView"),
    Modal: nativeComponent("Modal"),
    Pressable: nativeComponent("Pressable"),
    Platform: { OS: "ios", select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    RefreshControl: nativeComponent("RefreshControl"),
    ScrollView: nativeComponent("ScrollView"),
    StyleSheet: {
      create: (styles: unknown) => styles,
      absoluteFill: {},
      absoluteFillObject: {},
      hairlineWidth: 1,
    },
    Text: nativeComponent("Text"),
    TextInput: nativeComponent("TextInput"),
    TouchableOpacity: nativeComponent("TouchableOpacity"),
    View: nativeComponent("View"),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

// Sheet entrance motion is visual only; render the sheet as a plain View.
vi.mock("@/components/motion/SheetRise", () => ({
  SheetRise: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("View", props, children),
}));

// The profile renders into the shared ProfileShell; its hero video / scroll
// chrome is visual only, so a stand-in renders every slot inline and the
// account-switcher, edit-details, tab and grid testIDs stay reachable.
vi.mock("@/components/profile/ProfileShell", async () =>
  (await import("./helpers/profileShellMock")).profileShellMockModule);

// Shared primitives: a render-prop-aware PressableScale that keeps every prop
// (testID, onPress…) on a plain host node, and a simple EmptyState.
vi.mock("@/components/BrandthreadUI", () => {
  const ReactActual = require("react") as typeof import("react");
  const PressableScale = ({ children, ...rest }: Record<string, unknown>) => {
    const content = typeof children === "function"
      ? (children as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : children;
    return ReactActual.createElement("Pressable", rest, content as React.ReactNode);
  };
  return {
    PressableScale,
    EmptyState: ({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) =>
      ReactActual.createElement(
        "View",
        null,
        ReactActual.createElement("Text", null, title),
        action ? ReactActual.createElement("Pressable", { onPress: action.onPress }, action.label) : null,
      ),
  };
});

vi.mock("@/components/CachedImage", () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement("CachedImage", props),
}));

vi.mock("@/components/layout", () => ({
  SkeletonBlock: () => React.createElement("View", { testID: "skeleton-block" }),
}));

vi.mock("@/components/ui/ErrorState", () => ({
  ErrorState: ({ message }: { message: string }) => React.createElement("Text", null, message),
}));

vi.mock("@/components/buyer-nav/buyerTabBarMetrics", () => ({
  useTabBarMetrics: () => ({ occupiedHeight: 80 }),
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, userId: "seller-1" }),
}));

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => React.createElement("Feather", { name }),
}));

vi.mock("expo-haptics", () => ({
  // lib/haptics.ts (used by the shared profile controls) chains `.catch()`.
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("LinearGradient", props, children),
}));

vi.mock("expo-router", () => ({
  useRouter: () => routerMock,
  useFocusEffect: () => {},
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/services/socialService", () => ({
  getSellerPosts: getSellerPostsMock,
  subscribeSocial: subscribeSocialMock,
}));

vi.mock("@/lib/api", () => ({
  useApi: () => apiMock,
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#09090B",
    primary: "#C7CDD5",
  }),
}));

vi.mock("@/contexts/AppThemeContext", () => ({
  useAppTheme: () => ({
    theme: {
      background: "#09090B",
      text: "#FAFAFA",
      muted: "#D7D7DB",
      border: "#FFFFFF22",
      card: "#18181B",
      accent: "#C7CDD5",
      accentDim: "#34383E",
      accentLight: "#F8FAFC",
      secondary: "#172554",
      onAccent: "#FFFFFF",
      warning: "#FFD580",
      error: "#FFB4B4",
      heroGradient: ["#09090B", "#18181B"],
      glowGradient: ["#FFFFFF0F", "#FFFFFF03"],
    },
  }),
}));

vi.mock("@/lib/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme")>()),
  BG: "#09090B",
  SCREEN_BG: "transparent",
  CARD: "#18181B",
  BORDER: "#FFFFFF22",
  FG: "#FAFAFA",
  MUTED: "#D7D7DB",
  SUBTLE: "#C5C5CA",
  FONT: { regular: "System", medium: "System", semibold: "System", bold: "System" },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xxl: 40 },
  SURFACE: "#111113",
  ACCENT: "#F7F7FA",
  ACCENT_LIGHT: "#FFFFFF",
}));

vi.mock("@/lib/money", () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock("@/lib/networkNotice", () => ({
  reportNetworkError: vi.fn(),
}));

import ProfileScreen from "@/app/(tabs)/profile";

const initialProfile = () => ({
  brandName: "Original Brand",
  displayName: "Owner",
  bio: "Original bio",
  subscriptionStatus: null,
  subscriptionPlanId: null,
  totalLikes: 0,
  profileImageUrl: null,
  metrics: {
    revenueCents: 0,
    visitors: 0,
    orders: 0,
    conversionRate: 0,
  },
});

const updatedProfile = () => ({
  ...initialProfile(),
  brandName: "Updated Brand",
  bio: "Updated bio",
});

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (!value || typeof value !== "object") return "";
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProfileScreen />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

async function openEditor(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.root.findAll((node) => node.props.testID === "profile-edit-details" && typeof node.props.onLongPress === "function")[0].props.onLongPress();
  });
}

async function enterProfileDetails(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.root.findByProps({ testID: "profile-edit-brand-name" }).props.onChangeText("Updated Brand");
    renderer.root.findByProps({ testID: "profile-edit-bio" }).props.onChangeText("Updated bio");
  });
}

async function save(renderer: ReactTestRenderer) {
  await act(async () => {
    await renderer.root.findByProps({ testID: "profile-edit-save" }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("seller Profile brand details save", () => {
  let renderer!: ReactTestRenderer;

  beforeEach(() => {
    alertMock.mockReset();
    routerMock.push.mockReset();
    getSellerPostsMock.mockReset();
    subscribeSocialMock.mockReset();
    apiMock.auth.updateProfile.mockReset();
    apiMock.seller.getProfile.mockReset();
    apiMock.social.followers.mockReset();
    apiMock.social.following.mockReset();
    apiMock.social.myStories.mockReset();

    getSellerPostsMock.mockResolvedValue([]);
    subscribeSocialMock.mockReturnValue(vi.fn());
    apiMock.seller.getProfile.mockResolvedValue(initialProfile());
    apiMock.social.followers.mockResolvedValue([]);
    apiMock.social.following.mockResolvedValue([]);
    apiMock.social.myStories.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
  });

  it("opens the full seller Edit Profile screen from Edit Profile (the quick sheet stays on long-press)", async () => {
    renderer = await renderScreen();
    const edit = renderer.root.findAll((node) => node.props.testID === "profile-edit-details" && typeof node.props.onPress === "function")[0];
    await act(async () => { edit.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith("/edit-profile");
  });

  it("updates the displayed Profile details only after the save succeeds", async () => {
    apiMock.seller.getProfile
      .mockResolvedValueOnce(initialProfile())
      .mockResolvedValue(updatedProfile());
    apiMock.auth.updateProfile.mockResolvedValue(updatedProfile());
    renderer = await renderScreen();
    await openEditor(renderer);
    await enterProfileDetails(renderer);

    expect(textContent(renderer.root.findByProps({ testID: "profile-hero-brand-name" })))
      .toContain("Original Brand");

    await save(renderer);

    expect(apiMock.auth.updateProfile).toHaveBeenCalledWith({
      brandName: "Updated Brand",
      bio: "Updated bio",
    });
    expect(textContent(renderer.root.findByProps({ testID: "profile-hero-brand-name" })))
      .toContain("Updated Brand");
    expect(renderer.root.findAllByProps({ visible: false })).not.toHaveLength(0);
  });

  it("keeps the previous Profile details and surfaces an error when saving fails", async () => {
    apiMock.auth.updateProfile.mockRejectedValue(new Error("Request failed"));
    renderer = await renderScreen();
    await openEditor(renderer);
    await enterProfileDetails(renderer);

    await save(renderer);

    expect(textContent(renderer.root.findByProps({ testID: "profile-hero-brand-name" })))
      .toContain("Original Brand");
    expect(alertMock).toHaveBeenCalledWith(
      "Could not save changes",
      "Check your connection and try again.",
    );
    expect(renderer.root.findByProps({ testID: "profile-edit-save" })).toBeTruthy();
  });
});

describe("seller Profile content-state tabs (Posts / Drafts / Scheduled)", () => {
  let renderer!: ReactTestRenderer;

  const posts = [
    { id: "post-1", caption: "Published post", isDraft: false, isArchived: false, scheduledAt: null, contentType: "image", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "post-2", caption: "Draft post", isDraft: true, isArchived: false, scheduledAt: null, contentType: "image", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "post-3", caption: "Scheduled post", isDraft: false, isArchived: false, scheduledAt: "2026-02-01T00:00:00.000Z", contentType: "video", createdAt: "2026-01-03T00:00:00.000Z" },
  ];

  beforeEach(() => {
    routerMock.push.mockReset();
    getSellerPostsMock.mockReset().mockResolvedValue(posts);
    subscribeSocialMock.mockReset().mockReturnValue(vi.fn());
    apiMock.seller.getProfile.mockReset().mockResolvedValue(initialProfile());
    apiMock.social.followers.mockReset().mockResolvedValue([]);
    apiMock.social.following.mockReset().mockResolvedValue([]);
    apiMock.social.myStories.mockReset().mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
  });

  it("filters the grid by content state as each index-based tab is pressed", async () => {
    renderer = await renderScreen();

    // Defaults to the Posts tab (index 0): everything not a draft or archived
    // shows here (published and scheduled alike — same filter as before the
    // redesign), but drafts are excluded.
    expect(textContent(renderer.toJSON())).toContain("Published post");
    expect(textContent(renderer.toJSON())).not.toContain("Draft post");

    await act(async () => {
      renderer.root.findByProps({ testID: "profile-tab-draft" }).props.onPress();
    });
    expect(textContent(renderer.toJSON())).toContain("Draft post");
    expect(textContent(renderer.toJSON())).not.toContain("Published post");

    await act(async () => {
      renderer.root.findByProps({ testID: "profile-tab-schedule" }).props.onPress();
    });
    expect(textContent(renderer.toJSON())).toContain("Scheduled post");
    expect(textContent(renderer.toJSON())).not.toContain("Draft post");
  });
});