import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Profile banner (TikTok's profile banner, 1:1): the pure rules, the "Edit
// banner" action sheet (Choose GIF / Choose video / Remove banner), the
// pick → (trim) → crop → upload flow, the banner header itself, and the no-banner
// fallback in the shared ProfileShell.

const { apiMock, actionSheetMock, pickerMock, docPickerMock, alertMock, emitMock, platform } = vi.hoisted(() => ({
  apiMock: {
    profileCover: {
      upload: vi.fn(),
      uploadGif: vi.fn(),
      remove: vi.fn(),
      coachmark: vi.fn(async () => ({ seen: true, hasCover: false })),
      markCoachmarkSeen: vi.fn(),
    },
  },
  actionSheetMock: vi.fn(),
  pickerMock: { launchImageLibraryAsync: vi.fn(), UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' } },
  docPickerMock: { getDocumentAsync: vi.fn() },
  alertMock: vi.fn(),
  emitMock: vi.fn(),
  platform: { OS: 'ios' as string },
}));

vi.mock('react-native', () => {
  const ReactActual = require('react') as typeof import('react');
  const host = (name: string) => (props: any) => ReactActual.createElement(name, props, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
  class AnimatedValue {
    constructor(public v: number) {}
    setValue(v: number) { this.v = v; }
    interpolate() { return 0; }
    addListener() { return 'id'; }
    removeListener() {}
  }
  return {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'), Modal: host('Modal'),
    ActivityIndicator: host('ActivityIndicator'), FlatList: host('FlatList'), RefreshControl: host('RefreshControl'),
    Image: { getSize: vi.fn() },
    Animated: {
      Value: AnimatedValue, View: host('Animated.View'), event: () => () => {},
      createAnimatedComponent: (component: unknown) => component, spring: () => ({ start: () => {} }),
    },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Platform: { get OS() { return platform.OS; }, select: (obj: Record<string, unknown>) => obj[platform.OS] ?? obj.default },
    Alert: { alert: alertMock },
    ActionSheetIOS: { showActionSheetWithOptions: actionSheetMock },
    StatusBar: host('StatusBar'),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});
vi.mock('expo-image-picker', () => pickerMock);
vi.mock('expo-document-picker', () => docPickerMock);
vi.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: vi.fn(), pause: vi.fn(), currentTime: 0, addListener: () => ({ remove() {} }) }),
  VideoView: (props: any) => React.createElement('VideoView', props),
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: (props: any) => React.createElement('LinearGradient', props) }));
vi.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]) }));
vi.mock('react-native-gesture-handler', () => {
  const chain = (): any => new Proxy({}, { get: () => () => chain() });
  return {
    Gesture: { Pan: chain, Pinch: chain, Simultaneous: chain },
    GestureDetector: ({ children }: any) => children,
    GestureHandlerRootView: (props: any) => React.createElement('View', props, props.children),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 47 }));
const { maskMock } = vi.hoisted(() => ({ maskMock: vi.fn() }));
vi.mock('@/components/layout/ScreenChrome', () => ({ useSuppressStatusBarMask: maskMock }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticSelection: vi.fn() }));
vi.mock('@/lib/profileEvents', () => ({ emitProfileEvent: emitMock, subscribeProfileEvents: () => () => {} }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: ({ children, ...rest }: any) => React.createElement('Pressable', rest, typeof children === 'function' ? children({ pressed: false }) : children),
}));
vi.mock('@/components/profile/ProfileControls', () => ({
  InteractionLayer: () => null,
  ProfileButton: ({ label, onPress, testID }: any) => React.createElement('Pressable', { testID, onPress, accessibilityLabel: label }),
}));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false, isPreviewDemoMode: () => false }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: (props: any) => React.createElement('CachedImage', props) }));
vi.mock('@/components/profile/ProfileThread', () => ({ ProfileThread: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#000000', text: '#ffffff', muted: '#aaaaaa', border: '#333333', card: '#111111', cardElevated: '#222222',
      cardGlass: '#111111', accent: '#eeeeee', onAccent: '#000000', error: '#ff3b30', heroGradient: ['#000', '#111'], glowGradient: ['#000', '#111'],
    },
  }),
}));

