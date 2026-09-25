import { describe, it, expect } from 'vitest';
import {
  rgbToHsv, hsvToRgb, parseHex, rgbToHex, isValidHex, hsvToHex, hexToHsv,
  discPointToHs, hsToDiscPoint,
  pushRecentColor, addColorToPalette, removeColorFromPalette, createPalette,
  relativeLuminance, contrastingBW,
  BrandPalette,
} from '../lib/colorModel';

describe('RGB <-> HSV round-trip', () => {
  const cases: { rgb: { r: number; g: number; b: number }; hsv: { h: number; s: number; v: number } }[] = [
    { rgb: { r: 255, g: 0, b: 0 }, hsv: { h: 0, s: 1, v: 1 } },
    { rgb: { r: 0, g: 255, b: 0 }, hsv: { h: 120, s: 1, v: 1 } },
    { rgb: { r: 0, g: 0, b: 255 }, hsv: { h: 240, s: 1, v: 1 } },
    { rgb: { r: 0, g: 0, b: 0 }, hsv: { h: 0, s: 0, v: 0 } },
    { rgb: { r: 255, g: 255, b: 255 }, hsv: { h: 0, s: 0, v: 1 } },
  ];

  it('converts known primary colors correctly', () => {
    for (const { rgb, hsv } of cases) {
      const got = rgbToHsv(rgb);
      expect(got.h).toBeCloseTo(hsv.h, 1);
      expect(got.s).toBeCloseTo(hsv.s, 5);
      expect(got.v).toBeCloseTo(hsv.v, 5);
    }
  });

  it('round-trips rgb -> hsv -> rgb for arbitrary colors', () => {
    const samples = [
      { r: 34, g: 139, b: 230 }, { r: 200, g: 50, b: 75 }, { r: 12, g: 200, b: 12 }, { r: 128, g: 128, b: 128 },
    ];
    for (const rgb of samples) {
      const back = hsvToRgb(rgbToHsv(rgb));
      expect(back.r).toBeCloseTo(rgb.r, 0);
      expect(back.g).toBeCloseTo(rgb.g, 0);
      expect(back.b).toBeCloseTo(rgb.b, 0);
    }
  });
});

describe('hex parsing / formatting', () => {
  it('parses 6-digit and 3-digit hex, with or without #', () => {
    expect(parseHex('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#F00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('rejects invalid hex strings', () => {
    expect(parseHex('not-a-color')).toBeNull();
    expect(parseHex('#GGGGGG')).toBeNull();
    expect(parseHex('#1234')).toBeNull();
    expect(isValidHex('#ZZZZZZ')).toBe(false);
    expect(isValidHex('#ABCDEF')).toBe(true);
  });

  it('rgbToHex formats uppercase, zero-padded, clamped', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
    expect(rgbToHex({ r: -10, g: 300, b: 5.6 })).toBe('#00FF06');
  });

  it('hsvToHex / hexToHsv round-trip', () => {
    const hsv = { h: 200, s: 0.6, v: 0.8 };
    const hex = hsvToHex(hsv);
    const back = hexToHsv(hex)!;
    expect(back.h).toBeCloseTo(hsv.h, -0.5);
    expect(back.s).toBeCloseTo(hsv.s, 1);
    expect(back.v).toBeCloseTo(hsv.v, 1);
  });

  it('hexToHsv returns null for invalid input', () => {
    expect(hexToHsv('nope')).toBeNull();
  });
});

describe('disc picker geometry', () => {
  it('center of the disc is s=0', () => {
    const { s } = discPointToHs({ x: 0, y: 0 });
    expect(s).toBe(0);
  });

  it('edge of the disc is s=1', () => {
    const { s } = discPointToHs({ x: 1, y: 0 });
    expect(s).toBeCloseTo(1, 5);
  });

  it('right edge (x=1,y=0) is hue 0', () => {
    const { h } = discPointToHs({ x: 1, y: 0 });
    expect(h).toBeCloseTo(0, 1);
  });

  it('hsToDiscPoint / discPointToHs round-trip', () => {
    const cases = [{ h: 0, s: 1 }, { h: 90, s: 0.5 }, { h: 180, s: 0.25 }, { h: 270, s: 0.9 }];
    for (const { h, s } of cases) {
      const pt = hsToDiscPoint(h, s);
      const back = discPointToHs(pt);
      expect(back.h).toBeCloseTo(h, 1);
      expect(back.s).toBeCloseTo(s, 5);
    }
  });

  it('saturation is clamped to [0,1] even for out-of-range points', () => {
    const { s } = discPointToHs({ x: 3, y: 4 }); // distance 5
    expect(s).toBe(1);
  });
});

describe('recent colors', () => {
  it('adds a new color to the front', () => {
    const recents = pushRecentColor([], '#ff0000');
    expect(recents).toEqual(['#FF0000']);
  });

  it('de-dupes case-insensitively and moves to front', () => {
    const recents = pushRecentColor(['#00FF00', '#FF0000'], '#ff0000');
    expect(recents).toEqual(['#FF0000', '#00FF00']);
  });

  it('caps at MAX_RECENT_COLORS (20)', () => {
    let recents: string[] = [];
    for (let i = 0; i < 25; i++) {
      recents = pushRecentColor(recents, `#${i.toString(16).padStart(6, '0')}`);
    }
    expect(recents.length).toBe(20);
    // most recent (24) should be first
    expect(recents[0]).toBe('#000018');
  });
});

describe('brand palettes', () => {
  function makePalettes(): BrandPalette[] {
    return [{ id: 'p1', name: 'Core', colors: ['#111111'] }];
  }

  it('createPalette appends a new empty palette', () => {
    const next = createPalette(makePalettes(), 'Streetwear');
    expect(next.length).toBe(2);
    expect(next[1].name).toBe('Streetwear');
    expect(next[1].colors).toEqual([]);
  });

  it('addColorToPalette adds and de-dupes', () => {
    let palettes = makePalettes();
    palettes = addColorToPalette(palettes, 'p1', '#222222');
    expect(palettes[0].colors).toEqual(['#111111', '#222222']);
    palettes = addColorToPalette(palettes, 'p1', '#222222');
    expect(palettes[0].colors).toEqual(['#111111', '#222222']); // no dupe
  });

  it('removeColorFromPalette removes a color', () => {
    let palettes = makePalettes();
    palettes = removeColorFromPalette(palettes, 'p1', '#111111');
    expect(palettes[0].colors).toEqual([]);
  });

  it('leaves other palettes untouched', () => {
    const palettes: BrandPalette[] = [
      { id: 'a', name: 'A', colors: ['#111111'] },
      { id: 'b', name: 'B', colors: ['#222222'] },
    ];
    const next = addColorToPalette(palettes, 'a', '#333333');
    expect(next[1]).toBe(palettes[1]); // untouched reference
  });
});

describe('contrast helpers', () => {
  it('relativeLuminance: white > black', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeGreaterThan(
      relativeLuminance({ r: 0, g: 0, b: 0 }),
    );
  });

  it('contrastingBW picks black text on white bg and white text on black bg', () => {
    expect(contrastingBW('#FFFFFF')).toBe('#000000');
    expect(contrastingBW('#000000')).toBe('#FFFFFF');
  });

  it('contrastingBW falls back to black for invalid hex', () => {
    expect(contrastingBW('nope')).toBe('#000000');
  });
});
