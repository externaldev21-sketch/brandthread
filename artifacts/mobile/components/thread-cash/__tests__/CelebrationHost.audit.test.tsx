import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { card: '#111', border: '#333', text: '#fff', muted: '#888' } }),
}));
vi.mock('../ThreadCashBill', () => ({ ThreadCashBillIcon: () => null }));

import { CelebrationHost, useCelebrateThreadCash } from '../CelebrationHost';

let celebrate!: ReturnType<typeof useCelebrateThreadCash>;
function Grab() {
  celebrate = useCelebrateThreadCash();
  return null;
}

function toastLabels(root: TestRenderer.ReactTestRenderer): string[] {
  return root.root
    .findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Received '))
    .map((n) => n.props.accessibilityLabel as string)
    .filter((label, i, all) => all.indexOf(label) === i);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('CelebrationHost (audit)', () => {
  it('gives a second payment its own full hold instead of vanishing on the first toast\'s timer', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    await act(async () => { root = TestRenderer.create(<CelebrationHost><Grab /></CelebrationHost>); });
    await act(async () => { celebrate({ amount: 500, from: 'Ana' }); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { celebrate({ amount: 700, from: 'Ben' }); });
    // 500ms later the FIRST toast's 1400ms hold is over; the second has only
    // been up for 500ms and must still be showing.
    await act(async () => { vi.advanceTimersByTime(500); });
    const labels = toastLabels(root);
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain('Ben');
    // And it does go away after its own hold.
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(toastLabels(root).length).toBe(0);
  });
});
