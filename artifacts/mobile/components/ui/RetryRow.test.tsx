import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const React = require("react") as typeof import("react");
  const el = (name: string) => {
    function C(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    C.displayName = name;
    return C;
  };
  return {
    View: el("View"),
    Text: el("Text"),
    Pressable: el("Pressable"),
    StyleSheet: { create: (s: unknown) => s },
  };
});

vi.mock("@expo/vector-icons", () => {
  const React = require("react") as typeof import("react");
  return { Feather: (props: Record<string, unknown>) => React.createElement("Feather", props) };
});

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ border: "#333", mutedForeground: "#888" }),
}));

vi.mock("@/components/BrandthreadUI", () => {
  const React = require("react") as typeof import("react");
  return {
    PressableScale: (props: Record<string, unknown>) =>
      React.createElement("Pressable", props, props.children as React.ReactNode),
  };
});

vi.mock("@/lib/theme", () => ({
  FONT: { medium: "Inter_500Medium" },
}));

vi.mock("@/constants/typography", () => ({
  TYPE_SCALE: { footnote: { fontSize: 13 } },
}));

vi.mock("@/constants/spacing", () => ({
  SPACING: { xxs: 4, xs: 8, sm: 12 },
}));

import { RetryRow } from "./RetryRow";

describe("RetryRow", () => {
  it("renders the default 'Couldn't load — Tap to retry' copy", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<RetryRow onRetry={() => {}} />);
    });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain("Couldn't load. Tap to retry.");
    expect(text).toContain("Couldn't load");
    expect(text).toContain(" — Tap to retry");
  });

  it("renders a custom label, e.g. \"Couldn't load balance\", never a fabricated zero", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<RetryRow label="Couldn't load balance" onRetry={() => {}} />);
    });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain("Couldn't load balance. Tap to retry.");
    expect(text).toContain("Couldn't load balance");
    expect(text).not.toMatch(/\$0(\.00)?\b/);
  });

  it("calls onRetry when tapped", () => {
    const onRetry = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<RetryRow onRetry={onRetry} />);
    });
    const pressable = renderer.root.findByProps({ accessibilityRole: "button" });
    act(() => {
      (pressable.props.onPress as () => void)();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
