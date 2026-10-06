import { useContext, useEffect, type DependencyList } from 'react';
import { NavigationContext } from '@react-navigation/native';
import type { Animated } from 'react-native';

/**
 * Stop loops imperatively on blur, even when React freezes the retained scene.
 * Outside a navigator (e.g. boot UI), run until unmount as usual.
 */
export function useFocusedAnimationLoop(
  createLoop: () => Animated.CompositeAnimation,
  dependencies: DependencyList,
) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    const stop = () => { loop?.stop(); loop = undefined; };
    const start = () => {
      if (loop) return;
      loop = createLoop();
      loop.start();
    };
    const removeFocus = navigation?.addListener('focus', start);
    const removeBlur = navigation?.addListener('blur', stop);
    if (!navigation || navigation.isFocused()) start();
    return () => { removeFocus?.(); removeBlur?.(); stop(); };
    // The animation factory captures only the declared animated values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, ...dependencies]);
}
