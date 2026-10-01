/**
 * design-studio-fonts.test.ts — sanity checks for lib/designStudioFonts.ts's
 * static font list (not the useFonts hook itself, which needs a real RN
 * font-loading environment — see e2e/design-double-tap-edit-text.spec.ts and
 * e2e/design-transform-rotate.spec.ts for real-browser coverage of fonts
 * actually rendering).
 */
import { describe, it, expect } from 'vitest';
import { DESIGN_STUDIO_FONTS, DEFAULT_DESIGN_STUDIO_FONT } from '../lib/designStudioFontsList';

describe('DESIGN_STUDIO_FONTS', () => {
  it('has at least 10 real fonts (Dev asked for 10-15)', () => {
    expect(DESIGN_STUDIO_FONTS.length).toBeGreaterThanOrEqual(10);
  });

  it('has no duplicate family names', () => {
    const families = DESIGN_STUDIO_FONTS.map(f => f.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it('has no duplicate labels', () => {
    const labels = DESIGN_STUDIO_FONTS.map(f => f.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every entry has a non-empty family and label', () => {
    for (const f of DESIGN_STUDIO_FONTS) {
      expect(f.family.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it('includes every font Dev explicitly asked for', () => {
    const labels = DESIGN_STUDIO_FONTS.map(f => f.label);
    const required = [
      'Inter', 'Playfair Display', 'Bebas Neue', 'Anton', 'DM Serif Display',
      'Space Grotesk', 'Archivo Black', 'Oswald', 'Montserrat', 'Poppins',
      'Permanent Marker', 'Caveat',
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it('DEFAULT_DESIGN_STUDIO_FONT is one of the listed families', () => {
    expect(DESIGN_STUDIO_FONTS.map(f => f.family)).toContain(DEFAULT_DESIGN_STUDIO_FONT);
  });
});
