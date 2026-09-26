import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Profile cover video — client flow: the first-visit coach mark shows exactly
// once (server flag, so it survives reinstall / other devices), clips over
// 30s go through trim with a 20s suggestion, and the server's 24h-limit
// message reaches the user.

const { apiMock, alertMock, pickerMock } = vi.hoisted(() => ({
  apiMock: {
    profileCover: {
      coachmark: vi.fn(),
      markCoachmarkSeen: vi.fn(),
      upload: vi.fn(),
      remove: vi.fn(),
    },
  },
  alertMock: vi.fn(),
  pickerMock: { launchImageLibraryAsync: vi.fn(), launchCameraAsync: vi.fn(), requestCameraPermissionsAsync: vi.fn() },
}));

vi.mock('react-native', () => {
  const ReactActual = require('react') as typeof import('react');
  const host = (name: string) => (props: any) => ReactActual.createElement(name, props, props.children);
  class AnimatedValue { constructor(public v: number) {} setValue(v: number) { this.v = v; } interpolate() { return 0; } }
  return {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'), Modal: host('Modal'),
    Animated: { Value: AnimatedValue, View: host('Animated.View'), spring: () => ({ start: () => {} }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    Alert: { alert: alertMock },
  };
});
vi.mock('expo-image-picker', () => pickerMock);
vi.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: vi.fn(), pause: vi.fn(), currentTime: 0 }),
  VideoView: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticSelection: vi.fn() }));
vi.mock('@/lib/profileEvents', () => ({ emitProfileEvent: vi.fn() }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: ({ children, ...rest }: any) => React.createElement('Pressable', rest, typeof children === 'function' ? children({ pressed: false }) : children),
}));
vi.mock('@/components/profile/ProfileThread', () => ({ ProfileThread: () => null }));
vi.mock('@/components/profile/ProfileControls', () => ({
  InteractionLayer: () => null,
  ProfileButton: ({ label, onPress, testID }: any) => React.createElement('Pressable', { testID, onPress, accessibilityLabel: label }),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { background: '#000', text: '#fff', muted: '#aaa', border: '#333', card: '#111', cardElevated: '#222', cardGlass: '#111E', accent: '#eee', onAccent: '#000' } }),
}));

import { CoverCoachmarkSheet, useProfileCover } from '@/components/profile/ProfileCover';
import {
  clampTrim, defaultTrim, needsTrim, pickerDurationSeconds, shouldShowCoverCoachmark,
} from '@/components/profile/profileCoverRules';

let latest: ReturnType<typeof useProfileCover> | null = null;
function Harness({ own = true, videoUrl = null as string | null }) {
  const flow = useProfileCover({ own, cover: { videoUrl, posterUrl: null }, userId: 'user_me' });
  latest = flow;
  return <CoverCoachmarkSheet visible={flow.coachmarkVisible} onAdd={flow.startAdd} onLater={flow.dismissCoachmark} />;
}

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }
async function mount(props: { own?: boolean; videoUrl?: string | null } = {}) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness {...props} />); await flush(); });
  return renderer;
}
const coachmark = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.testID === 'cover-coachmark' && typeof node.type === 'string');

describe('cover rules', () => {
  it('shows the coach mark only on your own profile, unseen, with no cover', () => {
    expect(shouldShowCoverCoachmark({ own: true, status: { seen: false, hasCover: false }, dismissedLocally: false })).toBe(true);
    expect(shouldShowCoverCoachmark({ own: false, status: { seen: false, hasCover: false }, dismissedLocally: false })).toBe(false);
    expect(shouldShowCoverCoachmark({ own: true, status: { seen: true, hasCover: false }, dismissedLocally: false })).toBe(false);
    expect(shouldShowCoverCoachmark({ own: true, status: { seen: false, hasCover: true }, dismissedLocally: false })).toBe(false);
    expect(shouldShowCoverCoachmark({ own: true, status: null, dismissedLocally: false })).toBe(false);
  });

  it('asks to trim clips over 30s and suggests the first 20s', () => {
    expect(needsTrim(29.9)).toBe(false);
    expect(needsTrim(45)).toBe(true);
    expect(defaultTrim(45)).toEqual({ start: 0, duration: 20 });
    expect(clampTrim(40, 20, 45)).toEqual({ start: 25, duration: 20 });
    expect(clampTrim(0, 60, 45).duration).toBe(30);
    expect(pickerDurationSeconds(45000)).toBe(45);
  });
});

