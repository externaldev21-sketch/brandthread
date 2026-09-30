/**
 * Measures a real control's on-screen rect for the `spotlight` / `anchored`
 * <FirstRunTip> variants. Attach the returned `ref` + `onLayout` to the
 * control being highlighted; `rect` becomes non-null once it's been laid out
 * and measured in window coordinates (absolute screen position, not
 * relative to a parent — what the spotlight "hole" and anchored-card arrow
 * need).
 */
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import type { TargetRect } from '@/components/first-run-tips/types';

export function useMeasuredTarget() {
  const ref = useRef<View>(null);
  const [rect, setRect] = useState<TargetRect | null>(null);

  const onLayout = useCallback(() => {
    // A microtask delay lets the native layout commit settle before
    // measuring — measuring synchronously inside onLayout can occasionally
    // read stale (pre-layout) window coordinates on Android.
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) setRect({ x, y, width, height });
      });
    });
  }, []);

  return { ref, rect, onLayout };
}