import {
  bannerAspect, bannerCoversStatusBar, bannerHeight, bannerHeroMedia, bannerNeedsTrim, bannerSheetOptions, bannerStill, isGifAsset, resolveProfileBanner,
} from '@/components/profile/profileBannerRules';
import { coverQuery } from '@/lib/profileBannerApi';
import { bannerCropRect, BannerActionSheet, EditProfileBanner, useProfileBanner } from '@/components/profile/ProfileBannerEditor';
import { bannerStats, ProfileBannerHeader } from '@/components/profile/ProfileBannerHeader';

const VIDEO = { type: 'video' as const, url: 'https://cdn.x/cover.mp4', posterUrl: 'https://cdn.x/poster.jpg', gifUrl: null };
/** A GIF the server converted: plays its MP4 loop, original kept. */
const GIF = { type: 'gif' as const, url: 'https://cdn.x/loop.mp4', posterUrl: 'https://cdn.x/first.jpg', gifUrl: 'https://cdn.x/orig.gif' };
/** A GIF the server couldn't convert: the GIF itself animates. */
const RAW_GIF = { type: 'gif' as const, url: 'https://cdn.x/orig.gif', posterUrl: null, gifUrl: 'https://cdn.x/orig.gif' };
type Banner = typeof VIDEO | typeof GIF | typeof RAW_GIF;

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }
const byTestId = (renderer: ReactTestRenderer, id: string) => renderer.root.findAll((node) => node.props.testID === id && typeof node.type === 'string');

describe('banner rules', () => {
  it('"Edit banner" sheet: Choose GIF, Choose video, and Remove banner only when one is set (no static photo)', () => {
    expect(bannerSheetOptions(false).map((option) => option.label)).toEqual(['Choose GIF', 'Choose video']);
    expect(bannerSheetOptions(true).map((option) => option.label)).toEqual(['Choose GIF', 'Choose video', 'Remove banner']);
    expect(bannerSheetOptions(true)[2]).toMatchObject({ key: 'remove', destructive: true });
  });

  it('sends videos over 10s to the trim screen; 10s or less go straight to crop', () => {
    expect(bannerNeedsTrim(9)).toBe(false);
    expect(bannerNeedsTrim(10.2)).toBe(false);
    expect(bannerNeedsTrim(10.5)).toBe(true);
    expect(bannerNeedsTrim(42)).toBe(true);
    expect(bannerNeedsTrim(null)).toBe(false);
  });

  it('accepts GIFs only (by MIME type, else by file name)', () => {
    expect(isGifAsset({ mimeType: 'image/gif', uri: 'file://a' })).toBe(true);
    expect(isGifAsset({ mimeType: 'image/jpeg', uri: 'file://a.gif' })).toBe(false);
    expect(isGifAsset({ uri: 'file://dance.GIF' })).toBe(true);
    expect(isGifAsset({ name: 'loop.gif', uri: 'file://x' })).toBe(true);
    expect(isGifAsset({ uri: 'file://photo.png' })).toBe(false);
  });

  it('sizes the banner to ~45% of the screen, edge to edge', () => {
    expect(bannerHeight(844)).toBe(380);
    expect(bannerAspect(390, 844)).toBeCloseTo(390 / 380, 5);
  });

  it('reads profileBanner, falls back to a cover video on older responses, and never renders non-http media', () => {
    expect(resolveProfileBanner({ profileBanner: GIF })).toEqual(GIF);
    expect(resolveProfileBanner({ profileBanner: null, coverVideoUrl: VIDEO.url })).toBeNull();
    expect(resolveProfileBanner({ coverVideoUrl: VIDEO.url, coverPosterUrl: VIDEO.posterUrl })).toEqual(VIDEO);
    expect(resolveProfileBanner({ coverVideoUrl: null })).toBeNull();
    expect(resolveProfileBanner({ profileBanner: { type: 'gif', url: '/objects/x', posterUrl: null } })).toBeNull();
    expect(resolveProfileBanner(null)).toBeNull();
  });

  it('a converted GIF plays its MP4 loop; an unconverted GIF animates itself; a video gets its poster first', () => {
    expect(bannerHeroMedia(GIF)).toEqual({ videoUri: GIF.url, posterUri: GIF.posterUrl, gifUri: null });
    expect(bannerHeroMedia(RAW_GIF)).toEqual({ videoUri: null, posterUri: null, gifUri: RAW_GIF.url });
    expect(bannerHeroMedia(VIDEO)).toEqual({ videoUri: VIDEO.url, posterUri: VIDEO.posterUrl, gifUri: null });
  });

  it('a seller\'s former storefront banner (adopted server-side as type image) renders as a still', () => {
    const STILL = { type: 'image' as const, url: 'https://cdn.x/storefront.jpg', posterUrl: 'https://cdn.x/storefront.jpg', gifUrl: null };
    expect(resolveProfileBanner({ profileBanner: STILL })).toEqual(STILL);
    expect(bannerHeroMedia(STILL)).toEqual({ videoUri: null, posterUri: STILL.url, gifUri: null });
  });

  it('the storefront cover (brand cards, previews) is the banner\'s still frame', () => {
    expect(bannerStill(null)).toBeNull();
    expect(bannerStill(VIDEO)).toBe(VIDEO.posterUrl);
    expect(bannerStill(GIF)).toBe(GIF.posterUrl);
    expect(bannerStill(RAW_GIF)).toBe(RAW_GIF.gifUrl);
    expect(bannerStill({ type: 'image', url: 'https://cdn.x/s.jpg', posterUrl: null })).toBe('https://cdn.x/s.jpg');
  });

  it('orders the banner stats Following · Followers · Likes', () => {
    const stats = [
      { key: 'followers', label: 'Followers', value: '3K' },
      { key: 'likes', label: 'Likes', value: '9' },
      { key: 'following', label: 'Following', value: '12' },
    ];
    expect(bannerStats(stats).map((stat) => stat.key)).toEqual(['following', 'followers', 'likes']);
  });

  it('maps the crop frame to a normalized source rect', () => {
    // 1080×1920 portrait clip in a 390×380 frame, centered, no zoom → full width, middle band.
    const centered = bannerCropRect({ sourceWidth: 1080, sourceHeight: 1920, frameWidth: 390, frameHeight: 380, scale: 1, translateX: 0, translateY: 0 });
    expect(centered.x).toBeCloseTo(0, 5);
    expect(centered.width).toBeCloseTo(1, 5);
    expect(centered.height).toBeCloseTo((380 / 390) * (1080 / 1920), 4);
    expect(centered.y).toBeCloseTo((1 - centered.height) / 2, 4);
    // Dragging the media down reveals the top of the clip.
    const top = bannerCropRect({ sourceWidth: 1080, sourceHeight: 1920, frameWidth: 390, frameHeight: 380, scale: 1, translateX: 0, translateY: 10_000 });
    expect(top.y).toBe(0);
  });

  it('builds the upload query (trim + crop) for the API', () => {
    expect(coverQuery(null, null)).toBe('');
    expect(coverQuery({ start: 0, duration: 15 }, { x: 0, y: 0.25, width: 1, height: 0.5 }))
      .toBe('?trimStart=0.00&trimDuration=15.00&cropX=0.0000&cropY=0.2500&cropW=1.0000&cropH=0.5000');
  });
});

