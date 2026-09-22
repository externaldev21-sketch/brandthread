import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'app/(buyer)/_layout.tsx'), 'utf8');

describe('buyer bottom navigation layout', () => {
  it('uses the compact five-action Thread navigation', () => {
    expect(layout).toContain("{ name: 'index', label: 'Thread', icon: 'home' }");
    expect(layout).toContain("{ name: 'search', label: 'Search', icon: 'search' }");
    expect(layout).toContain("{ name: 'inbox', label: 'Inbox', icon: 'bell' }");
    expect(layout).toContain("{ name: 'profile', label: 'Profile', icon: 'profile' }");
    expect(layout).toContain('testID="buyer-tab-create"');
    expect(layout).toContain("router.push('/create-post?accountType=buyer' as never)");
  });

  it('uses a solid black bar with a prominent white create button', () => {
    expect(layout).toContain("backgroundColor: '#050505'");
    expect(layout).toContain("backgroundColor: '#FFFFFF'");
    expect(layout).not.toContain('buyerBarStyles.centerBar');
    expect(layout).not.toContain('buyerBarStyles.tabLabel');
    expect(layout).toContain('<NavIcon name={item.icon} color={color} focused={focused} />');
    expect(layout).toContain("from 'react-native-svg'");
  });
});