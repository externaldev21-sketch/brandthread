/**
 * X-style reframe (Phase 1): the shared tokens hold the agreed values, and
 * the three pilot screens (Activity, Messages, Discover) consume the shared
 * primitives instead of hand-rolled headers, chip rows and empty states.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ StyleSheet: { hairlineWidth: 0.5 } }));
vi.mock('@/lib/theme', () => ({ FONT: { regular: 'r', medium: 'm', semibold: 's', bold: 'b' } }));

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');

describe('constants/reframe tokens', () => {
  it('spacing scale, gutter, avatar column and type scale match the spec', async () => {
    const t = await import('@/constants/reframe');
    expect(Object.values(t.X_SPACE)).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(t.X_GUTTER).toBe(16);
    expect(t.X_AVATAR_GAP).toBe(12);
    expect(t.xTextColumn(40)).toBe(68);
    expect(t.xTextColumn(48)).toBe(76);
    expect(t.X_TYPE.meta.fontSize).toBe(13);
    expect(t.X_TYPE.body.fontSize).toBe(15);
    expect(t.X_TYPE.name).toMatchObject({ fontSize: 15, fontFamily: 'b' });
    expect(t.X_TYPE.section.fontSize).toBe(17);
    expect(t.X_TYPE.title.fontSize).toBe(20);
    expect([t.X_TYPE.heroSm.fontSize, t.X_TYPE.hero.fontSize]).toEqual([28, 34]);
  });

  it('uses X gray/divider on the default theme and the theme’s own muted/border elsewhere', async () => {
    const { xColors, X_GRAY, X_DIVIDER } = await import('@/constants/reframe');
    const base = { text: '#FFFFFF', muted: '#C0C0C0', border: '#C0C0C047', background: '#000000' };
    expect(xColors({ ...base, id: 'monochrome' } as never)).toMatchObject({ secondary: X_GRAY, divider: X_DIVIDER });
    expect(xColors({ ...base, id: 'navy' } as never)).toMatchObject({ secondary: base.muted, divider: base.border });
  });
});

describe('pilot screens consume the reframe primitives', () => {
  it('Activity: reframe header, text tabs, section headers', () => {
    const src = read('app/activity-center.tsx');
    expect(src).toContain("from '@/components/reframe'");
    expect(src).toContain('<SegmentTabs');
    expect(src).toContain('<SectionHeader');
    expect(src).not.toContain("from '@/components/ui/Chip'");
  });

  it('Messages: reframe header + Inbox/Requests text tabs (filter icon kept)', () => {
    const src = read('app/(buyer)/inbox.tsx');
    expect(src).toContain('<ScreenHeader');
    expect(src).toContain('<SegmentTabs');
    expect(src).toContain('testID="inbox-filter-pill"');
    expect(src).not.toContain('TabPageHeader');
  });

  it('Discover: filter row is the shared text tabs', () => {
    expect(read('components/discover/DiscoverFilterRow.tsx')).toContain('<SegmentTabs');
  });
});
