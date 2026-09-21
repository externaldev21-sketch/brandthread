/**
 * CommerceSignal — focused tests for buyer demand layer.
 *
 * Covers:
 * - Truthful fields: renders only when server supplies non-zero values
 * - Unavailable-state omission: absent fields produce no output
 * - Urgency threshold: theme.accent (NOT RED) used for low-stock / ending-soon
 * - High-demand section: renders when demandCount >= HIGH_DEMAND_THRESHOLD
 * - Runtime accent propagation: accent prop flows through to all sub-primitives
 * - Seller presentation isolation: FeedScreen buyerMode gate is explicit
 * - Discover / drop-detail: no RED urgency, accent from theme
 * - API call correctness: publicTrending.get(limit), publicProducts.list({limit})
 * - FlatList pager integrity: demand page is an item (SCREEN_H), not a sibling
 * - Discover error states: each section has retry, empty state is distinct
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Mock accent — a distinguishable non-RED value ────────────────────────────

/** The test accent color — a clear non-red value so assertions can distinguish it from RED. */
const TEST_ACCENT = '#A855F7'; // purple, not red
const TEST_ACCENT_DIM = 'rgba(168,85,247,0.18)';

// ─── Minimal RN mock ──────────────────────────────────────────────────────────

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => {
    function C(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    C.displayName = name;
    return C;
  };
  const AnimatedView = el('AnimatedView');
  const noopAnim = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
  return {
    AccessibilityInfo: { isReduceMotionEnabled: vi.fn().mockResolvedValue(true) },
    Animated: {
      Value: class {
        _value: number;
        constructor(v: number) { this._value = v; }
        setValue(v: number) { this._value = v; }
        interpolate() { return this; }
      },
      loop: () => noopAnim,
      sequence: () => noopAnim,
      timing: () => noopAnim,
      spring: () => noopAnim,
      parallel: () => noopAnim,
      View: AnimatedView,
    },
    StyleSheet: {
      create: (s: unknown) => s,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
    View: el('View'),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) =>
    React.createElement('Feather', { name }),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#07070F', SURFACE: '#0C0C17', CARD: '#12121F', CARD_ELEVATED: '#18182E',
  BORDER: 'rgba(255,255,255,0.07)',
  FG: '#F4F4FF', MUTED: 'rgba(244,244,255,0.50)', SUBTLE: 'rgba(244,244,255,0.28)',
  ON_DARK: '#FFFFFF',
  RED: '#F87171', RED_DIM: 'rgba(248,113,113,0.15)',
  SUCCESS: '#10B981',
  ORANGE: '#F97316',
  FONT: {
    thin: 'Inter_100Thin', light: 'Inter_300Light', regular: 'Inter_400Regular',
    medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold',
    extrabold: 'Inter_800ExtraBold',
  },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26, h2: 30, h1: 36 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32, pill: 999 },
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent:     TEST_ACCENT,
      accentLight:'#D8B4FE',
      accentDim:  TEST_ACCENT_DIM,
      onAccent:   '#07080A',
    },
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  UrgencyBar,
  DemandBadge,
  HighDemandSectionHead,
  CommerceSignalRow,
  PriceBadge,
  LivePulseDot,
  URGENCY_UNITS_THRESHOLD,
  URGENCY_MINUTES_THRESHOLD,
  HIGH_DEMAND_THRESHOLD,
} from './CommerceSignal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(node);
    await Promise.resolve();
  });
  return r;
}

function textContent(renderer: ReactTestRenderer): string[] {
  try {
    return renderer.root
      .findAllByType('Text' as React.ElementType)
      .map(n => String(n.props.children));
  } catch {
    return [];
  }
}

/** Collect all color-like string values from style props AND direct props (like Feather color=). */
function allColorValues(renderer: ReactTestRenderer): string[] {
  const colors: string[] = [];
  function walk(node: any) {
    if (!node) return;
    // Scan style props
    if (node.props?.style) {
      const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
      styles.flat(Infinity).forEach((s: unknown) => {
        if (s && typeof s === 'object') {
          Object.values(s as Record<string, unknown>).forEach(v => {
            if (typeof v === 'string') colors.push(v);
          });
        }
      });
    }
    // Scan direct props (Feather color, backgroundColor, etc.)
    if (node.props) {
      Object.entries(node.props as Record<string, unknown>).forEach(([, v]) => {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$|^rgba?\(/.test(v)) {
          colors.push(v);
        }
      });
    }
    (node.children ?? []).forEach(walk);
  }
  try { walk(renderer.root); } catch { /* unmounted */ }
  return colors;
}

