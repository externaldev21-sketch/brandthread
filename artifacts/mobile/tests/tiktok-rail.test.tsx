/**
 * TikTok rail pass: the buyer feed's right action rail is TikTok's stack
 * (avatar + follow, Like, Comment, Save, Share, sound disc — no Repost), sits
 * at ONE fixed position for every post, renders once above the pager, and
 * Repost lives first in the share sheet. Also covers the always-on sound (no
 * mute control) and the paused icon that stays up while paused.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  class Value {
    constructor(public v: number) {}
    setValue(v: number) { this.v = v; }
    interpolate() { return this; }
  }
  const anim = () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {} });
  return {
    View: host('View'),
    Text: host('Text'),
    Image: host('Image'),
    Pressable: (props: Record<string, unknown>) => React.createElement('Pressable', {
      ...props,
      style: typeof props.style === 'function' ? (props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : props.style,
    }, props.children as React.ReactNode),
    StyleSheet: { create: <T,>(s: T) => s, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
    Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
    Easing: { linear: (t: number) => t },
    Animated: { Value, View: host('AnimatedView'), timing: anim, loop: anim, sequence: anim, spring: anim },
  };
});
vi.mock('@expo/vector-icons', () => {
  const React = require('react');
  const icon = (family: string) => (props: Record<string, unknown>) => React.createElement(`${family}Icon`, props);
  return { Feather: icon('Feather'), FontAwesome: icon('FontAwesome') };
});
vi.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('@/lib/haptics', () => ({ hapticLight: () => {} }));
vi.mock('@/components/live/LiveAvatarRing', () => ({
  LiveHostRing: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/live/useLiveDirectory', () => ({ useLiveStreamForHost: () => null }));

import { Animated } from 'react-native';
import { RAIL_HEIGHT, RAIL_LAYOUT, RightActionRail, formatRailCount } from '@/components/buyer-feed/RightActionRail';
import { captionNeedsMore, clampCaption } from '@/components/buyer-feed/captionClamp';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const feed = read('app/(tabs)/feed.tsx');
const railSource = read('components/buyer-feed/RightActionRail.tsx');
const captionSource = read('components/buyer-feed/CaptionBlock.tsx');
const shareSheet = read('components/ThreadShareSheet.tsx');

const anims = {
  heartScale: new Animated.Value(1),
  likeRing: new Animated.Value(0),
  saveDrop: new Animated.Value(0),
  saveScale: new Animated.Value(1),
};
const noop = () => {};

type RailProps = React.ComponentProps<typeof RightActionRail>;
function railProps(overrides: Partial<RailProps>): RailProps {
  return {
    creator: 'Atelier Noire', avatarColor: '#222', initials: 'AN', engagement: undefined,
    commentsCount: 0, shares: 0, saves: 0,
    onOpenCreator: noop, onFollow: noop, onLike: noop, onOpenComments: noop, onSave: noop, onShare: noop,
    anims, style: { bottom: 97, right: 6 }, testIdBase: 'post-a',
    ...overrides,
  };
}

/** Every style that affects layout, in tree order (colours and text dropped). */
function layoutSignature(root: ReactTestInstance): string[] {
  const out: string[] = [];
  const LAYOUT_KEYS = ['position', 'top', 'bottom', 'left', 'right', 'width', 'height', 'minHeight', 'marginTop', 'marginBottom', 'gap', 'flexDirection', 'alignItems', 'justifyContent'];
  // Absolutely positioned overlays (the follow badge, the avatar photo over
  // its same-size placeholder, the like ring) can't move anything else, so
  // they're left out; the rail root itself is absolute and is kept.
  const walk = (node: ReactTestInstance, isRoot: boolean) => {
    let flat: Record<string, unknown> = {};
    if (typeof node.type === 'string') {
      flat = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
      if (!isRoot && flat.position === 'absolute') return;
      const picked = Object.fromEntries(LAYOUT_KEYS.filter(k => k in flat).map(k => [k, flat[k]]));
      out.push(`${node.type}:${JSON.stringify(picked)}`);
    }
    for (const child of node.children) if (typeof child !== 'string') walk(child, isRoot && typeof node.type !== 'string');
  };
  walk(root, true);
  return out;
}

function render(props: RailProps) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<RightActionRail {...props} />); });
  return tree;
}

