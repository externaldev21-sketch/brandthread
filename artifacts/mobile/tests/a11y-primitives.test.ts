import { describe, expect, it } from 'vitest';
import { ICON_LABELS, iconAccessibilityLabel } from '@/lib/a11y/iconLabels';
import {
  BODY_MAX_FONT_MULTIPLIER, DENSE_MAX_FONT_MULTIPLIER, maxFontMultiplierForRole, scaledFontSize,
} from '@/lib/dynamicType';

describe('iconAccessibilityLabel', () => {
  it.each([
    ['arrow-left', 'Back'], ['x', 'Close'], ['heart', 'Like'], ['send', 'Send'], ['more-horizontal', 'More options'],
    ['search', 'Search'], ['plus', 'Add'], ['share', 'Share'], ['share-2', 'Share'], ['shopping-bag', 'Cart'],
  ])('maps %s to %s', (icon, label) => {
    expect(iconAccessibilityLabel(icon)).toBe(label);
  });

  it('prefers an explicit label, ignoring blank ones', () => {
    expect(iconAccessibilityLabel('x', 'Dismiss banner')).toBe('Dismiss banner');
    expect(iconAccessibilityLabel('x', '   ')).toBe('Close');
    expect(iconAccessibilityLabel('x', null)).toBe('Close');
  });

  it('humanizes an unmapped glyph instead of returning nothing', () => {
    expect(iconAccessibilityLabel('arrow-up-right')).toBe('Arrow up right');
  });

  it('never maps to an empty label', () => {
    for (const [icon, label] of Object.entries(ICON_LABELS)) expect(label.trim(), icon).not.toBe('');
  });
});

describe('dynamic type caps', () => {
  it('caps dense roles at 1.3 and body roles at 1.6', () => {
    expect(maxFontMultiplierForRole('headline')).toBe(DENSE_MAX_FONT_MULTIPLIER);
    expect(maxFontMultiplierForRole('caption')).toBe(1.3);
    expect(maxFontMultiplierForRole('body')).toBe(BODY_MAX_FONT_MULTIPLIER);
    expect(maxFontMultiplierForRole(undefined)).toBe(1.6);
  });

  it('is a no-op at the default OS scale', () => {
    expect(scaledFontSize(15, 1, 1.3)).toBe(15);
    expect(scaledFontSize(15, 1, 1.6)).toBe(15);
  });

  it('limits growth at large OS scales and follows smaller ones', () => {
    expect(scaledFontSize(10, 2, 1.3)).toBeCloseTo(13);
    expect(scaledFontSize(10, 1.2, 1.3)).toBeCloseTo(12);
    expect(scaledFontSize(10, 0.85, 1.3)).toBeCloseTo(8.5);
  });

  it('treats an invalid scale as 1', () => {
    expect(scaledFontSize(10, NaN, 1.3)).toBe(10);
    expect(scaledFontSize(10, 0, 1.3)).toBe(10);
  });
});
