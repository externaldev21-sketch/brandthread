import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    Alert: { alert: alertMock },
    Image: nativeComponent("Image"),
    KeyboardAvoidingView: nativeComponent("KeyboardAvoidingView"),
    Modal: nativeComponent("Modal"),
    Platform: { OS: "ios" },
    ScrollView: nativeComponent("ScrollView"),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent("Text"),
    TextInput: nativeComponent("TextInput"),
    TouchableOpacity: nativeComponent("TouchableOpacity"),
    View: nativeComponent("View"),
  };
});

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => React.createElement("Feather", { name }),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
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
    primary: "#8B5CF6",
  }),
}));

vi.mock("@/contexts/AppThemeContext", () => ({
  useAppTheme: () => ({
    theme: {
      accent: "#8B5CF6",
      accentDim: "#2E1B55",
      accentLight: "#C4B5FD",
      secondary: "#172554",
      onAccent: "#FFFFFF",
    },
  }),
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
    renderer.root.findByProps({ testID: "profile-edit-details" }).props.onPress();
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

  it("updates the displayed Profile details only after the save succeeds", async () => {
    apiMock.seller.getProfile
      .mockResolvedValueOnce(initialProfile())
      .mockResolvedValue(updatedProfile());
    apiMock.auth.updateProfile.mockResolvedValue(updatedProfile());
    renderer = await renderScreen();
    await openEditor(renderer);
    await enterProfileDetails(renderer);

    expect(textContent(renderer.root.findByProps({ testID: "profile-edit-details" })))
      .toContain("Original Brand");

    await save(renderer);

    expect(apiMock.auth.updateProfile).toHaveBeenCalledWith({
      brandName: "Updated Brand",
      bio: "Updated bio",
    });
    expect(textContent(renderer.root.findByProps({ testID: "profile-edit-details" })))
      .toContain("Updated Brand");
    expect(renderer.root.findAllByProps({ visible: false })).not.toHaveLength(0);
  });

  it("keeps the previous Profile details and surfaces an error when saving fails", async () => {
    apiMock.auth.updateProfile.mockRejectedValue(new Error("Request failed"));
    renderer = await renderScreen();
    await openEditor(renderer);
    await enterProfileDetails(renderer);

    await save(renderer);

    expect(textContent(renderer.root.findByProps({ testID: "profile-edit-details" })))
      .toContain("Original Brand");
    expect(alertMock).toHaveBeenCalledWith(
      "Could not save changes",
      "Check your connection and try again.",
    );
    expect(renderer.root.findByProps({ testID: "profile-edit-save" })).toBeTruthy();
  });
});