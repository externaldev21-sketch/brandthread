/**
 * Physical display corner radius, in points, for the device this window is
 * on — so an edge-hugging outline (the Studio menu's edge-trace,
 * components/SellerStudioRadialMenu.tsx) can draw its corners CONCENTRIC
 * with the screen's own rounded corners and never get clipped by them.
 *
 * Dev's bug: the trace was a rounded rect with a fixed 28pt corner radius
 * drawn 8pt inside the window — but an iPhone 15's display corners are
 * ~55pt, so at every corner the trace's arc sat outside the visible glass
 * and the four corners were cut off. The right geometry for an outline
 * inset by `d` inside a corner of radius `R` is a concentric arc of radius
 * `R - d` (0 → a square corner on a square-cornered display).
 *
 * No native dependency: iOS exposes the real value only through a private
 * UIScreen key (`_displayCornerRadius`), which is what
 * react-native-screen-corner-radius reads — an old (0.2.x), new-arch-
 * unverified native module that would also drop this app out of Expo Go
 * (tests/expo-go-startup.device.mjs) for one number. A lookup table keyed
 * by the window's point size covers every iPhone/iPad Apple has shipped,
 * and safe-area insets separate the Face ID (rounded) iPads/Androids from
 * home-button (square) ones where the point size alone is ambiguous.
 *
 * Pure and platform-agnostic by design (the caller passes Platform.OS in)
 * so it's directly unit-testable: see lib/__tests__/displayCornerRadius.test.ts.
 */

export interface DisplayCornerRadiusInput {
  /** Window size in points, either orientation (normalised internally). */
  width: number;
  height: number;
  /** Safe-area insets, in points, for the current orientation. */
  insets: { top: number; bottom: number; left: number; right: number };
  /** `Platform.OS` — 'ios' | 'android' | 'web' | ... */
  platform: string;
}

/**
 * iPhone display corner radii, keyed by `${shortSide}x${longSide}` in
 * points (so rotation doesn't matter). Values are the UIScreen
 * `_displayCornerRadius` Apple reports per model. Models that share a point
 * size but differ by a few points (e.g. iPhone X 39 vs 12 mini 44) use the
 * SMALLER value: an outline a few points tighter than the glass is
 * invisible, one that's looser gets clipped, which is the bug this fixes.
 */
const IPHONE_CORNER_RADIUS_BY_SIZE: Record<string, number> = {
  // Home-button iPhones — square-cornered displays.
  '320x568': 0,  // SE (1st gen), 5s
  '375x667': 0,  // 6/7/8, SE (2nd/3rd gen)
  '414x736': 0,  // 6/7/8 Plus
  // Notch / Dynamic Island iPhones.
  '375x812': 39, // X, XS, 11 Pro (39); 12 mini, 13 mini (44) — smaller wins
  '414x896': 41, // XR, 11 (41.5), XS Max, 11 Pro Max (39.5 → 39 would be
                 // safest, but XR/11 are far more common; 41 is inside both
                 // within a point of a 3pt stroke's own half-width)
  '390x844': 47, // 12, 12 Pro, 13, 13 Pro, 14
  '428x926': 53, // 12 Pro Max, 13 Pro Max, 14 Plus
  '393x852': 55, // 14 Pro, 15, 15 Pro, 16
  '430x932': 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  '402x874': 62, // 16 Pro
  '440x956': 62, // 16 Pro Max
};

/** iPads with Face ID / no home button (Pro 2018+, Air 4+, mini 6, 10th
 *  gen iPad) have ~18pt display corners; every home-button iPad is square.
 *  Telling them apart by point size alone is unreliable (an 820x1180 Air
 *  and a square-cornered 810x1080 iPad are a few points apart, and split
 *  view/Stage Manager shrink the window arbitrarily), so the safe-area top
 *  inset is the discriminator: home-button iPads report exactly the 20pt
 *  status bar, Face ID iPads 24pt. */
const IPAD_FACE_ID_CORNER_RADIUS = 18;
const IPAD_FACE_ID_MIN_TOP_INSET = 24;

/** Android has no public corner-radius API (RoundedCorner is API 31+ and
 *  not bridged by RN). Devices with a cutout/gesture inset (safe-area top
 *  above the classic 24dp status bar) are overwhelmingly rounded, ~24dp
 *  being the common system default; everything else is treated square. */
const ANDROID_ROUNDED_CORNER_RADIUS = 24;
const ANDROID_CLASSIC_STATUS_BAR_DP = 24;

function iPhoneKey(width: number, height: number): string {
  const short = Math.round(Math.min(width, height));
  const long = Math.round(Math.max(width, height));
  return `${short}x${long}`;
}

/**
 * The display's corner radius in points — 0 for square-cornered displays
 * and for anything unknown, so an outline derived from it can only ever be
 * TIGHTER than the glass, never looser (looser is what clips).
 */
export function getDisplayCornerRadius({ width, height, insets, platform }: DisplayCornerRadiusInput): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const shortSide = Math.min(width, height);
  const isTabletClass = shortSide >= 600;

  if (platform === 'ios') {
    if (isTabletClass) {
      return insets.top >= IPAD_FACE_ID_MIN_TOP_INSET ? IPAD_FACE_ID_CORNER_RADIUS : 0;
    }
    const exact = IPHONE_CORNER_RADIUS_BY_SIZE[iPhoneKey(width, height)];
    if (exact !== undefined) return exact;
    // An iPhone size not in the table (a future model, or a zoomed Display
    // setting that reports a non-standard point size): any notch/Island
    // phone has a top inset well above the old 20pt status bar. Use the
    // smallest radius of that family — tighter than the glass, never clipped.
    const hasNotch = Math.max(insets.top, insets.left, insets.right) > 20;
    return hasNotch ? 39 : 0;
  }

  if (platform === 'android') {
    if (isTabletClass) return 0;
    const hasCutoutInset = Math.max(insets.top, insets.left, insets.right) > ANDROID_CLASSIC_STATUS_BAR_DP;
    return hasCutoutInset ? ANDROID_ROUNDED_CORNER_RADIUS : 0;
  }

  // Web: the dev preview is viewed inside a phone-sized browser viewport
  // standing in for the device itself (the screenshot harness and Dev's own
  // 393x852 checks), so a viewport matching a known iPhone point size gets
  // that phone's radius — the frame the preview is imitating. Any other
  // viewport (a desktop window, an unknown size) is a square browser frame.
  if (platform === 'web') {
    if (isTabletClass) return 0;
    return IPHONE_CORNER_RADIUS_BY_SIZE[iPhoneKey(width, height)] ?? 0;
  }

  return 0;
}

/**
 * Corner radius for an outline drawn `inset` points inside the display
 * edge: concentric with the glass, clamped so it can never exceed what the
 * outline's own box can hold.
 */
export function insetOutlineCornerRadius(displayCornerRadius: number, inset: number, boxWidth: number, boxHeight: number): number {
  const concentric = Math.max(0, displayCornerRadius - inset);
  return Math.max(0, Math.min(concentric, boxWidth / 2, boxHeight / 2));
}
