import React from 'react';
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
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
  useReanimatedKeyboardAnimation?: () => { progress: { value: number } };
};

let controller: KeyboardControllerModule | null | undefined;
function getController(): KeyboardControllerModule | null {
  if (controller !== undefined) return controller;
  const nativeModuleAvailable = Platform.OS === 'web'
    || NativeModules.KeyboardController
    || TurboModuleRegistry.get('KeyboardController');
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