describe('rail stack is TikTok\'s, with no Repost', () => {
  it('renders avatar, Like, Comment, Save, Share and the sound disc — in that order', () => {
    const tree = render(railProps({}));
    const ids = tree.root.findAll(n => typeof n.type === 'string' && typeof n.props.testID === 'string')
      .map(n => n.props.testID as string)
      .filter(id => /-(btn|disc)-post-a$/.test(id))
      .map(id => id.replace(/-post-a$/, ''));
    expect([...new Set(ids)]).toEqual(['avatar-btn', 'follow-btn', 'like-btn', 'comment-btn', 'save-btn', 'share-btn', 'sound-disc']);
    expect(railSource).not.toMatch(/onRepost|repost-btn|retweet/);
  });

  it('counts always show, starting at 0', () => {
    expect(formatRailCount(0)).toBe('0');
    expect(formatRailCount(undefined)).toBe('0');
    expect(formatRailCount(980)).toBe('980');
    expect(formatRailCount(12_400)).toBe('12.4K');
    const tree = render(railProps({ commentsCount: 0, shares: 0, saves: 0 }));
    const counts = tree.root.findAll(n => (n.type as unknown) === 'Text' && n.props.numberOfLines === 1).map(n => n.props.children);
    expect(counts).toEqual(['0', '0', '0', '0']);
  });

  it('the avatar has no border/ring and the + badge draws none either', () => {
    const avatarStyle = railSource.slice(railSource.indexOf('  avatar: {'), railSource.indexOf('  avatarText:'));
    expect(avatarStyle).not.toMatch(/border(Width|Color)/);
    const badgeStyle = railSource.slice(railSource.indexOf('  followBadge: {'), railSource.indexOf('  followBadgeTouchable:'));
    expect(badgeStyle).not.toMatch(/border(Width|Color)/);
    expect(railSource).not.toContain('Official');
  });
});

