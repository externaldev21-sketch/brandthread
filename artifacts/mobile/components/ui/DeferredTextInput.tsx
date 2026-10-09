import React, { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useDeferredTextInput } from '@/hooks/useDeferredTextInput';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (next: string) => void;
};

/**
 * Drop-in `<TextInput>` for fields owned by a heavy screen: the keystroke is
 * drawn immediately from the field's own state and the owner's
 * `onChangeText` runs in a React transition (see useDeferredTextInput).
 * Renders exactly the same native TextInput with the same props.
 */
export const DeferredTextInput = forwardRef<TextInput, Props>(function DeferredTextInput(
  { value, onChangeText, ...rest },
  ref,
) {
  const field = useDeferredTextInput(value, onChangeText);
  return <TextInput ref={ref} {...rest} value={field.text} onChangeText={field.onChangeText} />;
});
