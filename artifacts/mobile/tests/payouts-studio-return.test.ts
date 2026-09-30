import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { returnToStudioMenu, subscribeStudioMenuReturn } from '../lib/navigation/studioMenuReturn';

describe('Payouts return to Studio', () => {
  it('pops the previous route before reopening the menu', () => {
    const events: string[] = [];
    const router = {
      canGoBack: () => true,
      back: vi.fn(() => events.push('back')),
      replace: vi.fn(),
    };
    const unsubscribe = subscribeStudioMenuReturn(() => events.push('menu'));
    try {
      returnToStudioMenu(router);
      expect(events).toEqual(['back', 'menu']);
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('opens Studio over a seller fallback when history is unavailable', () => {
    const reopen = vi.fn();
    const router = { canGoBack: () => false, back: vi.fn(), replace: vi.fn() };
    const unsubscribe = subscribeStudioMenuReturn(reopen);
    try {
      returnToStudioMenu(router);
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/(tabs)/more');
      expect(reopen).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('does not retain an unmounted menu subscription', () => {
    const reopen = vi.fn();
    const unsubscribe = subscribeStudioMenuReturn(reopen);
    unsubscribe();
    returnToStudioMenu({ canGoBack: () => true, back: vi.fn(), replace: vi.fn() });
    expect(reopen).not.toHaveBeenCalled();
  });

  it('marks only the Studio Payouts launch and restores the selection without auto-entering', () => {
    const root = path.resolve(__dirname, '..');
    const menu = fs.readFileSync(path.join(root, 'components/SellerStudioRadialMenu.tsx'), 'utf8');
    const payouts = fs.readFileSync(path.join(root, 'app/payouts.tsx'), 'utf8');
    expect(menu).toContain("if (item.id === 'payouts')");
    expect(menu).toContain("pathname: '/payouts', params: { from: STUDIO_PAYOUTS_ORIGIN }");
    expect(menu).toContain('resumeCardOnOpenRef.current = true');
    expect(menu).toContain('if (!resumeCardOnOpenRef.current)');
    expect(menu).toContain("setEnterState('hidden')");
    expect(payouts).toContain('params.from === STUDIO_PAYOUTS_ORIGIN');
    expect(payouts).toContain('returnToStudioMenu(router)');
    expect(payouts).toContain("goBackOr(router, '/(tabs)/more')");
  });
});