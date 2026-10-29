/**
 * One-time "what is this screen" explainers: shown once per screen per
 * account, dismissed by Got it, the X or a tap outside, never back after a
 * reload — and every registered explainer is mounted on a real screen with
 * 2–4 lines of copy.
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

async function open(id: keyof typeof SCREEN_EXPLAINERS = 'seller-orders'): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<FirstRunTipsProvider><ScreenExplainer id={id} /></FirstRunTipsProvider>); });
  await flush();
  return r;
}

const sheet = (r: ReactTestRenderer, id = 'seller-orders') =>
  r.root.findAll((n) => n.props.testID === `first-run-tip-explainer-${id}` && typeof n.type === 'string');

describe('ScreenExplainer', () => {
  beforeEach(() => {
    h.store.clear();
    h.server.clear();
    vi.clearAllMocks();
  });

  it('shows the screen title and its lines the first time', async () => {
    const r = await open();
    expect(sheet(r)).toHaveLength(1);
    const text = r.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children);
    expect(text).toContain('Orders');
    for (const line of SCREEN_EXPLAINERS['seller-orders'].lines) expect(text).toContain(line);
    expect(api.firstRunTips.markSeen).toHaveBeenCalledWith('seller-orders');
  });

  it.each([
    ['Got it', 'first-run-tip-explainer-ok'],
    ['the X', 'first-run-tip-explainer-close'],
  ])('dismisses with %s', async (_label, testID) => {
    const r = await open();
    const button = r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
    await act(async () => button.props.onPress());
    expect(sheet(r)).toHaveLength(0);
  });

  it('dismisses with a tap outside the card', async () => {
    const r = await open();
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
    const first = await open('seller-orders');
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
    await act(async () => { r.update(<FirstRunTipsProvider><OtherTip /><ScreenExplainer id="seller-orders" /></FirstRunTipsProvider>); });
    await flush();
    expect(sheet(r)).toHaveLength(0);
    await act(async () => { controller.release('seller-dashboard'); });
    await flush();
    expect(sheet(r)).toHaveLength(1);
  });
});

describe('SCREEN_EXPLAINERS registry', () => {
  const appDir = path.resolve(__dirname, '../app');
  const sources: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name)) sources.push(readFileSync(full, 'utf8'));
    }
  })(appDir);
  const all = sources.join('\n');

  it.each(Object.entries(SCREEN_EXPLAINERS))('%s has a title, 2–4 lines, and is mounted on a screen', (id, copy) => {
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.lines.length).toBeGreaterThanOrEqual(2);
    expect(copy.lines.length).toBeLessThanOrEqual(4);
    expect(all).toContain(`<ScreenExplainer id="${id}"`);
  });
});
