import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { bannerHapticFor, getSaleAlertPrefs, hydrateSaleAlertPrefs, normalizeSaleAlertPrefs, rememberSaleAlertPrefs } from './saleAlerts';

describe('sale alerts', () => {
  it('resets sale preferences when the active account changes or signs out', async () => {
    await hydrateSaleAlertPrefs('scope-test-first');
    rememberSaleAlertPrefs({ saleHaptic: false, saleSound: false });
    await hydrateSaleAlertPrefs('scope-test-second');
    expect(getSaleAlertPrefs()).toEqual({ saleHaptic: true, saleSound: true });
    await hydrateSaleAlertPrefs(null);
    expect(getSaleAlertPrefs()).toEqual({ saleHaptic: true, saleSound: true });
  });

  it('ignores a late storage read from the previous account', async () => {
    let finish!: (value: string | null) => void;
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = hydrateSaleAlertPrefs('scope-test-late');
    await hydrateSaleAlertPrefs('scope-test-current');
    finish(JSON.stringify({ saleHaptic: false, saleSound: false }));
    await old;
    expect(getSaleAlertPrefs()).toEqual({ saleHaptic: true, saleSound: true });
    await hydrateSaleAlertPrefs(null);
  });
  it('defaults both on', () => {
    expect(normalizeSaleAlertPrefs(null)).toEqual({ saleSound: true, saleHaptic: true });
    expect(normalizeSaleAlertPrefs({ saleSound: false })).toEqual({ saleSound: false, saleHaptic: true });
  });

  it('gives new orders the success haptic, or none when switched off', () => {
    const on = { saleSound: true, saleHaptic: true };
    const off = { saleSound: true, saleHaptic: false };
    expect(bannerHapticFor({ type: 'new_order_received' }, on)).toBe('success');
    expect(bannerHapticFor({ type: 'new_order_received' }, off)).toBe('none');
  });

  it('leaves every other banner on the light tap', () => {
    const off = { saleSound: false, saleHaptic: false };
    expect(bannerHapticFor({ type: 'message' }, off)).toBe('light');
    expect(bannerHapticFor(undefined, off)).toBe('light');
  });

  it('remembers the latest server values', () => {
    rememberSaleAlertPrefs({ saleHaptic: false });
    expect(getSaleAlertPrefs()).toEqual({ saleSound: true, saleHaptic: false });
    rememberSaleAlertPrefs({ saleHaptic: true });
    expect(getSaleAlertPrefs().saleHaptic).toBe(true);
  });
});