let flow: ReturnType<typeof useProfileBanner> | null = null;
function Harness({ banner }: { banner: Banner | null }) {
  flow = useProfileBanner({ banner, userId: 'user_me' });
  return <>{flow.sheet}</>;
}
async function mount(banner: Banner | null) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness banner={banner} />); await flush(); });
  return renderer;
}

describe('"Edit banner" flow', () => {
  beforeEach(() => {
    platform.OS = 'ios';
    actionSheetMock.mockReset();
    pickerMock.launchImageLibraryAsync.mockReset();
    apiMock.profileCover.upload.mockReset();
    apiMock.profileCover.uploadGif.mockReset();
    apiMock.profileCover.remove.mockReset();
    docPickerMock.getDocumentAsync.mockReset();
    alertMock.mockReset();
    emitMock.mockReset();
  });

  it('opens the native iOS action sheet with Choose GIF / Choose video / Remove banner / Cancel', async () => {
    const renderer = await mount(GIF);
    act(() => { flow!.openSheet(); });
    const [options] = actionSheetMock.mock.calls[0];
    expect(options.options).toEqual(['Choose GIF', 'Choose video', 'Remove banner', 'Cancel']);
    expect(options.cancelButtonIndex).toBe(3);
    expect(options.destructiveButtonIndex).toBe(2);
    renderer.unmount();
  });

  it('without a banner the sheet has no Remove option', async () => {
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    expect(actionSheetMock.mock.calls[0][0].options).toEqual(['Choose GIF', 'Choose video', 'Cancel']);
    renderer.unmount();
  });

  it('Choose GIF (iOS) → Photo Library keeps the original GIF → crop → uploads it for MP4 conversion', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://dance.gif', mimeType: 'image/gif', width: 480, height: 480, fileSize: 2_000_000 }] });
    apiMock.profileCover.uploadGif.mockResolvedValue({ profileBanner: GIF });
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    act(() => { actionSheetMock.mock.calls[0][1](0); });
    // The system follow-up: GIFs come from Photos or Files.
    expect(actionSheetMock.mock.calls[1][0].options).toEqual(['Photo Library', 'Files', 'Cancel']);
    await act(async () => { actionSheetMock.mock.calls[1][1](0); await flush(); });
    expect(pickerMock.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], preferredAssetRepresentationMode: 'current' }));
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(1);
    // The GIF animates in the crop frame.
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'CachedImage' && node.props.source?.uri === 'file://dance.gif' && node.props.autoplay === true)).toHaveLength(1);
    await act(async () => { byTestId(renderer, 'banner-crop-save')[0].props.onPress(); await flush(); });
    expect(apiMock.profileCover.uploadGif).toHaveBeenCalledWith('file://dance.gif', expect.objectContaining({ width: expect.any(Number) }));
    expect(flow!.banner).toEqual(GIF);
    expect(emitMock).toHaveBeenCalledWith({ type: 'banner', ownerId: 'user_me', banner: GIF });
    renderer.unmount();
  });

  it('Choose GIF (iOS) → Files picks a .gif document', async () => {
    docPickerMock.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://loop.gif', name: 'loop.gif', mimeType: 'image/gif', size: 900_000 }] });
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    act(() => { actionSheetMock.mock.calls[0][1](0); });
    await act(async () => { actionSheetMock.mock.calls[1][1](1); await flush(); });
    expect(docPickerMock.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/gif' }));
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(1);
    renderer.unmount();
  });

  it('refuses a non-GIF picked under Choose GIF, and GIFs over ~15MB', async () => {
    const renderer = await mount(null);
    pickerMock.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://photo.jpg', mimeType: 'image/jpeg', width: 10, height: 10 }] });
    act(() => { flow!.openSheet(); });
    act(() => { actionSheetMock.mock.calls[0][1](0); });
    await act(async () => { actionSheetMock.mock.calls[1][1](0); await flush(); });
    expect(alertMock).toHaveBeenLastCalledWith('Choose a GIF', expect.any(String));
    pickerMock.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://huge.gif', mimeType: 'image/gif', width: 10, height: 10, fileSize: 16 * 1024 * 1024 }] });
    act(() => { flow!.openSheet(); });
    act(() => { actionSheetMock.mock.calls[2][1](0); });
    await act(async () => { actionSheetMock.mock.calls[3][1](0); await flush(); });
    expect(alertMock).toHaveBeenLastCalledWith('GIF too large', 'GIFs can be up to 15MB.');
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(0);
    renderer.unmount();
  });

  it('Choose video over 10s → trim screen picks the 10s window → crop → uploads with that window (no hard cut)', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://long.mp4', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 42000 }] });
    apiMock.profileCover.upload.mockResolvedValue({ coverVideoUrl: VIDEO.url, coverPosterUrl: VIDEO.posterUrl, profileBanner: VIDEO });
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    await act(async () => { actionSheetMock.mock.calls[0][1](1); await flush(); });
    expect(pickerMock.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['videos'] }));
    // Trim screen first; nothing uploaded yet.
    expect(byTestId(renderer, 'cover-trim')).toHaveLength(1);
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(0);
    // The chosen window (here 12s–22s) is what gets uploaded.
    const trimSheet = renderer.root.findAll((node) => typeof node.props.onConfirm === 'function' && node.props.source)[0];
    await act(async () => { trimSheet.props.onConfirm({ start: 12, duration: 10 }); await flush(); });
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(1);
    await act(async () => { byTestId(renderer, 'banner-crop-save')[0].props.onPress(); await flush(); });
    const [uri, mime, trim, crop] = apiMock.profileCover.upload.mock.calls[0];
    expect([uri, mime, trim]).toEqual(['file://long.mp4', 'video/mp4', { start: 12, duration: 10 }]);
    expect(crop.width).toBeCloseTo(1, 5);
    expect(flow!.banner).toEqual(VIDEO);
    renderer.unmount();
  });

  it('a video of 10s or less skips the trim screen', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://short.mp4', mimeType: 'video/mp4', width: 1080, height: 1920, duration: 8000 }] });
    apiMock.profileCover.upload.mockResolvedValue({ coverVideoUrl: VIDEO.url, coverPosterUrl: VIDEO.posterUrl, profileBanner: VIDEO });
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    await act(async () => { actionSheetMock.mock.calls[0][1](1); await flush(); });
    expect(byTestId(renderer, 'cover-trim')).toHaveLength(0);
    await act(async () => { byTestId(renderer, 'banner-crop-save')[0].props.onPress(); await flush(); });
    expect(apiMock.profileCover.upload.mock.calls[0][2]).toBeNull();
    renderer.unmount();
  });

  it('Cancel on the crop screen uploads nothing', async () => {
    pickerMock.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://short.mp4', mimeType: 'video/mp4', width: 800, height: 800, duration: 5000 }] });
    const renderer = await mount(null);
    act(() => { flow!.openSheet(); });
    await act(async () => { actionSheetMock.mock.calls[0][1](1); await flush(); });
    await act(async () => { byTestId(renderer, 'banner-crop-cancel')[0].props.onPress(); await flush(); });
    expect(byTestId(renderer, 'banner-crop')).toHaveLength(0);
    expect(apiMock.profileCover.upload).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('Remove banner clears it', async () => {
    apiMock.profileCover.remove.mockResolvedValue({ profileBanner: null });
    const renderer = await mount(VIDEO);
    act(() => { flow!.openSheet(); });
    await act(async () => { actionSheetMock.mock.calls[0][1](2); await flush(); });
    expect(apiMock.profileCover.remove).toHaveBeenCalled();
    expect(flow!.banner).toBeNull();
    renderer.unmount();
  });

  it('Android / web draw the same sheet in-app', async () => {
    platform.OS = 'android';
    const renderer = await mount(VIDEO);
    act(() => { flow!.openSheet(); });
    expect(actionSheetMock).not.toHaveBeenCalled();
    expect(byTestId(renderer, 'banner-action-sheet')).toHaveLength(1);
    expect(byTestId(renderer, 'banner-sheet-gif')).toHaveLength(1);
    expect(byTestId(renderer, 'banner-sheet-video')).toHaveLength(1);
    expect(byTestId(renderer, 'banner-sheet-remove')).toHaveLength(1);
    expect(byTestId(renderer, 'banner-sheet-cancel')).toHaveLength(1);
    renderer.unmount();
  });

  it('the in-app sheet hides Remove without a banner', () => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<BannerActionSheet visible hasBanner={false} onChoose={() => {}} onClose={() => {}} />); });
    expect(byTestId(renderer, 'banner-sheet-remove')).toHaveLength(0);
    renderer.unmount();
  });
});

