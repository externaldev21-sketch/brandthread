/**
 * Shared-element product photo (Pinterest pin open, 1:1): tapping a product
 * photo in a grid grows that exact photo into the product page's hero, and
 * Back shrinks it back into the tile.
 *
 * `/thread-product-detail` is pushed with `animation: 'none'`, so the motion
 * here is the whole transition: one overlay image (SharedPhotoOverlay, mounted
 * once above the stack) morphs from the tile's on-screen frame to the hero's
 * frame on the UI thread with Reanimated, then hands off to the real gallery
 * once the page says its photo is up. Nothing else on either screen moves.
 *
 * Skipped (plain instant open, exactly as before) when Reduce Motion is on, on
 * low-end devices, when the `sharedPhotoTransition` kill switch is off, when
 * the tile can't be measured, or for any other destination.
 */
import { AccessibilityInfo, Dimensions, PixelRatio, Platform, type View } from 'react-native';

export interface Rect { x: number; y: number; width: number; height: number }

export interface Flight {
  id: number;
  kind: 'open' | 'close';
  uri: string;
  from: Rect;
  to: Rect;
  fromRadius: number;
  toRadius: number;
}

type Source = { productId: string; uri: string; rect: Rect; radius: number };

let flight: Flight | null = null;
let heroReadyFor: string | null = null;
let lastSource: Source | null = null;
let killSwitchOn = true;
let reduceMotion = false;
let reduceMotionWatched = false;
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const sharedPhoto = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  current(): Flight | null { return flight; },
  /** The product page calls this once its first photo is on screen. */
  heroReady(productId: string): void {
    heroReadyFor = productId;
    emit();
  },
  isHeroReady(): boolean {
    return !!lastSource && heroReadyFor === lastSource.productId;
  },
  finish(id: number): void {
    if (flight?.id === id) { flight = null; emit(); }
  },
  setKillSwitch(on: boolean): void { killSwitchOn = on; },
};

/** Pure: Android 9 and older, or a low-density screen, is treated as low-end. */
export function isLowEndDevice(os: string, version: string | number, pixelRatio: number): boolean {
  if (os !== 'android') return false;
  const api = typeof version === 'number' ? version : parseInt(String(version), 10);
  return (Number.isFinite(api) && api < 29) || pixelRatio < 2;
}

function watchReduceMotion() {
  if (reduceMotionWatched) return;
  reduceMotionWatched = true;
  AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { reduceMotion = !!v; });
}

export function sharedPhotoAllowed(): boolean {
  watchReduceMotion();
  return killSwitchOn && !reduceMotion && !isLowEndDevice(Platform.OS, Platform.Version, PixelRatio.get());
}

/** Where the product page's hero photo sits: full width at the top, 3:4. */
export function heroRect(): Rect {
  const width = Dimensions.get('window').width;
  return { x: 0, y: 0, width, height: (width * 4) / 3 };
}

/** Pure: a measured rect that is on screen and has a size. */
export function usableRect(r: Rect | null | undefined, screenHeight: number): r is Rect {
  return !!r && r.width > 4 && r.height > 4 && r.y + r.height > 0 && r.y < screenHeight;
}

/** Only the no-animation product route gets the morph; other pushes keep their own transition. */
export function isSharedPhotoRoute(href: unknown): boolean {
  const path = typeof href === 'string' ? href : (href as { pathname?: string } | null)?.pathname;
  return typeof path === 'string' && path.split('?')[0] === '/thread-product-detail';
}

/** Start the open morph from a measured tile. Returns false when it was skipped. */
export function startOpen(src: Source): boolean {
  if (!sharedPhotoAllowed() || !src.uri || !usableRect(src.rect, Dimensions.get('window').height)) {
    lastSource = null;
    return false;
  }
  lastSource = src;
  heroReadyFor = null;
  flight = { id: nextId++, kind: 'open', uri: src.uri, from: src.rect, to: heroRect(), fromRadius: src.radius, toRadius: 0 };
  emit();
  return true;
}

/**
 * Back from the product page: shrink the hero into the tile it came from, but
 * only when that is still truthful — same product, still on its first photo,
 * page scrolled to the top. Otherwise the page just closes.
 */
export function startClose(productId: string, opts: { onFirstPhoto: boolean; atTop: boolean }): boolean {
  const src = lastSource;
  lastSource = null;
  if (!src || src.productId !== productId || !opts.onFirstPhoto || !opts.atTop || !sharedPhotoAllowed()) return false;
  flight = { id: nextId++, kind: 'close', uri: src.uri, from: heroRect(), to: src.rect, fromRadius: 0, toRadius: src.radius };
  emit();
  return true;
}

type Touched = { productId: string; uri: string | null; radius: number; node: View | null; at: number };
let touched: Touched | null = null;

/** SharedPhotoFrame calls this on touch-down, so the open knows which tile it came from. */
export function markSharedPhotoTouched(t: Omit<Touched, 'at'>): void {
  touched = { ...t, at: Date.now() };
}

/**
 * Open a product from a tile: measure the touched SharedPhotoFrame, start the
 * morph when it applies, and navigate. Navigation always happens, at once
 * when there's nothing to measure — the morph only ever decorates it.
 */
export function openWithSharedPhoto(productId: string, navigate: () => void, href?: unknown): void {
  const t = touched;
  touched = null;
  const fresh = t && t.productId === productId && Date.now() - t.at < 2000;
  if (!fresh || !t.uri || !t.node?.measureInWindow || (href !== undefined && !isSharedPhotoRoute(href)) || !sharedPhotoAllowed()) {
    navigate();
    return;
  }
  const uri = t.uri;
  t.node.measureInWindow((x, y, width, height) => {
    startOpen({ productId, uri, rect: { x, y, width, height }, radius: t.radius });
    navigate();
  });
}
