import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const feed = readFileSync(resolve(process.cwd(), 'app/(tabs)/feed.tsx'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'app/(buyer)/_layout.tsx'), 'utf8');

describe('buyer Thread chrome', () => {
  it('uses the cart as the final header action instead of create post', () => {
    const topBar = feed.slice(feed.indexOf('{/* ─ Top bar overlay ─ */}'), feed.indexOf('{/* ─ Feed tab switcher'));
    expect(topBar).toContain('name="shopping-cart"');
    expect(topBar).toContain("router.push('/(buyer)/cart'");
    expect(topBar).not.toContain('name="plus-square"');
    expect(topBar).not.toContain('name="user-plus"');
  });

  it('gives the Profile circle enough room for its icon and full label', () => {
    expect(layout).toContain('width: 68');
    expect(layout).toContain('height: 68');
    expect(layout).toContain('borderRadius: 34');
    expect(layout).toContain('fontSize: 11');
    expect(layout).toContain('lineHeight: 14');
  });
});