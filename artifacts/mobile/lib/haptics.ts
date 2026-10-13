import * as Haptics from 'expo-haptics';

/**
 * The one haptics map for Brandthread, after Apple HIG "Playing haptics":
 * every haptic answers a touch with a meaning, never decoration.
 *
 *   haptics.selection()  selection changed: chips, in-screen tabs/segments,
 *                        pickers, size select, steppers, switches
 *   haptics.light()      a light impact for a small, satisfying commit:
 *                        like, save, follow, add to bag
 *   haptics.success()    a task finished: order placed, product published,
 *                        payment sent
 *   haptics.warning()    a caution: confirming something destructive
 *   haptics.error()      a task failed (HIG "error" notification)
 *   haptics.rigid()      a long-press menu / preview just opened
 *
 * Plain button taps, navigation pushes, sheet opens and closes play nothing,
 * exactly like system apps. Haptics are best-effort: web, unsupported
 * devices and simulators must never turn a successful interaction into a
 * rejected promise.
 */
// Expo inlines EXPO_OS at build time; no react-native import keeps this
// module safe in every test mock.
const enabled = () => process.env.EXPO_OS !== 'web';

function play(run: () => Promise<void>) {
  if (!enabled()) return;
  try {
    void run().catch(() => {});
  } catch {
    // Native module missing (some preview shells) — stay silent.
  }
}

export const haptics = {
  selection: () => play(() => Haptics.selectionAsync()),
  light: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  rigid: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
} as const;

export type HapticKind = keyof typeof haptics;

// ─── Legacy names ─────────────────────────────────────────────────────────────
// Kept so untouched call sites (and the seller tab bar / Studio menu, which
// keep their own feel on purpose) still compile and behave as before. New
// code uses `haptics.*` above.

export function hapticLight() {
  play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function hapticMedium() {
  play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export const hapticSelection = haptics.selection;
export const hapticSuccess = haptics.success;
export const hapticError = haptics.error;
export const hapticWarning = haptics.warning;

/** @deprecated plain taps play nothing; use the `haptics` map. */
export const hapticPrimaryAction = hapticLight;
/** @deprecated use `haptics.selection`. */
export const hapticToggle = haptics.selection;
/** @deprecated use `haptics.success` (or `haptics.light` for like/save/follow/bag). */
export const hapticSuccessAction = haptics.success;
/** @deprecated use `haptics.warning`. */
export const hapticDestructiveConfirm = haptics.warning;
/** Bottom tab bar switch — owned by the tab bars, left as-is. */
export const hapticTabChange = hapticMedium;
