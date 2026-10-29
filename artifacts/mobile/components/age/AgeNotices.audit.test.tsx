/**
 * Audit regression: POST /api/auth/age answers 409 AGE_BAND_LOCKED when the
 * account's band was already set (another device, or a lost race), and the
 * body carries the stored `ageBand`. The inline ask used to resolve every
 * such 409 as '18_plus' — so a 13-17 account that typed an adult birthday
 * here was treated as an adult and shown seller / go-live / payout actions.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ useApi: () => ({ ageGate: { submit } }) }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: () => null }));
vi.mock('@/components/ui/NativeDateTimeField', () => {
  const R = require('react') as typeof import('react');
  return { NativeDateTimeField: ({ fallback }: { fallback: React.ReactNode }) => R.createElement(R.Fragment, null, fallback) };
});
vi.mock('@/components/BrandthreadUI', () => {
  const R = require('react') as typeof import('react');
  return { PrimaryButton: (props: Record<string, unknown>) => R.createElement('PrimaryButton', props) };
});

const { AgeAskInline, lockedAgeBand } = await import('./AgeNotices');

async function submitAdultBirthday(onResolved: (band: string) => void): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<AgeAskInline onResolved={onResolved} />); });
  act(() => {
    renderer.root.find((n) => (n.type as unknown) === 'TextInput').props.onChangeText('01/01/1990');
  });
  await act(async () => {
    await renderer.root.find((n) => (n.type as unknown) === 'PrimaryButton').props.onPress();
  });
  return renderer;
}

describe('AgeAskInline — already-set age band', () => {
  it('resolves with the band the server has on file, not a hardcoded adult band', async () => {
    submit.mockRejectedValueOnce(new ApiError(409, JSON.stringify({
      error: 'Your age has already been set. Contact support to change it.', code: 'AGE_BAND_LOCKED', ageBand: '13_17',
    })));
    const onResolved = vi.fn();
    const renderer = await submitAdultBirthday(onResolved);
    expect(onResolved).toHaveBeenCalledWith('13_17');
    expect(onResolved).not.toHaveBeenCalledWith('18_plus');
    renderer.unmount();
  });

  it('still resolves an adult whose band is already 18_plus', async () => {
    submit.mockRejectedValueOnce(new ApiError(409, JSON.stringify({ code: 'AGE_BAND_LOCKED', ageBand: '18_plus' })));
    const onResolved = vi.fn();
    const renderer = await submitAdultBirthday(onResolved);
    expect(onResolved).toHaveBeenCalledWith('18_plus');
    renderer.unmount();
  });

  it('lockedAgeBand reads only a known band from the error body', () => {
    expect(lockedAgeBand(new ApiError(409, JSON.stringify({ code: 'AGE_BAND_LOCKED', ageBand: null })))).toBeNull();
    expect(lockedAgeBand(new ApiError(409, 'not json'))).toBeNull();
    expect(lockedAgeBand(new Error('x'))).toBeNull();
  });
});
