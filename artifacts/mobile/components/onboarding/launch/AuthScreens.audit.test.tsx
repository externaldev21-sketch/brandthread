import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    Sub: pass('Sub'), TextLink: () => null, Title: pass('Title'),
  };
});

import { CodeScreen } from './AuthScreens';

describe('CodeScreen resend countdown', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('says "1 second", not "1 seconds"', () => {
    vi.useFakeTimers();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <CodeScreen email="a@b.co" code="" onChange={() => {}} onComplete={() => {}} onBack={() => {}} onEditEmail={() => {}} onResend={async () => {}} />,
      );
    });
    for (let i = 0; i < 59; i++) act(() => { vi.advanceTimersByTime(1000); });
    const lines = r.root.findAll((n) => (n.type as unknown) === 'Text')
      .map((n) => ([] as unknown[]).concat(n.props.children).join(''));
    expect(lines).toContain('You can resend again in 1 second');
  });
});
