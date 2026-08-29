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