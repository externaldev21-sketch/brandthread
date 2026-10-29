/**
 * The camera reports the same QR code on many consecutive frames. Every
 * event that lands before React re-renders the callback must be ignored once
 * the first valid scan has been handled — otherwise the profile is pushed
 * (and onClose called) several times.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('expo-camera', () => {
  const React = require('react') as typeof import('react');
  const permission = { granted: true, canAskAgain: true, status: 'granted' };
  return {
    CameraView: (props: Record<string, unknown>) => React.createElement('CameraView', props),
    useCameraPermissions: () => [permission, async () => permission],
  };
});
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/haptics', () => ({ haptics: {} }));

import { ShareProfileQrScanner } from '../ShareProfileQrScanner';

describe('ShareProfileQrScanner', () => {
  it('handles a burst of scans of the same code exactly once', async () => {
    const onClose = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<ShareProfileQrScanner onClose={onClose} />); });
    const camera = renderer.root.find((node) => (node.type as unknown) === 'CameraView');
    const onScan = camera.props.onBarcodeScanned as (r: { data: string }) => void;
    // Same callback instance, as when native events arrive before a re-render.
    act(() => {
      onScan({ data: 'https://brandthread.app/u/maya' });
      onScan({ data: 'https://brandthread.app/u/maya' });
      onScan({ data: 'https://brandthread.app/u/maya' });
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/u/maya');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning past codes that are not Brandthread profiles', async () => {
    push.mockClear();
    const onClose = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<ShareProfileQrScanner onClose={onClose} />); });
    const camera = renderer.root.find((node) => (node.type as unknown) === 'CameraView');
    act(() => { camera.props.onBarcodeScanned({ data: 'https://example.com/u/x' }); });
    expect(push).not.toHaveBeenCalled();
    act(() => { camera.props.onBarcodeScanned({ data: 'brandthread://u/sam' }); });
    expect(push).toHaveBeenCalledWith('/u/sam');
  });
});
