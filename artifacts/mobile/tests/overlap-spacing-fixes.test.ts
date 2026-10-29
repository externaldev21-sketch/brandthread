/**
 * Source guards for the spacing fixes found by scripts/overlap-audit.mjs
 * (docs/overlap-audit.md). The audit itself runs in a browser; these keep
 * the fixes from silently regressing in unit CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const styleBlock = (src: string, key: string) => {
  const start = src.indexOf(`${key}: {`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('}', start));
};

describe('range pill row', () => {
  it('leaves a gap below the glass pill so the next element never touches it', () => {
    expect(styleBlock(read('components/SellerDashboardRangePills.tsx'), 'rangeRow')).toMatch(/marginBottom: SP\.sm/);
  });

  it('only drops that gap where the row ends a chart card', () => {
    expect(read('components/SellerDashboardChart.tsx')).toMatch(/<SellerDashboardRangePills.*style={{ marginBottom: 0 }} \/>/);
    expect(styleBlock(read('components/SellerDashboardHomeRange.tsx'), 'root')).toMatch(/marginBottom: 0/);
  });
});

describe('profile "Professional dashboard" row', () => {
  it.each(['app/seller-profile.tsx'])('%s pads the bordered row so its icon tile clears the rounded edge', (file) => {
    expect(styleBlock(read(file), 'dashboardRow')).toMatch(/paddingHorizontal: SP\.md/);
  });
});

describe('ListRow inside clipped, bordered cards', () => {
  it('marketing Growth card pads its rows off the rounded edge', () => {
    expect(read('app/(tabs)/marketing.tsx')).toMatch(/overflow: 'hidden', paddingHorizontal: SP\.md \}\}>\s*<ListRow icon="link" title="Links"/);
  });

  it('login methods change-email / change-password rows carry side padding', () => {
    const src = read('app/login-methods.tsx');
    expect(styleBlock(src, 'cardRow')).toMatch(/paddingHorizontal: SPACING\.md/);
    expect(src.match(/style=\{s\.cardRow\}/g)?.length).toBe(2);
  });
});

describe('inputs in a row can shrink (web min-width: auto)', () => {
  it('community invite field and input', () => {
    const src = read('app/community-create.tsx');
    expect(styleBlock(src, 'inviteField')).toMatch(/minWidth: 0/);
    expect(styleBlock(src, 'inviteInput')).toMatch(/minWidth: 0/);
  });

  it('RFQ quantity / target price halves', () => {
    expect(styleBlock(read('app/rfq-post.tsx'), 'half')).toMatch(/minWidth: 0/);
  });
});

describe('giveaway rules retry row', () => {
  it('sits below the rules field instead of on it', () => {
    expect(read('app/seller-giveaway-create.tsx')).toMatch(/<RetryRow label="Couldn't load the rules template" style=\{\{ marginTop: SP\.sm \}\}/);
  });
});

describe('more audit fixes', () => {
  it('FormInput text input can shrink beside another input', () => {
    expect(read('components/BrandthreadUI.tsx')).toMatch(/input:\s+\{ flex: 1, minWidth: 0, fontSize: FS\.base/);
  });

  it('store editor leaves a gap under "Add section"', () => {
    expect(styleBlock(read('app/store-editor.tsx'), 'sectionsTopRow')).toMatch(/paddingBottom: SP\.sm/);
  });
});
