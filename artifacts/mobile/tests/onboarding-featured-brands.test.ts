import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const step = readFileSync(path.join(root, 'components/onboarding/BrandsToFollowStep.tsx'), 'utf8');
const service = readFileSync(path.join(root, 'services/discoverService.ts'), 'utf8');

describe("Brands to follow: Dev's brands with their real products (item 54)", () => {
  it('loads the featured brands next to the discover list, and a failure never breaks the step', () => {
    expect(service).toContain("'/api/public/brands/featured'");
    expect(service).toContain('.filter((brand) => brand.productImages?.length > 0)');
    expect(step).toContain('featuredBrands()');
    expect(step).toContain('.catch(() => { /* optional rail');
  });
  it('renders the rail only when there are featured brands', () => {
    expect(step).toContain('{featured.length > 0 && (');
  });
  it("each card is Grailed's: three product photos, name, product count, Follow", () => {
    expect(step).toContain('brand.productImages.slice(0, 3).map(');
    expect(step).toContain("{brand.productCount === 1 ? 'product' : 'products'}");
    expect(step).toContain("label={isFollowing ? 'Following' : 'Follow'}");
    expect(step).toMatch(/featuredPhoto: \{[^}]*aspectRatio: 4 \/ 5/);
  });
  it('a featured brand is not repeated in the grid and joins Follow all', () => {
    expect(step).toContain('const gridBrands = brands.filter((b) => !featuredIds.has(b.sellerId));');
    expect(step).toContain('[...featured, ...gridBrands]');
    expect(step).toContain('{gridBrands.map((brand, i) => {');
  });
});
