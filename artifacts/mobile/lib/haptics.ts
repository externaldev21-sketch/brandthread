import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * The one haptics service for the app (buyer + seller).
 *
 * Every haptic — named events, the legacy helpers below, and raw
 * `expo-haptics` calls (routed here by shims/expo-haptics.ts, see
 * metro.config.js) — goes through `play()`, which enforces three rules:
 *
 *  1. The Settings › Sounds & haptics switch. Off means silent everywhere.
 *  2. Max one haptic per user action. A second haptic inside the same action
 *     window is dropped (the first one wins), so a tap that also opens a sheet
 *     or finishes a request never buzzes twice.
 *  3. Never on web.
 *
 * Haptics are best-effort: unsupported devices never turn a successful
 * interaction into a rejected promise.
 */

// ─── The map ─────────────────────────────────────────────────────────────────

export type HapticKind = 'light' | 'soft' | 'medium' | 'heavy' | 'rigid' | 'selection' | 'success' | 'warning' | 'error';

/**
 * Named events, one per kind of user action. Anything not listed here (plain
 * navigation, scrolling, typing) gets no haptic.
 */
export const HAPTIC_MAP = {
  /** Follow anywhere: Threads "+", profile, lists, search, notifications. */
  follow: 'light',
  /** Unfollow (and cancelling a follow request). */
  unfollow: 'selection',
  like: 'light',
  save: 'light',
  addToBag: 'light',
  /** Tab change, chip select, picker scroll, segmented control. */
  select: 'selection',
  tabChange: 'selection',
  /** Sheet open/close, pull-to-refresh trigger, long-press menu open. */
  sheet: 'soft',
  refresh: 'soft',
  longPress: 'soft',
  /** Purchase success, post published, product listed, order shipped. */
  purchaseSuccess: 'success',
  postPublished: 'success',
  productListed: 'success',
  orderShipped: 'success',
  /** Seller: a new order arrives. */
  newOrder: 'success',
  /** Errors: card declined, failed upload. */
  error: 'error',
} as const satisfies Record<string, HapticKind>;

export type HapticEvent = keyof typeof HAPTIC_MAP;

// ─── Settings switch ─────────────────────────────────────────────────────────

let enabled = true;
const listeners = new Set<(enabled: boolean) => void>();

/** Driven by lib/hapticsPreference.ts (persisted) — not called by screens directly. */
export function setHapticsEnabled(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  listeners.forEach((fn) => fn(next));
}

export function isHapticsEnabled() {
  return enabled;
}

