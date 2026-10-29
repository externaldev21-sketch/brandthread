/**
 * Dev's report: in the fast-preview, Design Studio's explainer came back
 * after Got it → another screen → back. The preview only shows tips with
 * `&tips=1`, which used to treat every tip as unseen on every visit. A
 * dismissal must hold in the preview too: dismiss → leave → return, and
 * after a reload, shows nothing. The preview has no server session (every
 * first-run-tips request fails) and its account id may resolve late, so the
 * local cache alone has to carry it.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  auth: { userId: null as string | null, isLoaded: false },
  preview: true,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
  },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => h.preview }));
// `?bt_preview=seller&tips=1`
vi.mock('@/lib/firstRunTips/rules', async (orig) => ({
  ...(await orig<typeof import('@/lib/firstRunTips/rules')>()),
  isFirstRunTipsPreviewForceShow: () => true,
  isPreviewWithoutTipsForce: () => false,
}));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: (props: Record<string, unknown>) =>
    React.createElement('PressableScale', props, props.children as React.ReactNode),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
const unauthorized = () => Promise.reject(new Error('401'));
const api = {
  firstRunTips: {
    get: vi.fn(unauthorized),
    markSeen: vi.fn(unauthorized),
    skipAll: vi.fn(unauthorized),
    reset: vi.fn(unauthorized),
  },
};
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));

import { FirstRunTipsProvider } from '@/contexts/FirstRunTipsContext';
import { ScreenExplainer } from '@/components/first-run-tips/ScreenExplainer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
}

type Screen = 'design' | 'hub';
function App({ screen }: { screen: Screen }) {
  return (
    <FirstRunTipsProvider>
      {screen === 'design'
        ? <ScreenExplainer key="design" id="explain-design-gallery" />
        : <ScreenExplainer key="hub" id="explain-manufacturer-hub" />}
    </FirstRunTipsProvider>
  );
}

const shown = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === `first-run-tip-explainer-${id}` && typeof n.type === 'string').length > 0;

/** Next through the cards, then Got it on the last one. */
async function gotIt(r: ReactTestRenderer) {
  const find = (id: string) => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0];
  for (let next = find('first-run-tip-explainer-next'); next; next = find('first-run-tip-explainer-next')) {
    await act(async () => next.props.onPress());
  }
  await act(async () => find('first-run-tip-explainer-ok').props.onPress());
}

describe('explainer dismissal in the dev preview (&tips=1)', () => {
  beforeEach(() => {
    h.store.clear();
    h.auth = { userId: null, isLoaded: false };
    h.preview = true;
    vi.clearAllMocks();
  });

  it('dismiss → leave → return shows nothing, and still nothing after a reload', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<App screen="design" />); });
    await flush();
    expect(shown(r, 'explain-design-gallery')).toBe(true);
    await gotIt(r);
    expect(shown(r, 'explain-design-gallery')).toBe(false);

    // Navigate to the hub (its own explainer shows once), then back.
    await act(async () => { r.update(<App screen="hub" />); });
    await flush();
    expect(shown(r, 'explain-manufacturer-hub')).toBe(true);
    await gotIt(r);
    await act(async () => { r.update(<App screen="design" />); });
    await flush();
    expect(shown(r, 'explain-design-gallery')).toBe(false);

    // Reload; this time Clerk's preview account id has resolved.
    await act(async () => { r.unmount(); });
    h.auth = { userId: 'user_preview', isLoaded: true };
    await act(async () => { r = create(<App screen="design" />); });
    await flush();
    expect(shown(r, 'explain-design-gallery')).toBe(false);
    await act(async () => { r.update(<App screen="hub" />); });
    await flush();
    expect(shown(r, 'explain-manufacturer-hub')).toBe(false);
  });

  it('never calls the server from the preview', async () => {
    let r!: ReactTestRenderer;
    h.auth = { userId: 'user_preview', isLoaded: true };
    await act(async () => { r = create(<App screen="design" />); });
    await flush();
    await gotIt(r);
    expect(api.firstRunTips.get).not.toHaveBeenCalled();
    expect(api.firstRunTips.markSeen).not.toHaveBeenCalled();
  });

  it('a real account still syncs with the server', async () => {
    h.preview = false;
    h.auth = { userId: 'user_1', isLoaded: true };
    api.firstRunTips.get.mockResolvedValueOnce({ seenTipIds: [], skipAll: false } as never);
    api.firstRunTips.markSeen.mockResolvedValue(undefined as never);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<App screen="design" />); });
    await flush();
    expect(shown(r, 'explain-design-gallery')).toBe(true);
    expect(api.firstRunTips.markSeen).toHaveBeenCalledWith('explain-design-gallery');
  });
});
