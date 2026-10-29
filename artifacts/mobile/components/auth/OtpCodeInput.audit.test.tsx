/**
 * Audit regression: the hidden TextInput carried maxLength={length}. Native
 * TextInput applies maxLength to a paste before onChangeText runs, so pasting
 * a formatted code from an email ("123 456" / "123-456") arrived as "123 45"
 * and never completed. The test applies the platform's maxLength truncation
 * the way iOS/Android do, then pastes.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OtpCodeInput } = await import('./OtpCodeInput');

function paste(renderer: ReactTestRenderer, text: string) {
  const input = renderer.root.find((n) => n.type === 'TextInput');
  const max = input.props.maxLength as number | undefined;
  act(() => { input.props.onChangeText(max === undefined ? text : text.slice(0, max)); });
}

describe('OtpCodeInput — pasting a formatted code', () => {
  it.each(['123 456', '123-456', ' 123456 '])('completes with all six digits from %j', (text) => {
    const onComplete = vi.fn();
    const onChangeText = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<OtpCodeInput value="" onChangeText={onChangeText} onComplete={onComplete} />); });
    paste(renderer, text);
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    renderer.unmount();
  });

  it('still never passes more than `length` digits up', () => {
    const onChangeText = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<OtpCodeInput value="" onChangeText={onChangeText} />); });
    paste(renderer, '12345678');
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    renderer.unmount();
  });
});
