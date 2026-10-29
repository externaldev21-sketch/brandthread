/**
 * One-time "what is this screen" explainers: shown once per screen per
 * account, dismissed by Got it, the X or a tap outside, never back after a
 * reload — and every registered explainer is mounted on a real screen with
 * 2–3 one-idea cards that swipe / tap / Next through with the dots, and
 * only the major screens carry one.
 */
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  server: new Set<string>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
  },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user_1', isLoaded: true }) }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: (props: Record<string, unknown>) =>
    React.createElement('PressableScale', props, props.children as React.ReactNode),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
const api = {
  firstRunTips: {
    get: vi.fn(async () => ({ seenTipIds: [...h.server], skipAll: false })),
    markSeen: vi.fn(async (id: string) => { h.server.add(id); }),
    skipAll: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
  },
};
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));

import { FirstRunTipsProvider, useFirstRunTipsController } from '@/contexts/FirstRunTipsContext';
import { ScreenExplainer } from '@/components/first-run-tips/ScreenExplainer';
import { SCREEN_EXPLAINERS } from '@/lib/firstRunTips/content';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
}

const DEFAULT_ID = 'seller-analytics';

async function open(id: keyof typeof SCREEN_EXPLAINERS = DEFAULT_ID): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<FirstRunTipsProvider><ScreenExplainer id={id} /></FirstRunTipsProvider>); });
  await flush();
  return r;
}

const sheet = (r: ReactTestRenderer, id: string = DEFAULT_ID) =>
  r.root.findAll((n) => n.props.testID === `first-run-tip-explainer-${id}` && typeof n.type === 'string');
const byTestID = (r: ReactTestRenderer, testID: string) =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
const count = (r: ReactTestRenderer) => {
  const node = r.root.findAll((n) => n.props.testID === 'first-run-tip-explainer-count' && typeof n.type === 'string')[0];
  return [node.props.children].flat().join('');
};
const press = async (r: ReactTestRenderer, testID: string) => { await act(async () => byTestID(r, testID).props.onPress()); };

describe('ScreenExplainer carousel', () => {
  beforeEach(() => {
    h.store.clear();
    h.server.clear();
    vi.clearAllMocks();
  });

  it('shows the screen title and one card per idea, starting at 1 / 3', async () => {
    const r = await open();
    expect(sheet(r)).toHaveLength(1);
    const text = r.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children);
    expect(text).toContain('Analytics');
    for (const step of SCREEN_EXPLAINERS[DEFAULT_ID].steps) {
      expect(text).toContain(step.title);
      expect(text).toContain(step.body);
    }
    expect(count(r)).toBe('1 / 3');
    expect(byTestID(r, 'first-run-tip-explainer-next')).toBeTruthy();
    expect(byTestID(r, 'first-run-tip-explainer-ok')).toBeUndefined();
    expect(api.firstRunTips.markSeen).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it('Next and a tap on the card advance; Got it on the last card closes it', async () => {
    const r = await open();
    await press(r, 'first-run-tip-explainer-next');
    expect(count(r)).toBe('2 / 3');
    await press(r, 'first-run-tip-explainer-step-1'); // tap the card itself
    expect(count(r)).toBe('3 / 3');
    expect(byTestID(r, 'first-run-tip-explainer-next')).toBeUndefined();
    await press(r, 'first-run-tip-explainer-ok');
    expect(sheet(r)).toHaveLength(0);
  });

  it('a swipe moves the dots and the count', async () => {
    const r = await open();
    const pagerWrap = r.root.findAll((n) => typeof n.props.onLayout === 'function'
      && n.findAll((c) => c.props.testID === 'first-run-tip-explainer-pager').length > 0)[0];
    await act(async () => pagerWrap.props.onLayout({ nativeEvent: { layout: { width: 300, height: 100, x: 0, y: 0 } } }));
    const pager = r.root.findAll((n) => n.props.testID === 'first-run-tip-explainer-pager' && typeof n.props.onScroll === 'function')[0];
    await act(async () => pager.props.onScroll({ nativeEvent: { contentOffset: { x: 600, y: 0 } } }));
    expect(count(r)).toBe('3 / 3');
    await act(async () => pager.props.onScroll({ nativeEvent: { contentOffset: { x: 300, y: 0 } } }));
    expect(count(r)).toBe('2 / 3');
  });

  it('the X bails from the first card', async () => {
    const r = await open();
    await press(r, 'first-run-tip-explainer-close');
    expect(sheet(r)).toHaveLength(0);
  });

  it('a tap outside bails from a middle card', async () => {
    const r = await open();
    await press(r, 'first-run-tip-explainer-next');
    const scrim = r.root.findAll((n) => n.props.accessibilityLabel === 'Dismiss' && typeof n.props.onPress === 'function')[0];
    await act(async () => scrim.props.onPress());
    expect(sheet(r)).toHaveLength(0);
  });

  it('never shows again on that screen, even after the local cache is wiped (reinstall)', async () => {
    const first = await open();
    await act(async () => { first.unmount(); });
    const again = await open();
    expect(sheet(again)).toHaveLength(0);
    await act(async () => { again.unmount(); });
    h.store.clear(); // reinstall: only the server remembers
    const reinstalled = await open();
    expect(sheet(reinstalled)).toHaveLength(0);
  });

  it('is per screen: seeing one explainer does not hide another', async () => {
    const first = await open(DEFAULT_ID);
    await act(async () => { first.unmount(); });
    const other = await open('explain-payouts');
    expect(sheet(other, 'explain-payouts')).toHaveLength(1);
  });
});

describe('ScreenExplainer and other tips', () => {
  beforeEach(() => { h.store.clear(); h.server.clear(); });

  it('waits while another tip holds the slot, then shows once it frees', async () => {
    let controller!: ReturnType<typeof useFirstRunTipsController>;
    function OtherTip() { controller = useFirstRunTipsController(); return null; }
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<FirstRunTipsProvider><OtherTip /></FirstRunTipsProvider>); });
    await flush();
    await act(async () => { controller.claim('seller-dashboard'); });
    await act(async () => { r.update(<FirstRunTipsProvider><OtherTip /><ScreenExplainer id={DEFAULT_ID} /></FirstRunTipsProvider>); });
    await flush();
    expect(sheet(r)).toHaveLength(0);
    await act(async () => { controller.release('seller-dashboard'); });
    await flush();
    expect(sheet(r)).toHaveLength(1);
  });
});

