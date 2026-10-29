/** A double tap on "Resend code" while the first resend is in flight must not send a second code. */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));
vi.mock('@/components/auth/OtpCodeInput', () => ({ OtpCodeInput: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', subtle: '#555' } }) }));
vi.mock('@/lib/ageGate', () => ({ formatDobInput: (s: string) => s }));
vi.mock('./kit', () => {
  const React = require('react') as typeof import('react');
  const pass = (name: string) => (p: Record<string, unknown>) => React.createElement(name, p, p.children as React.ReactNode);
  return {
    Field: pass('Field'), FieldError: () => null, FieldHint: () => null, OnbHeader: () => null,
    OnbScreen: pass('OnbScreen'), PillButton: () => null, ScalePressable: pass('ScalePressable'),
    Sub: pass('Sub'), TextLink: (p: Record<string, unknown>) => React.createElement('TextLink', p), Title: pass('Title'),
  };
});

import { CodeScreen } from './AuthScreens';

describe('CodeScreen resend in-flight guard', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sends one code for two quick taps', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const onResend = vi.fn(() => new Promise<void>((res) => { release = res; }));
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <CodeScreen email="a@b.co" code="" onChange={() => {}} onComplete={() => {}} onBack={() => {}} onEditEmail={() => {}} onResend={onResend} />,
      );
    });
    for (let i = 0; i < 60; i++) act(() => { vi.advanceTimersByTime(1000); });
    const link = () => r.root.find((n) => n.props.testID === 'onboarding-code-resend' && (n.type as unknown) === 'TextLink');
    await act(async () => { link().props.onPress(); });
    await act(async () => { link().props.onPress(); });
    expect(onResend).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    r.unmount();
  });
});