describe('rail position is independent of the post', () => {
  it('lays out identically for a video, a slideshow, long/short captions, live or not, any counts', () => {
    const video = render(railProps({ testIdBase: 'video-1', sound: 'After Dark', commentsCount: 980, shares: 2045, saves: 3100, engagement: { likes: 12_400, liked: true } }));
    const slideshow = render(railProps({ testIdBase: 'slides-1', sound: undefined, discSpinning: false, commentsCount: 0, shares: 0, saves: 0, engagement: { following: true, saved: true } }));
    const photo = render(railProps({ testIdBase: 'photo-1', avatarUri: 'https://cdn.example/a.jpg', commentsCount: 1_200_000 }));
    // The disc's artwork (photo or initials) sits inside its fixed 24x24 box.
    const sig = (t: ReturnType<typeof create>) => layoutSignature(t.root).filter(s => s !== 'Text:{}' && s !== 'Image:{"width":24,"height":24}');
    expect(sig(slideshow)).toEqual(sig(video));
    expect(sig(photo)).toEqual(sig(video));
    expect(layoutSignature(video.root)[0]).toContain(`"height":${RAIL_HEIGHT}`);
  });

  it('every row has a fixed height, so the rail is always RAIL_HEIGHT tall', () => {
    expect(RAIL_HEIGHT).toBe(RAIL_LAYOUT.avatarBlock + RAIL_LAYOUT.item * 4 + RAIL_LAYOUT.disc);
    expect(railSource).toMatch(/rail: \{ position: 'absolute', width: RAIL_LAYOUT\.width, height: RAIL_HEIGHT/);
    expect(railSource).not.toContain('onLayout');
  });

  it('feed renders the rail once, above the pager, at one constant bottom', () => {
    expect(feed.match(/<RightActionRail\b/g)).toHaveLength(1);
    expect(feed.match(/<ThreadRailOverlay\b/g)).toHaveLength(1);
    expect(feed).toContain('bottom={progressLine + PROGRESS_LINE_HEIGHT + RAIL_DISC_TO_PROGRESS}');
    expect(feed).toContain('const progressLine = isBuyerSurface ? buyerBarVisualTop + SCRUB_TAB_GAP : bottomClearance;');
    // Nothing about the post (caption height, media, dots) feeds the rail.
    const overlay = feed.slice(feed.indexOf('function ThreadRailOverlay('), feed.indexOf('// CommentsModal replaced'));
    expect(overlay).not.toMatch(/captionBlockHeight|onLayout|mediaUris\.length/);
  });

  it('caption has one fixed bottom anchor and never measures itself to position anything', () => {
    expect(feed).toContain('style={[chromeStyle, { bottom: bottomClearance + CAPTION_BOTTOM_GAP }]}');
    expect(captionSource).not.toContain('rootWithRepost');
    expect(captionSource).not.toContain('useHitAreaBoost();\n  const captionHit');
    expect(captionSource).not.toMatch(/creatorHit|captionHit/);
  });
});

describe('caption: one 2-line clamp + "more" for every post, no sound line', () => {
  it('needs "more" past two lines, whatever the post type', () => {
    expect(captionNeedsMore('Short caption.')).toBe(false);
    expect(captionNeedsMore('Three looks from the new drop, layered for the cold snap. Swipe through for the coat, the knit and the boots.')).toBe(true);
    expect(captionNeedsMore('one\ntwo\nthree')).toBe(true);
  });

  it('cuts the collapsed text so "… more" fits on line two', () => {
    const long = 'Three looks from the new drop, layered for the cold snap. Swipe through for the coat, the knit and the boots.';
    const clamped = clampCaption(long);
    expect(clamped.length).toBeLessThanOrEqual(42 * 2 - 7);
    expect(long.startsWith(clamped)).toBe(true);
  });

  it('has no sound/mute row any more', () => {
    expect(captionSource).not.toMatch(/onToggleSound|soundOn|soundRow|Mute sound/);
  });
});

describe('Repost moved to the share sheet', () => {
  it('is the first action of the share sheet, with Remove repost when already reposted', () => {
    const topRow = shareSheet.indexOf('<ShareAction');
    expect(shareSheet.slice(topRow, topRow + 200)).toContain("label={reposted ? 'Remove repost' : 'Repost'}");
    expect(shareSheet.indexOf('thread-share-repost')).toBeLessThan(shareSheet.indexOf('friends.map(friend =>'));
  });

  it('keeps the feed\'s repost logic (API call, undo, education, toasts) behind the new entry point', () => {
    expect(feed).toContain('onRepost={() => onRepost(item.id)}');
    expect(feed).toContain('onRepost={handleRepost}');
    expect(feed).toContain("type: 'repost',");
    expect(feed).toContain("value: willRepost ? undefined : 'remove',");
    expect(feed).toContain('await showRepostEducationOnce();');
    expect(feed).toContain("showToast('Could not repost. Try again.', 'error');");
  });
});

describe('sound is always on — no mute control', () => {
  const soundHook = read('hooks/useFeedSound.ts');
  it('has no mute toggle anywhere in the feed', () => {
    expect(feed).not.toMatch(/toggleSound|onToggleSound|setSoundOn|SOUND_PREF_KEY/);
    expect(feed).toContain('const soundOn = useFeedSound();');
  });

  it('plays in silent mode on iOS and stops other audio; web unmutes on the first gesture', () => {
    expect(soundHook).toContain("setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' })");
    expect(soundHook).toContain("['pointerdown', 'touchstart', 'keydown', 'wheel']");
    expect(feed).toContain('player.muted = muted;');
  });
});

describe('paused icon', () => {
  it('stays visible for as long as the video is paused (opacity follows `paused`, no timed fade-out)', () => {
    expect(feed).toContain('Animated.timing(pauseOverlayOpacity, { toValue: paused ? 1 : 0, duration: 180, useNativeDriver: true }).start();');
    expect(feed).toContain('<PausedPlayIcon />');
    expect(feed).not.toMatch(/pauseOverlayOpacity, \{ toValue: 0, duration: \d+, delay/);
  });

  it('is a ~60pt, semi-transparent, rounded play glyph', () => {
    const icon = read('components/buyer-feed/PausedPlayIcon.tsx');
    expect(icon).toContain('export const PAUSED_ICON_SIZE = 60;');
    expect(icon).toContain('strokeLinejoin="round"');
    expect(icon).toContain('<G opacity={0.8}>');
  });

  it('swiping away from a paused video and back plays it again (TikTok)', () => {
    expect(feed).toContain('if (!isActive) setPaused(false);');
  });
});
