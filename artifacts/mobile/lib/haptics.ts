import * as Haptics from 'expo-haptics';

/**
 * Haptics are intentionally best-effort: unsupported devices and web previews
 * should never turn a successful interaction into a rejected promise.
 */
export function hapticLight() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticMedium() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSelection() {
  void Haptics.selectionAsync().catch(() => {});
}

export function hapticSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticError() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function hapticWarning() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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