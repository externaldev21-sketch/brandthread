import React, { useEffect } from 'react';
import { useSharedValue, withTiming, Easing, type SharedValue } from 'react-native-reanimated';
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Keyboard,
  NativeModules,
  Platform,
  TurboModuleRegistry,
  View,
  type KeyboardAvoidingViewProps,
  type ViewProps,
} from 'react-native';

type KeyboardControllerModule = {
  KeyboardProvider?: React.ComponentType<any>;
  KeyboardAvoidingView?: React.ComponentType<any>;
  KeyboardGestureArea?: React.ComponentType<any>;
  KeyboardAwareScrollView?: React.ComponentType<any>;
  useReanimatedKeyboardAnimation?: () => { progress: { value: number }; height: SharedValue<number> };
};

let controller: KeyboardControllerModule | null | undefined;
function getController(): KeyboardControllerModule | null {
  if (controller !== undefined) return controller;
  let nativeModuleAvailable = false;
  try {
    nativeModuleAvailable = Platform.OS === 'web'
      || !!NativeModules.KeyboardController
      || !!TurboModuleRegistry.get('KeyboardController');
  } catch {
    // A partial react-native (test mocks, unusual hosts) — treat as absent.
  }
  if (!nativeModuleAvailable) return (controller = null);
  try {
    // Matching Expo Go SDKs bundle this package; resolve it only when the
    // installed client's native registration is present.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    controller = require('react-native-keyboard-controller') as KeyboardControllerModule;
  } catch {
    controller = null;
  }
  return controller;
}

const keyboardController = getController();

export function KeyboardProvider({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
  const Provider = keyboardController?.KeyboardProvider;
  return Provider ? <Provider {...props}>{children}</Provider> : <>{children}</>;
}

export const KeyboardAvoidingView: React.ComponentType<KeyboardAvoidingViewProps> =
  keyboardController?.KeyboardAvoidingView ?? RNKeyboardAvoidingView;

/**
 * keyboard-controller's scroll view that scrolls the focused input above the
 * keyboard, or null when the native module isn't registered (Expo Go without
 * it) or on web, where the browser already does this.
 */
export const NativeKeyboardAwareScrollView: React.ComponentType<any> | null =
  Platform.OS === 'web' ? null : keyboardController?.KeyboardAwareScrollView ?? null;

export function KeyboardGestureArea({
  children,
  textInputNativeID,
  ...props
}: React.PropsWithChildren<ViewProps & { textInputNativeID?: string }>) {
  const GestureArea = keyboardController?.KeyboardGestureArea;
  return GestureArea
    ? <GestureArea {...props} textInputNativeID={textInputNativeID}>{children}</GestureArea>
    : <View {...props}>{children}</View>;
}

export function useReanimatedKeyboardAnimation(): { progress: { value: number } } {
  const nativeHook = keyboardController?.useReanimatedKeyboardAnimation;
  if (nativeHook) return nativeHook();
  return { progress: { value: 0 } };
}
/**
 * The keyboard's offset as a Reanimated shared value that tracks the keyboard
 * frame by frame on the UI thread: 0 when hidden, `-keyboardHeight` while
 * shown (keyboard-controller's own sign convention, so it can be fed straight
 * into a translateY; take `-value` for a height).
 * Bottom sheets use it to sit their pinned action on top of the keyboard.
 *
 * With react-native-keyboard-controller registered, this mirrors its
 * per-frame `height`. Without it
 * (Expo Go, web), it falls back to RN's `Keyboard` events and animates over
 * the keyboard's own reported duration, so the sheet still rises smoothly
 * instead of jumping.
 */
export const useKeyboardHeight: () => SharedValue<number> = keyboardController?.useReanimatedKeyboardAnimation
  ? function useControllerKeyboardHeight() {
    const { height } = keyboardController!.useReanimatedKeyboardAnimation!();
    return height;
  }
  : function useFallbackKeyboardHeight() {
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
  };
