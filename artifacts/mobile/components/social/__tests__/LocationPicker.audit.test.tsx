import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const h = vi.hoisted(() => {
  const search = vi.fn();
  const save = vi.fn();
  // One stable client, like the real useApi(): the picker's search effect depends on it.
  return { search, save, api: { places: { search, save } } };
});

vi.mock('@/lib/api', () => ({ useApi: () => h.api }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', surface: '#111' } }),
}));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isPreviewDemoMode: () => false }));
vi.mock('@/lib/haptics', () => ({ haptic: () => {}, haptics: {} }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { LocationPicker } from '../LocationPicker';

beforeEach(() => {
  vi.useFakeTimers();
  h.search.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('LocationPicker (audit)', () => {
  it('does not show a late answer for a search the user already cleared', async () => {
    let resolve!: (v: unknown) => void;
    h.search.mockImplementation(() => new Promise((r) => { resolve = r; }));
    let root!: TestRenderer.ReactTestRenderer;
    await act(async () => { root = TestRenderer.create(<LocationPicker onSelect={() => {}} />); });
    const input = () => root.root.findByProps({ testID: 'location-picker-input' });
    await act(async () => { input().props.onChangeText('Paris'); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(h.search).toHaveBeenCalledTimes(1);
    // The user clears the field while that request is still in flight.
    await act(async () => { input().props.onChangeText(''); });
    await act(async () => {
      resolve({ places: [{ id: 'p1', name: 'Paris', source: 'local', postCount: 3 }], providerEnabled: true });
    });
    expect(root.root.findAll((n) => n.props.testID === 'location-result-0').length).toBe(0);
  });
});
