import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  currentRole: "owner" as "owner" | "manager" | "staff",
  members: [
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.com",
      role: "owner",
      status: "active",
      isOwner: true,
    },
    {
      id: "expired-invite",
      name: "Expired invite",
      email: "expired@example.com",
      role: "staff",
      status: "pending",
      expired: true,
      expiresAt: "2020-01-01T00:00:00.000Z",
      invitedAt: "2020-01-01T00:00:00.000Z",
      inviteUrl: "https://example.test/invite",
    },
    {
      id: "active-member",
      name: "Active member",
      email: "active@example.com",
      role: "manager",
      status: "active",
      online: false,
    },
  ],
}));

const alertMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());

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
    Modal: nativeComponent("Modal"),
    RefreshControl: nativeComponent("RefreshControl"),
    ScrollView: nativeComponent("ScrollView"),
    Share: { share: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles },
    Switch: nativeComponent("Switch"),
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
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    card: "#111",
    border: "#333",
    foreground: "#fff",
    mutedForeground: "#aaa",
    primary: "#c7cdd5",
    primaryForeground: "#fff",
    secondary: "#222",
    success: "#10b981",
    warning: "#f59e0b",
    destructive: "#ef4444",
  }),
}));

vi.mock("@/components/ScreenHeader", () => ({
  ScreenHeader: () => null,
}));

vi.mock("@/components/Badge", () => ({
  Badge: ({ label }: { label: string }) => React.createElement("Badge", { label }),
}));

vi.mock("@/lib/api", () => ({
  useApi: () => ({
    team: {
      members: vi.fn(async () => state.members),
      activity: vi.fn(async () => ({ logs: [], hasMore: false })),
      remove: removeMock,
    },
  }),
}));

vi.mock("@/hooks/useTeamRole", () => ({
  useTeamRole: () => ({ currentRole: state.currentRole }),
}));

vi.mock("@/lib/entitlementError", () => ({
  getEntitlementRejection: () => null,
}));

import TeamScreen from "./team";

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<TeamScreen />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return renderer.root.findAll(
    (node) => Array.isArray(node.children) && node.children.map(String).join("") === text,
  ).length > 0;
}

function controls(renderer: ReactTestRenderer, accessibilityLabel: string) {
  return renderer.root.findAllByProps({ accessibilityLabel });
}

type AlertButton = {
  text?: string;
  onPress?: () => void | Promise<void>;
};

function lastAlertButtons(): AlertButton[] {
  const buttons = alertMock.mock.lastCall?.[2];
  return Array.isArray(buttons) ? buttons : [];
}

describe("team expired invite presentation", () => {
  beforeEach(() => {
    state.currentRole = "owner";
    removeMock.mockReset();
    removeMock.mockResolvedValue(undefined);
    alertMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides expired invites until the collapsed section is opened", async () => {
    const renderer = await renderScreen();

    expect(hasText(renderer, "Expired invites (1)")).toBe(true);
    expect(hasText(renderer, "Expired invite")).toBe(false);
    expect(hasText(renderer, "Active member")).toBe(true);
    expect(controls(renderer, "Dismiss expired invite")).toHaveLength(0);

    const sectionToggle = controls(renderer, "Show 1 expired invite");
    expect(sectionToggle.length).toBeGreaterThan(0);
    await act(async () => {
      sectionToggle[0].props.onPress();
    });

    expect(hasText(renderer, "Expired invite")).toBe(true);
    expect(controls(renderer, "Dismiss expired invite").length).toBeGreaterThan(0);
    expect(controls(renderer, "Hide 1 expired invite").length).toBeGreaterThan(0);

    await act(async () => {
      controls(renderer, "Dismiss expired invite")[0].props.onPress();
    });
    expect(alertMock).toHaveBeenCalledWith(
      "Dismiss expired invite",
      expect.stringContaining("will be removed"),
      expect.any(Array),
    );

    const dismissAction = lastAlertButtons().find((button) => button.text === "Dismiss");
    expect(dismissAction).toBeDefined();
    await act(async () => {
      await dismissAction?.onPress?.();
    });

    expect(removeMock).toHaveBeenCalledWith("expired-invite");
    expect(hasText(renderer, "Expired invite")).toBe(false);
    expect(hasText(renderer, "Active member")).toBe(true);
  });

  it.each(["manager", "staff"] as const)(
    "does not render the expired-invite dismiss control for a %s",
    async (role) => {
      state.currentRole = role;
      const renderer = await renderScreen();

      await act(async () => {
        controls(renderer, "Show 1 expired invite")[0].props.onPress();
      });

      expect(hasText(renderer, "Expired invite")).toBe(true);
      expect(controls(renderer, "Dismiss expired invite")).toHaveLength(0);
    },
  );
});