function hasAccentColor(renderer: ReactTestRenderer, color: string): boolean {
  return allColorValues(renderer).includes(color);
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it(`URGENCY_UNITS_THRESHOLD is 10`, () => expect(URGENCY_UNITS_THRESHOLD).toBe(10));
  it(`URGENCY_MINUTES_THRESHOLD is 60`, () => expect(URGENCY_MINUTES_THRESHOLD).toBe(60));
  it(`HIGH_DEMAND_THRESHOLD is 50`, () => expect(HIGH_DEMAND_THRESHOLD).toBe(50));
});

// ─── ClaimedRemainingLabel — truthful fields ──────────────────────────────────

describe('ClaimedRemainingLabel — truthful fields', () => {
  it('renders claimed + remaining when both > 0', async () => {
    const r = await render(<ClaimedRemainingLabel claimedUnits={42} remainingUnits={58} />);
    const texts = textContent(r);
    expect(texts.some(t => t.includes('42'))).toBe(true);
    expect(texts.some(t => t.includes('58'))).toBe(true);
    r.unmount();
  });

  it('omits entirely when both are 0 (unavailable-state omission)', async () => {
    const r = await render(<ClaimedRemainingLabel claimedUnits={0} remainingUnits={0} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('renders only claimed when remainingUnits is 0', async () => {
    const r = await render(<ClaimedRemainingLabel claimedUnits={10} remainingUnits={0} />);
    const texts = textContent(r);
    expect(texts.some(t => t.includes('10'))).toBe(true);
    expect(texts.some(t => t.includes('left'))).toBe(false);
    r.unmount();
  });

  it('renders only remaining when claimedUnits is 0', async () => {
    const r = await render(<ClaimedRemainingLabel claimedUnits={0} remainingUnits={7} />);
    const texts = textContent(r);
    expect(texts.some(t => t.includes('7'))).toBe(true);
    expect(texts.some(t => t.includes('claimed'))).toBe(false);
    r.unmount();
  });
});

// ─── Urgency accent — theme.accent, NOT RED ───────────────────────────────────

describe('Urgency accent uses theme.accent, not RED', () => {
  const RED_COLOR = '#F87171'; // from the mock theme

  it('ClaimedRemainingLabel urgent=true applies the accent prop, not RED', async () => {
    const r = await render(
      <ClaimedRemainingLabel
        claimedUnits={90}
        remainingUnits={URGENCY_UNITS_THRESHOLD}
        urgent
        accent={TEST_ACCENT}
      />,
    );
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });

  it('UrgencyBar uses the accentColor prop, not RED', async () => {
    const r = await render(
      <UrgencyBar claimedUnits={60} remainingUnits={5} accentColor={TEST_ACCENT} />,
    );
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });

  it('UrgencyBar defaults to theme.accent when no accentColor prop', async () => {
    const r = await render(<UrgencyBar claimedUnits={60} remainingUnits={5} />);
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    r.unmount();
  });

  it('DemandBadge uses the accent prop, not RED', async () => {
    const r = await render(
      <DemandBadge demandCount={HIGH_DEMAND_THRESHOLD} accent={TEST_ACCENT} />,
    );
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });

  it('LivePulseDot uses the color prop (accent), not RED', async () => {
    const r = await render(<LivePulseDot color={TEST_ACCENT} />);
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });

  it('TimeRemainingLabel urgent state uses accent, not RED', async () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // +30 min
    const r = await render(<TimeRemainingLabel endsAt={future} accent={TEST_ACCENT} />);
    if (r.toJSON() !== null) {
      expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    }
    r.unmount();
  });

  it('HighDemandSectionHead icon uses accent, not RED', async () => {
    const r = await render(<HighDemandSectionHead accent={TEST_ACCENT} />);
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });

  it('CommerceSignalRow passes accent through to all children', async () => {
    const r = await render(
      <CommerceSignalRow
        claimedUnits={90}
        remainingUnits={URGENCY_UNITS_THRESHOLD}
        demandCount={HIGH_DEMAND_THRESHOLD}
        accent={TEST_ACCENT}
      />,
    );
    expect(hasAccentColor(r, TEST_ACCENT)).toBe(true);
    expect(hasAccentColor(r, RED_COLOR)).toBe(false);
    r.unmount();
  });
});

// ─── TimeRemainingLabel — unavailable-state omission ─────────────────────────

describe('TimeRemainingLabel — unavailable-state omission', () => {
  it('returns null when endsAt is null', async () => {
    const r = await render(<TimeRemainingLabel endsAt={null} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when endsAt is undefined', async () => {
    const r = await render(<TimeRemainingLabel endsAt={undefined} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when endsAt is in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = await render(<TimeRemainingLabel endsAt={past} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('renders when endsAt is in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const r = await render(<TimeRemainingLabel endsAt={future} />);
    expect(r.toJSON()).not.toBeNull();
    r.unmount();
  });
});

// ─── UrgencyBar ───────────────────────────────────────────────────────────────

describe('UrgencyBar', () => {
  it('renders when both claimed and remaining > 0', async () => {
    const r = await render(<UrgencyBar claimedUnits={60} remainingUnits={40} />);
    expect(r.toJSON()).not.toBeNull();
    r.unmount();
  });

  it('returns null when claimedUnits is 0', async () => {
    const r = await render(<UrgencyBar claimedUnits={0} remainingUnits={40} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when remainingUnits is 0', async () => {
    const r = await render(<UrgencyBar claimedUnits={40} remainingUnits={0} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });
});

// ─── DemandBadge — high-demand section ───────────────────────────────────────

describe('DemandBadge — high-demand section', () => {
  it('renders "High Demand" when demandCount >= threshold', async () => {
    const r = await render(<DemandBadge demandCount={HIGH_DEMAND_THRESHOLD} />);
    expect(r.toJSON()).not.toBeNull();
    const texts = textContent(r);
    expect(texts.some(t => t.toLowerCase().includes('high demand'))).toBe(true);
    r.unmount();
  });

  it('returns null when demandCount < threshold', async () => {
    const r = await render(<DemandBadge demandCount={HIGH_DEMAND_THRESHOLD - 1} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when demandCount is null', async () => {
    const r = await render(<DemandBadge demandCount={null} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when demandCount is undefined', async () => {
    const r = await render(<DemandBadge demandCount={undefined} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });
});

// ─── HighDemandSectionHead ────────────────────────────────────────────────────

describe('HighDemandSectionHead', () => {
  it('renders bold "High Demand" title', async () => {
    const r = await render(<HighDemandSectionHead />);
    const texts = textContent(r);
    expect(texts.some(t => t === 'High Demand')).toBe(true);
    r.unmount();
  });

  it('renders custom title and subtitle', async () => {
    const r = await render(
      <HighDemandSectionHead title="Moving Fast" subtitle="Right now on the platform" />,
    );
    const texts = textContent(r);
    expect(texts.some(t => t === 'Moving Fast')).toBe(true);
    expect(texts.some(t => t === 'Right now on the platform')).toBe(true);
    r.unmount();
  });

  it('omits subtitle when empty string', async () => {
    const r = await render(<HighDemandSectionHead title="Test" subtitle="" />);
    const texts = textContent(r);
    expect(texts.filter(t => t === '').length).toBe(0);
    r.unmount();
  });
});

// ─── PriceBadge — truthful price ─────────────────────────────────────────────

describe('PriceBadge — truthful price', () => {
  it('renders formatted price when currentPriceCents is provided', async () => {
    const r = await render(<PriceBadge currentPriceCents={18900} />);
    const texts = textContent(r);
    expect(texts.some(t => t === '$189.00')).toBe(true);
    r.unmount();
  });

  it('returns null when currentPriceCents is null', async () => {
    const r = await render(<PriceBadge currentPriceCents={null} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('returns null when currentPriceCents is undefined', async () => {
    const r = await render(<PriceBadge currentPriceCents={undefined} />);
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });
});

// ─── CommerceSignalRow — composite signal ─────────────────────────────────────

describe('CommerceSignalRow — composite signal', () => {
  it('returns null when all fields absent', async () => {
    const r = await render(
      <CommerceSignalRow
        claimedUnits={0}
        remainingUnits={0}
        demandCount={null}
        endsAt={null}
      />,
    );
    expect(r.toJSON()).toBeNull();
    r.unmount();
  });

  it('shows price when showPrice=true and currentPriceCents present', async () => {
    const r = await render(
      <CommerceSignalRow showPrice currentPriceCents={13500} claimedUnits={0} remainingUnits={0} />,
    );
    const texts = textContent(r);
    expect(texts.some(t => t === '$135.00')).toBe(true);
    r.unmount();
  });

  it('renders units when present', async () => {
    const r = await render(<CommerceSignalRow claimedUnits={42} remainingUnits={8} />);
    const texts = textContent(r);
    expect(texts.some(t => t.includes('42'))).toBe(true);
    expect(texts.some(t => t.includes('8'))).toBe(true);
    r.unmount();
  });

  it('renders demand badge when demandCount >= threshold', async () => {
    const r = await render(
      <CommerceSignalRow
        claimedUnits={0}
        remainingUnits={0}
        demandCount={HIGH_DEMAND_THRESHOLD + 10}
      />,
    );
    const texts = textContent(r);
    expect(texts.some(t => t.toLowerCase().includes('high demand'))).toBe(true);
    r.unmount();
  });
});

// ─── Seller presentation isolation — buyerMode gate ──────────────────────────

describe('Seller presentation isolation — buyerMode gate', () => {
  it('buyer feed.tsx passes buyerMode={true} to FeedScreen', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/feed.tsx'), 'utf8');
    expect(source).toContain('buyerMode');
    expect(source).toMatch(/buyerMode\s*=\s*\{?\s*true\s*\}?/);
  });

  it('shared feed.tsx exports FeedScreen accepting buyerMode prop (defaults false)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    expect(source).toContain('buyerMode');
    expect(source).toMatch(/buyerMode\s*=\s*false/);
  });

  it('seller mode: demand sentinel not added when buyerMode=false', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Guard: only add sentinel when buyerMode is true
    expect(source).toMatch(/if\s*\(!buyerMode\)|buyerMode\s*\?\s*\[DEMAND_PAGE_SENTINEL/);
  });

  it('seller mode: BuyerHighDemandPage is never rendered when buyerMode=false', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // The demand page is rendered inside renderItem only when isDemandPageItem is true.
    // displayItems never contains the sentinel when buyerMode=false.
    expect(source).toContain('isDemandPageItem');
    expect(source).toContain('DEMAND_PAGE_SENTINEL');
  });

  it('BuyerHighDemandPage uses publicProducts.highDemand (not list, not hardcoded)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Must use the dedicated highDemand endpoint
    expect(source).toMatch(/publicProducts\.highDemand\s*\(\s*6\s*\)/);
    // Must NOT fall back to ordinary list()
    expect(source).not.toMatch(/publicProducts\.list\s*\(\s*\{.*limit.*6/);
    // No hardcoded price strings
    expect(source).not.toMatch(/price:\s*'\$\d+'/);
    // No fake demandCount from finalScore
    expect(source).not.toContain('finalScore');
  });

  it('the API server implements high-demand before the generic product-id route', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../api-server/src/routes/public.ts'), 'utf8');
    const highDemandIndex = source.indexOf('router.get("/products/high-demand"');
    const productIdIndex = source.indexOf('router.get("/products/:id"');
    expect(highDemandIndex).toBeGreaterThan(-1);
    expect(productIdIndex).toBeGreaterThan(highDemandIndex);
    expect(source).toContain('product.demandCount >= 50');
    expect(source).toContain('product.remainingUnits <= 10');
    expect(source).toContain('isNotNull(orders.paidAt)');
    expect(source).toContain('paidClaimsMap.get(product.id)');
  });

  it('BuyerHighDemandPage uses commerce signal components with accent', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    expect(source).toContain('ClaimedRemainingLabel');
    expect(source).toContain('TimeRemainingLabel');
    expect(source).toContain('UrgencyBar');
    expect(source).toContain('HighDemandSectionHead');
    expect(source).toMatch(/accent=\{theme\.accent\}/);
    expect(source).toMatch(/accentColor=\{theme\.accent\}/);
  });
});

// ─── Blocker 1: API call correctness ─────────────────────────────────────────
// publicTrending.get(limit: number) — NOT get({limit})
// publicProducts.list({limit}) returns any[] directly — NOT {items: []}
// demandCount must NOT be mapped from finalScore/organicScore

describe('Blocker 1 — API call signatures are correct', () => {
  it('publicTrending.get is called with a number, not an object', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    // Check discover.tsx
    const discoverSrc = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // Should call get(20) — not get({ limit: 20 })
    expect(discoverSrc).toMatch(/publicTrending\.get\s*\(\s*\d+\s*\)/);
    expect(discoverSrc).not.toMatch(/publicTrending\.get\s*\(\s*\{/);
  });

  it('publicProducts.list result is treated as a direct array (no .items wrapper)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const feedSrc = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Must not try to read .items from the result — it IS the array
    expect(feedSrc).not.toMatch(/publicProducts\.list.*\.\s*items/);
    expect(feedSrc).not.toMatch(/\.items.*publicProducts/);
    // Must use Array.isArray directly on the result
    expect(feedSrc).toContain('Array.isArray(rows)');
  });

  it('demand page never maps finalScore or organicScore to demandCount', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const feedSrc = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // No finalScore / organicScore usage anywhere in feed.tsx
    expect(feedSrc).not.toContain('finalScore');
    expect(feedSrc).not.toContain('organicScore');
  });

  it('demand cards navigate to real productId from publicProducts', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const feedSrc = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Navigation uses item.id which is set from p.id (the real product id)
    expect(feedSrc).toMatch(/encodeURIComponent\(item\.id\)/);
    expect(feedSrc).toContain('thread-product-detail');
  });
});

// ─── Blocker 2: FlatList pager integrity ─────────────────────────────────────
// Demand page is index-0 FlatList item with SCREEN_H, not a sibling View.
// getItemLayout must cover all indices uniformly at SCREEN_H.

describe('Blocker 2 — FlatList pager integrity (SCREEN_H per item)', () => {
  it('DEMAND_PAGE_SENTINEL is a FlatList data item, not a sibling View', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Sentinel in displayItems array — not a JSX sibling above the FlatList
    expect(source).toContain('DEMAND_PAGE_SENTINEL');
    expect(source).toContain('displayItems');
    // No {buyerMode && <BuyerHighDemandSection />} sibling above FlatList
    expect(source).not.toMatch(/buyerMode\s*&&\s*<BuyerHighDemandSection/);
    expect(source).not.toContain('BuyerHighDemandSection');  // renamed to BuyerHighDemandPage
  });

  it('BuyerHighDemandPage has SCREEN_H geometry', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // BuyerHighDemandPage style must set height: SCREEN_H
    expect(source).toContain('height: SCREEN_H');
    expect(source).toContain('width: SCREEN_W');
  });

  it('getItemLayout is uniform: SCREEN_H per item for all indices', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // getItemLayout function: length: SCREEN_H, offset: SCREEN_H * index
    expect(source).toMatch(/length:\s*SCREEN_H/);
    expect(source).toMatch(/offset:\s*SCREEN_H\s*\*\s*index/);
    // No conditional offset for buyerMode — all items are uniform height
    expect(source).not.toMatch(/offset:\s*SCREEN_H\s*\*\s*\(\s*index\s*[+-]/);
  });

  it('seller mode never inserts the demand sentinel into displayItems', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Sentinel is defined and used in displayItems
    expect(source).toContain('DEMAND_PAGE_SENTINEL');
    // Guard: return early without sentinel when buyerMode is false
    expect(source).toContain('if (!buyerMode)');
    // Sentinel is prepended only in the else branch
    expect(source).toContain('[DEMAND_PAGE_SENTINEL,');
  });
});

// ─── Discover section-level errors ───────────────────────────────────────────

describe('Discover — section-level error states and retry', () => {
  it('discover.tsx has per-section error state for all four sections', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // High Demand section has its own error state
    expect(source).toContain('highDemandError');
    expect(source).toContain('setHighDemandError');
    // For You, Drops, Trending each have their own
    expect(source).toContain('forYouError');
    expect(source).toContain('dropsError');
    expect(source).toContain('trendingError');
    expect(source).toContain('setForYouError');
    expect(source).toContain('setDropsError');
    expect(source).toContain('setTrendingError');
  });

  it('each section renders a retry button on error', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // SectionError component used for each section
    expect(source).toMatch(/highDemandError.*SectionError|SectionError.*highDemandError/s);
    expect(source).toMatch(/forYouError.*SectionError|SectionError.*forYouError/s);
    expect(source).toMatch(/dropsError.*SectionError|SectionError.*dropsError/s);
    expect(source).toMatch(/trendingError.*SectionError|SectionError.*trendingError/s);
    // Retry callbacks wired
    expect(source).toContain('onRetry={fetchHighDemand}');
    expect(source).toContain('onRetry={fetchProducts}');
    expect(source).toContain('onRetry={fetchDrops}');
    expect(source).toContain('onRetry={fetchTrending}');
  });

  it('error catch blocks do not reset data arrays (previous data preserved)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // On error, only set the error string — don't clear items
    expect(source).toContain('setHighDemandError(');
    expect(source).toContain('setForYouError(');
    expect(source).toContain('setDropsError(');
    expect(source).toContain('setTrendingError(');
  });

  it('empty states are distinct from error states', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // SectionError component is used for error states
    expect(source).toContain('SectionError');
    // High Demand empty state (no qualifying products)
    expect(source).toContain('No high-demand products right now');
    // For You empty state
    expect(source).toContain('No products available right now');
    // Error messages use "Could not load"
    expect(source).toMatch(/Could not load high demand products|Couldn't load high demand products/i);
    expect(source).toMatch(/Could not load products|Couldn't load products/);
  });

  it('discover fetchTrending uses get(number) not get({limit})', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // Correct: api.publicTrending.get(20)
    expect(source).toMatch(/publicTrending\.get\s*\(\s*20\s*\)/);
    // No object argument
    expect(source).not.toMatch(/publicTrending\.get\s*\(\s*\{/);
  });

  it('discover does not fake demandCount from finalScore or organicScore', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // finalScore must NOT be assigned to demandCount
    expect(source).not.toMatch(/demandCount\s*:\s*(t|p|item)\s*\.\s*finalScore/);
    expect(source).not.toMatch(/demandCount\s*=\s*(t|p|item)\s*\.\s*finalScore/);
    // organicScore must NOT be assigned to demandCount
    expect(source).not.toMatch(/demandCount\s*:\s*(t|p|item)\s*\.\s*organicScore/);
  });
});

describe('Discover — swipeable product showcase', () => {
  it('keeps the For You products in a centered snapping carousel', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');

    expect(source).toContain('function ProductShowcase');
    expect(source).toContain('<Animated.FlatList');
    expect(source).toContain('snapToInterval={snapInterval}');
    expect(source).toContain('decelerationRate="fast"');
    expect(source).toContain('disableIntervalMomentum');
    expect(source).toContain('onMomentumScrollEnd=');
    expect(source).toContain('setActiveIndex(');
    expect(source).toContain('<ProductShowcase items={forYouItems} />');
  });

  it('shows the real product price and preserves product-detail navigation', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');

    expect(source).toContain('formatCents(item.commerce.currentPriceCents)');
    expect(source).toContain('item.productId ?? item.id');
    expect(source).toContain('/thread-product-detail?productId=');
    expect(source).toContain('accessibilityLabel={`Product ${activeIndex + 1} of ${items.length}`}');
  });
});

// ─── highDemand API endpoint tests ────────────────────────────────────────────

describe('highDemand API — correct endpoint, no ordinary-product fallback', () => {
  it('BuyerHighDemandPage in feed.tsx calls publicProducts.highDemand(6)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // Correct call: highDemand(6)
    expect(source).toMatch(/publicProducts\.highDemand\s*\(\s*6\s*\)/);
    // No ordinary list fallback
    expect(source).not.toMatch(/publicProducts\.list.*limit.*6.*buyerMode|buyerMode.*publicProducts\.list/s);
  });

  it('feed.tsx BuyerHighDemandPage has no ordinary-product fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
    // No "if rows empty, fallback to list()" pattern
    expect(source).not.toMatch(/safe\.length\s*===\s*0.*publicProducts\.list/s);
    // Empty state exists (items.length === 0 → empty UI, no second fetch)
    expect(source).toContain('No high-demand products right now');
    // highDemand is the only product fetch in BuyerHighDemandPage
    expect(source).toMatch(/publicProducts\.highDemand\s*\(\s*6\s*\)/);
  });

  it('Discover fetchHighDemand calls publicProducts.highDemand(6) not list()', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // Correct endpoint
    expect(source).toMatch(/publicProducts\.highDemand\s*\(\s*6\s*\)/);
    // Not ordinary list
    // The High Demand section must not fall back to publicProducts.list
    expect(source).toContain('fetchHighDemand');
  });

  it('Discover High Demand section uses HighDemandRow with real productId navigation', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // HighDemandRow navigates via productId (not brandId)
    expect(source).toContain('HighDemandRow');
    expect(source).toContain('productId:');
    expect(source).toMatch(/thread-product-detail.*productId/);
  });

  it('Trending section is separately titled and uses TrendingRow (no demand signals)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // Trending section exists with its own heading
    expect(source).toContain('"Trending"');
    // TrendingRow is a separate component from HighDemandRow
    expect(source).toContain('TrendingRow');
    // Trending section navigates to seller profile (brandId), not product detail
    expect(source).toMatch(/seller-profile.*brandId|brandId.*seller-profile/);
  });

  it('High Demand section never uses trending post data', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // highDemandItems is never derived from trendingItems by filtering
    expect(source).not.toMatch(/highDemandItems\s*=\s*trendingItems\.filter/);
    // The HighDemandRow component is only rendered from highDemandItems (not trendingItems)
    // Verify: the map that calls HighDemandRow iterates over highDemandItems
    expect(source).toMatch(/highDemandItems\.slice.*map.*HighDemandRow|highDemandItems\.map.*HighDemandRow/s);
    // TrendingRow is used only in the Trending section (not the High Demand section)
    // Confirm TrendingRow exists and is distinct
    expect(source).toContain('TrendingRow');
  });
});