describe('banner header', () => {
  const stats = [
    { key: 'followers', label: 'Followers', value: '3K' },
    { key: 'following', label: 'Following', value: '12' },
    { key: 'likes', label: 'Likes', value: '9' },
  ];
  const render = (banner: Banner, active: boolean) => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(
    <ProfileBannerHeader
      banner={banner}
      height={380}
      active={active}
      posterOnly={false}
      topPad={47}
      avatar={<React.Fragment />}
      note={{ text: 'On your mind…', placeholder: true }}
      name="Jordan Vale"
      handle="@jordan"
      stats={stats}
    />,
    ); });
    return renderer;
  };

  it('a video banner shows its poster frame first (no blank flash)', () => {
    const renderer = render(VIDEO, true);
    expect(byTestId(renderer, 'profile-banner-video')).toHaveLength(1);
    const hero = renderer.root.findAll((node) => node.props.testID === 'profile-hero-media')[0];
    expect(hero).toBeTruthy();
    // poster overlays the player until the first frame plays
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'CachedImage' && node.props.source?.uri === VIDEO.posterUrl)).toHaveLength(1);
    renderer.unmount();
  });

  it('a converted GIF loops through the video player (seamless MP4), poster first', () => {
    const renderer = render(GIF, true);
    expect(byTestId(renderer, 'profile-banner-gif')).toHaveLength(1);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'VideoView')).toHaveLength(1);
    renderer.unmount();
  });

  it('an unconverted GIF animates via expo-image only while active (paused off-screen)', () => {
    const playing = render(RAW_GIF, true);
    const gif = () => playing.root.findAll((node) => (node.type as unknown) === 'CachedImage' && node.props.source?.uri === RAW_GIF.url)[0];
    expect(gif().props.autoplay).toBe(true);
    playing.unmount();
    const paused = render(RAW_GIF, false);
    expect(paused.root.findAll((node) => (node.type as unknown) === 'CachedImage' && node.props.source?.uri === RAW_GIF.url)[0].props.autoplay).toBe(false);
    paused.unmount();
  });

  it('shows name, handle, stats (Following · Followers · Likes) and the status bubble on the banner', () => {
    const renderer = render(VIDEO, false);
    expect(byTestId(renderer, 'profile-banner-note')).toHaveLength(1);
    const statKeys = byTestId(renderer, 'profile-banner-stats')[0].findAll((node) => /^profile-stat-/.test(node.props.testID ?? '') && typeof node.type === 'string').map((node) => node.props.testID);
    expect(statKeys).toEqual(['profile-stat-following', 'profile-stat-followers', 'profile-stat-likes']);
    renderer.unmount();
  });
});

