import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { Freeze } from 'react-freeze';

type SceneNavigation = {
  isFocused(): boolean;
  addListener(event: 'focus' | 'blur', listener: () => void): () => void;
  getParent?(): { isFocused(): boolean } | undefined;
};

/** How long a never-focused (pre-mounted) scene stays live before freezing. */
const PRELOADED_SETTLE_MS = 6000;

/** Native screens already coordinate freezing with their transitions. RN web
 * keeps hidden scenes mounted but ignores native freezeOnBlur. Suspend only
 * genuinely hidden DOM trees, never a visible transparent-modal backdrop.
 * screenLayout is OUTSIDE screen route context: use its navigation argument,
 * not useIsFocused() (which would observe the parent navigator). */
export function RetainedScene({ navigation, children, opaque = false }: { navigation: SceneNavigation; children: React.ReactNode; opaque?: boolean }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <FrozenWebScene navigation={navigation} opaque={opaque}>{children}</FrozenWebScene>;
}

function FrozenWebScene({ navigation, children, opaque }: { navigation: SceneNavigation; children: React.ReactNode; opaque: boolean }) {
  const subscribe = useCallback((notify: () => void) => {
    const focus = navigation.addListener('focus', notify);
    const blur = navigation.addListener('blur', notify);
    return () => { focus(); blur(); };
  }, [navigation]);
  const snapshot = useCallback(() => navigation.isFocused(), [navigation]);
  const focused = useSyncExternalStore(subscribe, snapshot, () => true);
  const [frozen, setFrozen] = useState(false);
  const host = useRef<View>(null);
  const everFocused = useRef(focused);
  useEffect(() => {
    if (focused) { everFocused.current = true; setFrozen(false); return; }
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      // Run AFTER the blur commit/effects: videos and infinite animations must
      // get their unfocused render/cleanup before the subtree is suspended.
      // Do NOT suspend opaque tabs merely because they lost focus. Suspense
      // hides every DOM host individually; revealing a retained feed then
      // triggers hundreds of RN-web measurements. Only suspend a tree already
      // hidden by its navigator. Native freezeOnBlur remains unchanged.
      let element = host.current as unknown as HTMLElement | null;
      while (element) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
          setFrozen(true);
          return;
        }
        element = element.parentElement;
      }
    };
    // A scene pre-mounted hidden (components/navigation/TabScenePreloader)
    // first gets to finish its initial load and reveal — frozen right away,
    // that data and any skeleton fade-out would only commit on the first
    // visit, in front of the user.
    if (everFocused.current) raf = requestAnimationFrame(check);
    else timer = setTimeout(() => { raf = requestAnimationFrame(check); }, PRELOADED_SETTLE_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [focused, opaque]);
  return <View ref={host} style={{ flex: 1 }}>
    <Freeze freeze={!focused && frozen}>{children}</Freeze>
  </View>;
}