export function subscribeHapticsEnabled(fn: (enabled: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ─── One haptic per action ───────────────────────────────────────────────────

/** A tap plus whatever it triggers right away (sheet, optimistic success) lands inside this window. */
export const ACTION_WINDOW_MS = 250;
/** Picker / slider detents arrive faster than that; consecutive ticks only need a short gap. */
export const SELECTION_TICK_MS = 40;

let lastPlayedAt = Number.NEGATIVE_INFINITY;
let lastKind: HapticKind | null = null;

/** Test-only: forget the previous action. */
export function resetHapticsForTests() {
  lastPlayedAt = Number.NEGATIVE_INFINITY;
  lastKind = null;
  enabled = true;
}

function shouldPlay(kind: HapticKind, now: number) {
  if (!enabled) return false;
  if (Platform?.OS === 'web' || process.env.EXPO_OS === 'web') return false;
  const gap = now - lastPlayedAt;
  const window = kind === 'selection' && lastKind === 'selection' ? SELECTION_TICK_MS : ACTION_WINDOW_MS;
  return gap >= window;
}

function fire(kind: HapticKind): Promise<void> {
  switch (kind) {
    case 'light': return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'soft': return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    case 'medium': return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case 'heavy': return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case 'rigid': return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    case 'selection': return Haptics.selectionAsync();
    case 'success': return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning': return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case 'error': return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

/** Plays `kind` if the switch is on and this action hasn't had its haptic yet. Never rejects. */
export function play(kind: HapticKind, nativeAction?: () => Promise<void>): Promise<void> {
  const now = Date.now();
  if (!shouldPlay(kind, now)) return Promise.resolve();
  lastPlayedAt = now;
  lastKind = kind;
  try {
    return Promise.resolve(nativeAction ? nativeAction() : fire(kind)).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** Plays the haptic for a named event from HAPTIC_MAP. */
export function haptic(event: HapticEvent) {
  void play(HAPTIC_MAP[event]);
}

/** `haptics.like()`, `haptics.purchaseSuccess()`, … — one function per event. */
export const haptics = {
  ...Object.fromEntries(
    (Object.keys(HAPTIC_MAP) as HapticEvent[]).map((event) => [event, () => haptic(event)]),
  ) as { [E in HapticEvent]: () => void },
  // Existing screens use these names. They share the switch and action window.
  selection: () => { void play('selection'); },
  light: () => { void play('light'); },
  success: () => { void play('success'); },
  warning: () => { void play('warning'); },
  rigid: () => { void play('rigid'); },
};

// ─── Raw expo-haptics calls (via shims/expo-haptics.ts) ──────────────────────

export function kindForImpactStyle(style?: Haptics.ImpactFeedbackStyle): HapticKind {
  switch (style) {
    case Haptics.ImpactFeedbackStyle.Soft: return 'soft';
    case Haptics.ImpactFeedbackStyle.Medium: return 'medium';
    case Haptics.ImpactFeedbackStyle.Heavy: return 'heavy';
    case Haptics.ImpactFeedbackStyle.Rigid: return 'rigid';
    default: return 'light';
  }
}

export function kindForNotificationType(type?: Haptics.NotificationFeedbackType): HapticKind {
  switch (type) {
    case Haptics.NotificationFeedbackType.Warning: return 'warning';
    case Haptics.NotificationFeedbackType.Error: return 'error';
    default: return 'success';
  }
}

// ─── Legacy helpers (existing call sites) ────────────────────────────────────
// Same names and feel as before; they now share the switch and the
// one-per-action rule with everything else.

export function hapticLight() {
  void play('light');
}

export function hapticMedium() {
  void play('medium');
}

export function hapticSelection() {
  void play('selection');
}

export function hapticSuccess() {
  void play('success');
}

export function hapticError() {
  void play('error');
}

export function hapticWarning() {
  void play('warning');
}

// ─── Semantic tokens (Phase 1 design system) ──────────────────────────────────
// Named by *when* to use them, not by device API, so call sites read as intent
// rather than as a raw Haptics call. See docs/design/brandthread-design-system.md.

/** Primary action taps: buy now, checkout, submit, confirm. */
export const hapticPrimaryAction = hapticLight;
/** Toggles, pills, segmented controls, scrubbing through a list of options. */
export const hapticToggle = hapticSelection;
/** Add-to-bag, follow, order-placed — anything that should feel rewarding. */
export const hapticSuccessAction = hapticSuccess;
/** Destructive-confirm: delete, remove, cancel-order confirmations. */
export const hapticDestructiveConfirm = hapticWarning;
/** Bottom tab bar switch — a meaningful navigation change, not a selection tick. */
export const hapticTabChange = hapticMedium;

// ─── Follow ───────────────────────────────────────────────────────────────────

/**
 * The one haptic for every Follow / Unfollow tap in the app — the feed "+"
 * avatar badge, profile Follow buttons, Follow pills in search, activity,
 * followers/following lists, live, onboarding and so on. Call it on the tap
 * itself, before the network request, so it lands instantly. Follow is a
 * single light impact (HAPTIC_MAP.follow); Unfollow is a softer selection
 * tick. No-op on web.
 *
 * tests/follow-haptics.test.ts fails if a follow control skips this helper.
 */
export function hapticFollow(nextFollowing: boolean) {
  haptic(nextFollowing ? 'follow' : 'unfollow');
}