describe('SCREEN_EXPLAINERS registry: major screens only', () => {
  const appDir = path.resolve(__dirname, '../app');
  const files = new Map<string, string>();
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name)) files.set(path.relative(appDir, full), readFileSync(full, 'utf8'));
    }
  })(appDir);
  const all = [...files.values()].join('\n');

  it.each(Object.entries(SCREEN_EXPLAINERS))('%s has a title, 2–3 one-idea cards, and is mounted on a screen', (id, copy) => {
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.steps.length).toBeGreaterThanOrEqual(2);
    expect(copy.steps.length).toBeLessThanOrEqual(3);
    for (const step of copy.steps) {
      expect(step.icon.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
    expect(all).toContain(`<ScreenExplainer id="${id}"`);
  });

  it('keeps exactly the major screens', () => {
    expect(Object.keys(SCREEN_EXPLAINERS).sort()).toEqual([
      'buyer-discover', 'explain-boost', 'explain-create-ad', 'explain-design-gallery', 'explain-manufacturer-hub',
      'explain-payouts', 'explain-popup-mode', 'explain-thread-cash', 'seller-analytics',
    ]);
  });

  it.each([
    '(tabs)/orders.tsx', '(tabs)/products.tsx', '(tabs)/marketing.tsx', '(buyer)/cart.tsx', '(buyer)/orders.tsx',
    'buyer-checkout.tsx', 'buyer-drops.tsx', 'community.tsx', 'design-canvas.tsx', 'discounts.tsx',
    'email-campaigns.tsx', 'growth-links.tsx', 'link-in-bio.tsx', 'live-feed.tsx', 'membership-levels.tsx',
    'meta-ads-manage.tsx', 'plans.tsx', 'rfq-list.tsx', 'seller-creator-program.tsx', 'seller-drops.tsx',
    'seller-giveaways.tsx', 'seller-go-live.tsx', 'seller-push-broadcast.tsx', 'store-builder.tsx',
  ])('pruned: %s has no explainer', (file) => {
    expect(files.get(file)).toBeDefined();
    expect(files.get(file)).not.toContain('ScreenExplainer');
  });
});
