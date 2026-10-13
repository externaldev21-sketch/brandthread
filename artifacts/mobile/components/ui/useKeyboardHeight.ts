/**
 * The keyboard's offset for the shared sheet system, as a Reanimated shared
 * value tracked on the UI thread: 0 when hidden, `-keyboardHeight` while
 * shown (react-native-keyboard-controller's sign convention; take `-value`
 * for a height). Sheets use it to sit their pinned action on the keyboard.
 *
 * With react-native-keyboard-controller registered (and its provider mounted
 * at the root, see KeyboardProviderCompat), this mirrors its per-frame
 * `height`. Without it (Expo Go, web, tests) it falls back to RN's
 * `Keyboard` events and animates over the keyboard's own duration, so the
 * sheet still rises smoothly instead of jumping.
 *
 * Its own module on purpose: the sheet must not load KeyboardProviderCompat,
 * which reads react-native exports at module load, so every screen that opens
 * a sheet stays importable under partial react-native test mocks.
 */
import { useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

type ControllerHook = () => { height: SharedValue<number> };

let controllerHook: ControllerHook | null | undefined;
function getControllerHook(): ControllerHook | null {
  if (controllerHook !== undefined) return controllerHook;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules, TurboModuleRegistry } = require('react-native');
    const available = Platform.OS === 'web'
      || !!NativeModules?.KeyboardController
      || !!TurboModuleRegistry?.get?.('KeyboardController');
    if (!available) return (controllerHook = null);
    // Resolved only when the native registration is present (Expo Go safe).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-keyboard-controller');
    controllerHook = typeof mod?.useReanimatedKeyboardAnimation === 'function' ? mod.useReanimatedKeyboardAnimation : null;
  } catch {
    controllerHook = null;
  }
  return controllerHook ?? null;
}

function useFallbackKeyboardHeight(): SharedValue<number> {
  const height = useSharedValue(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, e => {
      height.set(withTiming(-e.endCoordinates.height, { duration: e.duration || 250, easing: Easing.out(Easing.cubic) }));
    });
    const hide = Keyboard.addListener(hideEvt, e => {
      height.set(withTiming(0, { duration: e?.duration || 250, easing: Easing.out(Easing.cubic) }));
    });
    return () => { show.remove(); hide.remove(); };
  }, [height]);
  return height;
}

const hook = getControllerHook();

export const useKeyboardHeight: () => SharedValue<number> = hook
  ? function useControllerKeyboardHeight() { return hook().height; }
  : useFallbackKeyboardHeight;
