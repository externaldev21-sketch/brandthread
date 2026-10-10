/**
 * ShareProfileQrScanner's "camera unavailable" state renders one of two
 * copy variants depending on `Platform.OS`:
 *   - web:    "Scanning isn't available on web. Try it on a phone."
 *   - native: "Allow camera access to scan a Brandthread profile code."
 *             plus an "Allow Camera" retry button.
 *
 * PR #403 changed the web copy from "isn't available in this preview" to
 * "isn't available on web" but could not get a live screenshot of it: the
 * real trigger path needs a native camera-permission-denied state (or a web
 * runtime, which this sandbox's headless Chromium has no real camera
 * permission model for) that's hard to drive through Playwright taps alone.
 * This unit test instead renders the component directly under both
 * `Platform.OS` values with `useCameraPermissions` mocked to the
 * not-granted state, and asserts on the exact rendered strings — a more
 * reliable verification of the copy than a screenshot would be, since it
 * pins the literal text rather than relying on eyeballing a screen capture.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

const platform = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' | 'web' }));

vi.mock('react-native', () => ({
  Platform: { get OS() { return platform.OS; } },
  Pressable: nativeComponent('Pressable'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: nativeComponent('Text'),
  View: nativeComponent('View'),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: Object.assign(nativeComponent('Feather'), { glyphMap: {} }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const requestPermission = vi.fn().mockResolvedValue({ granted: false });
const cameraPermissionState: { granted: boolean; canAskAgain: boolean } = { granted: false, canAskAgain: true };
vi.mock('expo-camera', () => ({
  CameraView: nativeComponent('CameraView'),
  useCameraPermissions: () => [cameraPermissionState, requestPermission],
}));

vi.mock('@/hooks/useHeaderTopInset', () => ({
  useHeaderTopInset: () => 0,
}));

vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, lg: 19 },
  ICON: { md: 20, lg: 24 },
  RADIUS: { md: 14, pill: 999 },
  SP: { xs: 4, sm: 8, md: 16, xl: 32 },
}));

vi.mock('@/lib/shareProfile', () => ({
  parseProfileDeepLink: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/haptics', () => ({
  hapticSuccess: vi.fn(),
  haptics: { selection: vi.fn(), light: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), rigid: vi.fn() },
}));

import { ShareProfileQrScanner } from '@/components/ShareProfileQrScanner';

function findAllText(node: ReactTestRenderer['root']): string[] {
  return node.findAllByType('Text' as never).map((n) => {
    const children = (n.props as { children?: unknown }).children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

describe('ShareProfileQrScanner — camera-unavailable copy', () => {
  beforeEach(() => {
    requestPermission.mockClear();
    cameraPermissionState.granted = false;
    cameraPermissionState.canAskAgain = true;
  });

  it('shows the web-specific string (not "preview") when Platform.OS is web', () => {
    platform.OS = 'web';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ShareProfileQrScanner onClose={() => {}} />);
    });
    const texts = findAllText(renderer.root);
    expect(texts).toContain("Scanning isn't available on web. Try it on a phone.");
    expect(texts.some((t) => /preview/i.test(t))).toBe(false);
    // Web has no meaningful permission prompt, so no "Allow Camera" retry button.
    expect(texts).not.toContain('Allow Camera');
    act(() => { renderer.unmount(); });
  });

  it('shows the native permission-prompt copy (not the web string) when Platform.OS is ios', () => {
    platform.OS = 'ios';
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ShareProfileQrScanner onClose={() => {}} />);
    });
    const texts = findAllText(renderer.root);
    expect(texts).toContain('Allow camera access to scan a Brandthread profile code.');
    expect(texts).toContain('Allow Camera');
    expect(texts.some((t) => t.includes('on web'))).toBe(false);
    act(() => { renderer.unmount(); });
  });

  it('renders the live CameraView once permission is granted, on native', () => {
    platform.OS = 'android';
    cameraPermissionState.granted = true;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ShareProfileQrScanner onClose={() => {}} />);
    });
    expect(renderer.root.findAllByType('CameraView' as never).length).toBe(1);
    expect(findAllText(renderer.root)).not.toContain('Camera unavailable');
    act(() => { renderer.unmount(); });
  });
});
