import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dev: the tab bar showed the Dashboard (bar-chart) icon as active while on
 * Messages — every unmapped pushed screen silently fell back to 'index'.
 * Now: a route's fixed owner wins (Messages → Profile); otherwise the tab
 * the user came from; otherwise none. Source-level checks (the component
 * itself needs the whole native tab-bar stack to render).
 */
const src = readFileSync(path.join(process.cwd(), 'components/SellerGlobalTabBar.tsx'), 'utf8');

describe('seller tab bar: active tab = owner, else origin tab, else none', () => {
  it('no silent Dashboard fallback for unmapped routes', () => {
    const fn = src.slice(src.indexOf('export function getActiveTab'), src.indexOf('export function resolveActiveTab'));
    // (`segments[1] ?? 'index'` is just the bare "/(tabs)" route = Dashboard.)
    expect(fn).not.toContain("ROUTE_TO_TAB[second] ?? 'index'");
    expect(fn).not.toContain("ROUTE_TO_TAB[first] ?? 'index'");
    expect(fn).toContain('return ROUTE_TO_TAB[second] ?? null;');
    expect(fn).toContain('return ROUTE_TO_TAB[first] ?? null;');
  });

  it('Messages (inbox and thread) are owned by Profile', () => {
    expect(src).toContain("'seller-inbox': 'profile',");
    expect(src).toContain("'seller-conversation': 'profile',");
  });

  it('an unowned screen inherits the last owned tab; with no history nothing is active', () => {
    expect(src).toContain('return getActiveTab(segments) ?? lastOwnedTab;');
    expect(src).toContain('const lastOwnedTabRef = useRef<string | null>(null);');
    expect(src).toContain('if (ownedTab) lastOwnedTabRef.current = ownedTab;');
    expect(src).toContain('const activeIndex = activeTab ? TABS.findIndex((tabDef) => tabDef.name === activeTab) : -1;');
  });

  it('the AI button context still comes from the route itself, not the inherited tab', () => {
    expect(src).toContain("ownedTab === 'products' ? 'products' :");
    expect(src).toContain("ownedTab === 'orders' ? 'orders' :");
  });
});