describe('first-visit coach mark', () => {
  beforeEach(() => {
    apiMock.profileCover.coachmark.mockReset();
    apiMock.profileCover.markCoachmarkSeen.mockReset().mockResolvedValue({ seen: true });
    alertMock.mockReset();
  });

  it('shows on the first own-profile visit, hides after "Maybe later", and records it server-side', async () => {
    apiMock.profileCover.coachmark.mockResolvedValue({ seen: false, hasCover: false });
    const renderer = await mount();
    expect(coachmark(renderer)).toHaveLength(1);
    await act(async () => { renderer.root.findByProps({ testID: 'cover-coachmark-later' }).props.onPress(); await flush(); });
    expect(apiMock.profileCover.markCoachmarkSeen).toHaveBeenCalledTimes(1);
    expect(coachmark(renderer)).toHaveLength(0);
    renderer.unmount();
  });

  it('never shows again in a later session once the server flag is set', async () => {
    apiMock.profileCover.coachmark.mockResolvedValue({ seen: true, hasCover: false });
    const renderer = await mount();
    expect(coachmark(renderer)).toHaveLength(0);
    renderer.unmount();
  });

  it('is never shown on someone else’s profile (no request made)', async () => {
    const renderer = await mount({ own: false });
    expect(apiMock.profileCover.coachmark).not.toHaveBeenCalled();
    expect(coachmark(renderer)).toHaveLength(0);
    renderer.unmount();
  });
});

describe('upload flow', () => {
  beforeEach(() => {
    apiMock.profileCover.coachmark.mockReset().mockResolvedValue({ seen: true, hasCover: false });
    apiMock.profileCover.upload.mockReset();
    alertMock.mockReset();
    pickerMock.launchImageLibraryAsync.mockReset();
  });

  it('routes a clip over 30s through trim (20s suggested) before uploading with that trim', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://long.mp4', mimeType: 'video/mp4', duration: 45000 }] });
    apiMock.profileCover.upload.mockResolvedValue({ coverVideoUrl: 'https://x/c', coverPosterUrl: 'https://x/p', coverVideoUpdatedAt: 'now' });
    const renderer = await mount();
    await act(async () => { latest!.startAdd(); await flush(); });
    const options = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => { options.find((o) => o.text === 'Choose from library')!.onPress!(); await flush(); });
    expect(latest!.trimSource).toMatchObject({ uri: 'file://long.mp4', durationSeconds: 45 });
    expect(apiMock.profileCover.upload).not.toHaveBeenCalled();
    await act(async () => { latest!.confirmTrim(defaultTrim(45)); await flush(); });
    expect(apiMock.profileCover.upload).toHaveBeenCalledWith('file://long.mp4', 'video/mp4', { start: 0, duration: 20 });
    expect(latest!.cover).toEqual({ videoUrl: 'https://x/c', posterUrl: 'https://x/p' });
    renderer.unmount();
  });

  it('shows the server’s 24h message when a change is too soon', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://short.mp4', mimeType: 'video/mp4', duration: 12000 }] });
    apiMock.profileCover.upload.mockRejectedValue(new Error('You can change your cover again in 7 hours'));
    const renderer = await mount();
    await act(async () => { latest!.startAdd(); await flush(); });
    const options = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => { options.find((o) => o.text === 'Choose from library')!.onPress!(); await flush(); });
    expect(apiMock.profileCover.upload).toHaveBeenCalledWith('file://short.mp4', 'video/mp4', null);
    expect(alertMock).toHaveBeenLastCalledWith('Cover not updated', 'You can change your cover again in 7 hours');
    renderer.unmount();
  });
});
