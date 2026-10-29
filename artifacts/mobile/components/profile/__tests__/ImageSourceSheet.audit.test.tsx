/**
 * Audit (chunk 09): when the camera / library fails to open, the
 * `open()` promise must still answer (null) instead of hanging forever.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  buttons: [] as Array<{ text: string; onPress?: () => void }>,
}));

vi.mock('@/components/ui/ActionSheet', () => ({
  showActionSheet: (_t: unknown, _m: unknown, buttons: Array<{ text: string; onPress?: () => void }>) => { h.buttons = buttons; },
}));
vi.mock('@/lib/pickProfileImage', () => ({
  pickFromCamera: async () => { throw new Error('Camera not available on simulator'); },
  pickFromLibrary: async () => null,
  pickVideoFromLibrary: async () => null,
  recordAvatarVideo: async () => null,
}));
vi.mock('@/lib/haptics', () => ({ haptics: {}, hapticSelection: () => {} }));
vi.mock('../AvatarCropper', () => ({ AvatarCropper: () => null }));
vi.mock('@/components/ui/BottomSheet', () => ({ BottomSheet: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));

import { useImageSourceSheet } from '../ImageSourceSheet';

describe('useImageSourceSheet', () => {
  it('resolves null when taking a photo throws', async () => {
    let sheet!: ReturnType<typeof useImageSourceSheet>;
    function Probe() { sheet = useImageSourceSheet(); return sheet.sheet; }
    await act(async () => { create(<Probe />); });
    let result: unknown = 'pending';
    const promise = sheet.open().then((value) => { result = value; });
    await act(async () => { h.buttons.find((b) => b.text === 'Take photo')!.onPress!(); });
    await act(async () => { await Promise.race([promise, new Promise((r) => setTimeout(r, 50))]); });
    expect(result).toBeNull();
  });
});
