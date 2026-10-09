import React, { forwardRef } from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';
import { NativeKeyboardAwareScrollView } from '@/components/KeyboardProviderCompat';

type Props = ScrollViewProps & {
  /** Space kept between the focused input and the top of the keyboard. */
  bottomOffset?: number;
};

/**
 * A ScrollView that keeps the focused input above the keyboard (native, via
 * react-native-keyboard-controller). Falls back to a plain ScrollView on web
 * and wherever the native module is missing.
 */
export const KeyboardAwareScrollViewCompat = forwardRef<ScrollView, Props>(function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  bottomOffset = 16,
  ...props
}, ref) {
  if (NativeKeyboardAwareScrollView) {
    return (
      <NativeKeyboardAwareScrollView
        ref={ref}
        bottomOffset={bottomOffset}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </NativeKeyboardAwareScrollView>
    );
  }
  return (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </ScrollView>
  );
});
