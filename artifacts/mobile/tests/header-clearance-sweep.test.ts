import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useSegments: () => [] }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { background: '#000000', text: '#FFFFFF' } }) }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 54 }));
vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({ useTabBarClearance: () => 98 }));
vi.mock('@/lib/tabBarVisibility', () => ({ useTabBarHiddenByScreen: () => false }));
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s }, View: 'View' }));

import { isImmersiveTopRoute } from '@/components/layout/ScreenChrome';
import { EMPTY_STATE_ICONS } from '@/components/layout/emptyStateIcons';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...tsxFiles(rel));
    else if (name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

/**
 * The "Header + bottom-clearance sweep": Dev's app-wide layout rules, each
 * enforced in ONE shared place.
 */
describe('headers: bare back arrow + title — no subtitle, no divider', () => {
  it('ScreenHeader has no subtitle prop at all and its divider is off by default', () => {
    const src = read('components/ScreenHeader.tsx');
    expect(src).not.toMatch(/\bsubtitle\??:/);
    expect(src).toContain("variant = 'push', divider = false,");
  });

  it('no ScreenHeader call site anywhere passes a subtitle', () => {
    const offenders = tsxFiles('app').concat(tsxFiles('components')).filter((f) => {
      const src = read(f);
      return /<ScreenHeader\b[^>]*\bsubtitle=/s.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('the layout Header defaults to no divider', () => {
    expect(read('components/layout/Header.tsx')).toContain("dividerVariant = 'none',");
  });
});

describe('nothing under the notch: one solid status-bar mask over every non-immersive screen', () => {
  it('is rendered once above the root stack, in the screen background colour', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('<StatusBarMask />');
    const chrome = read('components/layout/ScreenChrome.tsx');
    expect(chrome).toContain('backgroundColor: theme.background');
    expect(chrome).toContain('testID="status-bar-mask"');
  });

  it('skips only genuinely immersive media / pre-shell routes', () => {
    expect(isImmersiveTopRoute(['camera-capture'])).toBe(true);
    expect(isImmersiveTopRoute(['buyer-story-viewer'])).toBe(true);
    expect(isImmersiveTopRoute(['(buyer)', 'feed'])).toBe(true);
    expect(isImmersiveTopRoute(['(tabs)', 'feed'])).toBe(true);
    expect(isImmersiveTopRoute(['sign-in'])).toBe(true);
    // Ordinary app screens are always masked.
    expect(isImmersiveTopRoute(['(tabs)', 'profile'])).toBe(false);
    expect(isImmersiveTopRoute(['(tabs)'])).toBe(false);
    expect(isImmersiveTopRoute(['(tabs)', 'analytics'])).toBe(false);
    expect(isImmersiveTopRoute(['seller-inbox'])).toBe(false);
    expect(isImmersiveTopRoute(['(buyer)', 'profile'])).toBe(false);
  });
});

describe('nothing under the tab bar: one shared clearance', () => {
  it('every pushed seller scene the bar floats over gets the clearance as a bottom margin', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('const bottomClearance = useSceneBottomClearance(barFloatsOverScene);');
    expect(layout).toContain("routeName !== '(tabs)'");
    expect(layout).toContain('!SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS.has(routeName)');
    expect(layout).toContain("(!presentation || presentation === 'card')");
    // A margin, not padding: absolutely-positioned bottom bars must lift too.
    expect(layout).toContain('marginBottom: bottomClearance');
  });

  it('the seller tab screens pad their scroll content with the same helper', () => {
    for (const f of ['app/(tabs)/analytics.tsx', 'app/(tabs)/more.tsx', 'app/(tabs)/studio.tsx', 'app/(tabs)/marketing.tsx']) {
      expect(read(f), f).toContain('useTabBarClearance(2)');
    }
  });
});

describe('Analytics tab', () => {
  const src = read('app/(tabs)/analytics.tsx');
  it('Visits and Revenue are two EQUAL columns (both wrapped in flex: 1 cells)', () => {
    expect(src.match(/style=\{s\.statCell\}/g)?.length).toBe(2);
    expect(src).toContain('statCell: { flex: 1, minWidth: 0 },');
  });
  it('the empty chart is the shorter ~120px band', () => {
    expect(src).toContain('const EMPTY_CHART_HEIGHT = 120;');
    expect(src).toContain('height={chartEmpty ? EMPTY_CHART_HEIGHT : CHART_HEIGHT}');
  });
});

describe('seller profile', () => {
  it('Edit and Messages are equal flex:1 columns of the same height', () => {
    const controls = read('components/profile/ProfileControls.tsx');
    expect(controls).toContain('editBtnWrap: { flex: 1 },');
    expect(controls).toContain('messagesBtnWrap: { flex: 1 },');
  });

  it('header: bigger avatar, 13px handle, "Seller" + plan chips stacked under it', () => {
    expect(read('components/profile/profileAvatarGeometry.ts')).toContain('export const PROFILE_VIDEO_HEADER_AVATAR_SIZE = 88;');
    const header = read('components/profile/ProfileVideoHeader.tsx');
    expect(header).toContain("handleCompact: { fontSize: 13, lineHeight: 17 },");
    expect(header).toContain("chipStack: { marginTop: 6, gap: 6, alignItems: 'flex-start' },");
    const profile = read('app/(tabs)/profile.tsx');
    expect(profile).toContain("extraChips: [{ label: planLabel, icon: hasPaidPlan ? 'award' : 'layers' }],");
  });
});

describe('the one shared empty-state badge', () => {
  it('both EmptyState components render it', () => {
    expect(read('components/layout/EmptyState.tsx')).toContain('<EmptyStateBadge');
    expect(read('components/BrandthreadUI.tsx')).toContain('<EmptyStateBadge');
  });

  it('ships the profile tab icons as Feather-exact geometry', () => {
    expect(EMPTY_STATE_ICONS.grid.nodes).toHaveLength(4);
    expect(EMPTY_STATE_ICONS['shopping-bag'].nodes[0][1].d).toBe('M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z');
    expect(EMPTY_STATE_ICONS.tag.nodes[0][1].d).toBe('M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z');
  });

  it('every icon carries a measured optical-centre offset that is small (within 1.5 grid units)', () => {
    for (const [name, icon] of Object.entries(EMPTY_STATE_ICONS)) {
      expect(Math.abs(icon.dx), name).toBeLessThanOrEqual(1.5);
      expect(Math.abs(icon.dy), name).toBeLessThanOrEqual(1.5);
    }
    // The tag's body sits up-left in its own box — it needs the correction.
    expect(EMPTY_STATE_ICONS.tag.dx).toBeGreaterThan(0.3);
    expect(EMPTY_STATE_ICONS.tag.dy).toBeGreaterThan(0.3);
  });

  it('covers every icon name an empty state uses today', () => {
    for (const n of ['grid', 'shopping-bag', 'tag', 'video', 'users', 'mail', 'alert-circle', 'wifi-off', 'heart', 'bookmark', 'package', 'file-text', 'clock', 'film', 'repeat', 'inbox', 'message-circle', 'tool', 'play-circle']) {
      expect(EMPTY_STATE_ICONS[n], n).toBeDefined();
    }
  });
});