describe('banner behind the status bar', () => {
  it('only at rest at the top (and pull-to-refresh overscroll); any real scroll brings the strip back', () => {
    expect(bannerCoversStatusBar(0)).toBe(true);
    expect(bannerCoversStatusBar(-60)).toBe(true);
    expect(bannerCoversStatusBar(5)).toBe(true);
    expect(bannerCoversStatusBar(8)).toBe(false);
    expect(bannerCoversStatusBar(240)).toBe(false);
  });

  const renderHeader = (coversTop: boolean) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ProfileBannerHeader banner={VIDEO} height={380} active posterOnly={false} topPad={47} avatar={<React.Fragment />} name="N" stats={[]} coversTop={coversTop} />,
      );
    });
    return renderer;
  };

  it('while the banner covers the top it lifts the status-bar strip and turns the status bar light', () => {
    maskMock.mockClear();
    const renderer = renderHeader(true);
    expect(maskMock).toHaveBeenLastCalledWith(true);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'StatusBar' && node.props.barStyle === 'light-content')).toHaveLength(1);
    renderer.unmount();
  });

  it('scrolled past the banner, the strip is back (content never slides under the clock)', () => {
    maskMock.mockClear();
    const renderer = renderHeader(false);
    expect(maskMock).toHaveBeenLastCalledWith(false);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'StatusBar')).toHaveLength(0);
    renderer.unmount();
  });
});