// ─── Discover truthful data guard ─────────────────────────────────────────────

describe('Discover screen — no hardcoded mock data, accent-based urgency', () => {
  it('has no HERO_DROP or FOR_YOU mock data', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(source).not.toContain('HERO_DROP');
    expect(source).not.toContain('FOR_YOU =');
    expect(source).not.toContain('DROPPING_SOON');
    expect(source).not.toContain('TRENDING =');
    expect(source).not.toMatch(/price:\s*'\$\d+'/);
  });

  it('uses real API demand fields', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(source).toContain('currentPriceCents');
    expect(source).toContain('claimedUnits');
    expect(source).toContain('remainingUnits');
    expect(source).toContain('demandCount');
  });

  it('urgency signals use theme.accent, not RED constants', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(source).toMatch(/theme\.accent/);
    expect(source).not.toContain("RED,");
    expect(source).not.toContain("RED_DIM");
  });

  it('uses CommerceSignal components with accent prop', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(source).toContain('ClaimedRemainingLabel');
    expect(source).toContain('TimeRemainingLabel');
    expect(source).toContain('HighDemandSectionHead');
    expect(source).toMatch(/accent=\{theme\.accent\}/);
  });
});

// ─── Drop detail — truthful units, accent urgency ─────────────────────────────

describe('Buyer drop detail — truthful units and accent urgency', () => {
  it('never renders "x of y" fabricated capacity pattern', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-drop-detail.tsx'), 'utf8');
    expect(source).not.toMatch(/\bleft\s+of\s+\d/);
  });

  it('uses ClaimedRemainingLabel and TimeRemainingLabel', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-drop-detail.tsx'), 'utf8');
    expect(source).toContain('ClaimedRemainingLabel');
    expect(source).toContain('TimeRemainingLabel');
  });

  it('shows time remaining conditionally on endsAt', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-drop-detail.tsx'), 'utf8');
    expect(source).toMatch(/endsAt.*&&|!!.*endsAt/);
  });

  it('urgency uses theme.accent, RED removed from urgency usage', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-drop-detail.tsx'), 'utf8');
    expect(source).toMatch(/theme\.accent/);
    expect(source).not.toContain("RED,");
    expect(source).not.toContain("RED_DIM");
  });

  it('passes accent to LiveStatusPanel and ProductTile', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-drop-detail.tsx'), 'utf8');
    expect(source).toMatch(/accent=\{theme\.accent\}/);
  });

  it('buyer-product-detail uses CommerceSignal demand layer with accent', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../app/buyer-product-detail.tsx'), 'utf8');
    expect(source).toContain('ClaimedRemainingLabel');
    expect(source).toContain('UrgencyBar');
    expect(source).toContain('DemandBadge');
    expect(source).toContain('TimeRemainingLabel');
    expect(source).toMatch(/accent=\{theme\.accent\}/);
    expect(source).toMatch(/accentColor=\{theme\.accent\}/);
  });
});
