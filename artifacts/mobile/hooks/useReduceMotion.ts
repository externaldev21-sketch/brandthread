/**
 * Whether the OS-level "Reduce Motion" accessibility setting is on. No
 * existing precedent for this in the app (checked before adding it), so this
 * is a small, self-contained hook: subscribes to AccessibilityInfo's change
 * event and reads the initial value on mount. Defaults to false (normal
 * animation) until the initial check resolves, and fails safe to false on
 * any platform that doesn't support the query (e.g. web).
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => { if (active) setReduceMotion(!!enabled); })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(!!enabled),
    );
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}
