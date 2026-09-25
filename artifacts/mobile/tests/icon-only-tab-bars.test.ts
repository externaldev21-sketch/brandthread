import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const buyer = read('components/buyer-nav/BuyerTabBar.tsx');
const seller = read('components/SellerGlobalTabBar.tsx');

describe('icon-only bottom navigation', () => {
  it('keeps buyer icons, selected state, accessible names, and glass without visual tab labels', () => {
    expect(buyer).toContain('accessibilityLabel={label}');
    expect(buyer).toContain('focused={focused}');
    expect(buyer).toContain("accessibilityLabel={searchActive ? 'Close search' : 'Profile tab'}");
    expect(buyer).toMatch(/<BuyerNavIcon\s+name=\{item\.icon\}/);
    expect(buyer).toContain('<TabBarGlass theme={theme}');
    expect(buyer).not.toContain('{item.label}\n');
    expect(buyer).not.toContain('{circleLabel}');
  });

  it('keeps seller icons, selected state, accessible names, and tinted bar without visual tab labels', () => {
    expect(seller).toContain('accessibilityLabel="Open Studio tools"');
    expect(seller).toContain('accessibilityLabel="Open Brandthread AI"');
    expect(seller).toContain('`${tabDef.label} tab`');
    expect(seller).toContain('focused={isFocused}');
    expect(seller).toContain('<TabBarIndicator activeIndex={activeIndex}');
    expect(seller).toContain('<TabBarGlass theme={theme}');
    expect(seller).not.toContain('{tabDef.label}\n');
    expect(seller).not.toContain('styles.sideLabel');
  });
});