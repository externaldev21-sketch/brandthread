import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const threadCashGet = vi.fn();
const liveGift = vi.fn();
const api = { threadCash: { get: (...a: unknown[]) => threadCashGet(...a), liveGift: (...a: unknown[]) => liveGift(...a) } };

vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', accent: '#fff', onAccent: '#000', cardElevated: '#111' } }),
}));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, RADIUS: {}, SP: { md: 16, xs: 8, sm: 12 } }));
vi.mock('@/lib/format', () => ({ formatMoney: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn(), haptics: { success: vi.fn() }, hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock('@/lib/previewThreadCash', () => ({
  isPreviewThreadCashEnabled: () => false,
  getPreviewThreadCashStatus: () => ({ balanceCents: 0 }),
  PREVIEW_THREAD_CASH_STATUS: {},
}));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
vi.mock('@/lib/safety', () => ({ apiErrorMessage: (_e: unknown, f: string) => f }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/thread-cash/ThreadCashBill', () => ({ THREAD_CASH_GREEN_MID: '#0f0', ThreadCashBillIcon: () => null }));
vi.mock('@/constants/radii', () => ({ radius: {} }));
vi.mock('@/components/ui/BottomSheet', () => ({
  Sheet: ({ children, primaryAction }: { children: React.ReactNode; primaryAction: Record<string, unknown> }) =>
    React.createElement('Sheet', null, children, React.createElement('Primary', primaryAction)),
}));

import { LiveThreadCashSheet } from './LiveThreadCashSheet';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function selectAndSend(r: ReactTestRenderer, label: string) {
  const tip = r.root.findAll((n) => n.props.accessibilityLabel === `Select ${label}`)[0];
  act(() => { (tip.props.onPress as () => void)(); });
  return act(async () => { (r.root.findByType('Primary' as never).props.onPress as () => void)(); await Promise.resolve(); });
}

describe('LiveThreadCashSheet', () => {
  beforeEach(() => {
    threadCashGet.mockReset().mockResolvedValue({ balanceCents: 10_000 });
    liveGift.mockReset().mockResolvedValue({});
  });

  it('does not report a gift as sent when there is no real host or live to send to', async () => {
    const onSent = vi.fn();
    const onSendFailed = vi.fn();
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveThreadCashSheet visible brandName="Host" recipientId={null} streamId={null} onClose={() => {}} onSent={onSent} onSendFailed={onSendFailed} />); });
    await flush();
    await selectAndSend(r, '$1.00');
    expect(onSent).not.toHaveBeenCalled();
    expect(onSendFailed).toHaveBeenCalled();
    expect(liveGift).not.toHaveBeenCalled();
  });

  it('keeps a previewOnly sample room local-only', async () => {
    const onSent = vi.fn();
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveThreadCashSheet visible previewOnly brandName="Host" onClose={() => {}} onSent={onSent} />); });
    await flush();
    await selectAndSend(r, '$1.00');
    expect(onSent).toHaveBeenCalledWith(100);
    expect(liveGift).not.toHaveBeenCalled();
  });

  it('shows the send failure inside the sheet', async () => {
    liveGift.mockRejectedValue(new Error('nope'));
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveThreadCashSheet visible brandName="Host" recipientId="u1" streamId="s1" onClose={() => {}} onSent={() => {}} />); });
    await flush();
    await selectAndSend(r, '$1.00');
    await flush();
    expect(r.root.findAll((n) => n.props.testID === 'live-thread-cash-error').length).toBeGreaterThan(0);
  });

  it('says the balance failed to load instead of loading forever', async () => {
    threadCashGet.mockRejectedValue(new Error('offline'));
    let r!: ReactTestRenderer;
    act(() => { r = create(<LiveThreadCashSheet visible brandName="Host" recipientId="u1" streamId="s1" onClose={() => {}} onSent={() => {}} />); });
    await flush();
    expect(JSON.stringify(r.toJSON())).toContain('Couldn’t load your balance');
  });
});
