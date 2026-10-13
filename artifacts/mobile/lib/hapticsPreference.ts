import { loadBuyerSettings } from '@/lib/buyerSettings';

/**
 * In-memory mirror of Settings → Accessibility → "Disable haptic feedback"
 * (BuyerSettingsState.disableHaptics). Read synchronously by the gated
 * expo-haptics module (shims/expo-haptics.ts) on every haptic call, so the
 * toggle covers every haptic in the app without touching each call site.
 */
let disabled = false;

export function isHapticsDisabled(): boolean {
  return disabled;
}

export function setHapticsDisabled(value: boolean): void {
  disabled = value;
}

let hydration: Promise<void> | null = null;

/** Loads the saved preference once per launch. Safe to call repeatedly. */
export function hydrateHapticsPreference(): Promise<void> {
  if (!hydration) {
    hydration = loadBuyerSettings()
      .then((s) => { disabled = Boolean(s.disableHaptics); })
      .catch(() => {});
  }
  return hydration;
}