describe('empty banner placeholder (owners)', () => {
  const hostTap = (renderer: ReactTestRenderer, id: string) =>
    renderer.root.findAll((node) => node.props.testID === id && typeof node.props.onPress === 'function')[0];

  it('own profile with no banner: a dark "Add banner" placeholder that opens the banner sheet', () => {
    const onAdd = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ProfileBannerHeader banner={null} height={380} active posterOnly={false} topPad={47} avatar={<React.Fragment />} name="N" stats={[]} onAddBanner={onAdd} />,
      );
    });
    expect(byTestId(renderer, 'profile-banner-placeholder')).toHaveLength(1);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'VideoView')).toHaveLength(0);
    act(() => { hostTap(renderer, 'profile-banner-placeholder-add').props.onPress(); });
    expect(onAdd).toHaveBeenCalled();
    renderer.unmount();
  });

  it('Edit profile with no banner: the banner area itself reads "Add banner" (no extra pill)', () => {
    const onEdit = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<EditProfileBanner banner={null} busy={null} onEditBanner={onEdit} avatar={<React.Fragment />} onEditAvatar={() => {}} />);
    });
    expect(byTestId(renderer, 'edit-banner-button')).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Edit banner')).toHaveLength(0);
    act(() => { hostTap(renderer, 'edit-banner-button-add').props.onPress(); });
    expect(onEdit).toHaveBeenCalled();
    renderer.unmount();
  });

  it('Edit profile with a banner: the "Edit banner" pill, no placeholder', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<EditProfileBanner banner={VIDEO} busy={null} onEditBanner={() => {}} avatar={<React.Fragment />} onEditAvatar={() => {}} />);
    });
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Edit banner' && typeof node.type === 'string')).toHaveLength(1);
    expect(byTestId(renderer, 'edit-banner-button-add')).toHaveLength(0);
    renderer.unmount();
  });
});
