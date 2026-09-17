/**
 * Mobile contract tests for TextOverlay model and helpers.
 * Validates the normalised position model, overlay CRUD helpers,
 * and the typed defaults used by the text editor.
 */
import { describe, expect, it } from 'vitest';
import {
  createTextOverlay,
  clampOverlayPosition,
  type TextOverlay,
} from './videoEditing';

describe('TextOverlay model', () => {
  it('creates overlay with sensible defaults', () => {
    const ov = createTextOverlay({ id: 'test1', text: 'Hello' });
    expect(ov.id).toBe('test1');
    expect(ov.text).toBe('Hello');
    expect(ov.x).toBe(0.5);
    expect(ov.y).toBe(0.4);
    expect(ov.color).toBe('#ffffff');
    expect(ov.fontStyle).toBe('classic');
    expect(ov.align).toBe('center');
    expect(ov.bgStyle).toBe('none');
    expect(ov.fontSize).toBe(28);
    expect(ov.startTime).toBeUndefined();
    expect(ov.endTime).toBeUndefined();
  });

  it('allows partial override of defaults', () => {
    const ov = createTextOverlay({
      id: 'test2', text: 'Brand',
      x: 0.2, y: 0.8, color: '#ff3333',
      fontStyle: 'retro', align: 'right', bgStyle: 'solid', fontSize: 40,
    });
    expect(ov.x).toBe(0.2);
    expect(ov.y).toBe(0.8);
    expect(ov.color).toBe('#ff3333');
    expect(ov.fontStyle).toBe('retro');
    expect(ov.align).toBe('right');
    expect(ov.bgStyle).toBe('solid');
    expect(ov.fontSize).toBe(40);
  });

  it('accepts timing properties', () => {
    const ov = createTextOverlay({
      id: 'timed', text: 'Flash',
      startTime: 1.5, endTime: 4.0,
    });
    expect(ov.startTime).toBe(1.5);
    expect(ov.endTime).toBe(4.0);
  });
});

describe('clampOverlayPosition', () => {
  it('clamps values below 0 to 0', () => {
    expect(clampOverlayPosition(-0.5)).toBe(0);
    expect(clampOverlayPosition(-100)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clampOverlayPosition(1.5)).toBe(1);
    expect(clampOverlayPosition(99)).toBe(1);
  });

  it('passes through values in range', () => {
    expect(clampOverlayPosition(0)).toBe(0);
    expect(clampOverlayPosition(0.5)).toBe(0.5);
    expect(clampOverlayPosition(1)).toBe(1);
  });
});

describe('TextOverlay type shape', () => {
  it('overlay id is required and string', () => {
    const ov: TextOverlay = createTextOverlay({ id: 'x', text: 'y' });
    expect(typeof ov.id).toBe('string');
  });

  it('overlay positions are normalised 0–1', () => {
    const ov = createTextOverlay({ id: 'pos', text: 'test', x: 0.3, y: 0.7 });
    expect(ov.x).toBeGreaterThanOrEqual(0);
    expect(ov.x).toBeLessThanOrEqual(1);
    expect(ov.y).toBeGreaterThanOrEqual(0);
    expect(ov.y).toBeLessThanOrEqual(1);
  });

  it('supports all font style variants', () => {
    const styles = ['classic', 'elegance', 'retro', 'vintage', 'postcard', 'script', 'technic'] as const;
    styles.forEach((fs) => {
      const ov = createTextOverlay({ id: fs, text: 'x', fontStyle: fs });
      expect(ov.fontStyle).toBe(fs);
    });
  });

  it('supports all align variants', () => {
    (['left', 'center', 'right'] as const).forEach((a) => {
      const ov = createTextOverlay({ id: a, text: 'x', align: a });
      expect(ov.align).toBe(a);
    });
  });

  it('supports all bgStyle variants', () => {
    (['none', 'solid', 'semi'] as const).forEach((bg) => {
      const ov = createTextOverlay({ id: bg, text: 'x', bgStyle: bg });
      expect(ov.bgStyle).toBe(bg);
    });
  });
});

describe('composeVideo payload shape', () => {
  it('constructs a valid overlays array for the API', () => {
    const overlays: TextOverlay[] = [
      createTextOverlay({ id: 'a', text: 'Hello', x: 0.5, y: 0.3 }),
      createTextOverlay({ id: 'b', text: 'World', x: 0.2, y: 0.7, color: '#ff0000' }),
    ];
    const payload = overlays.map(ov => ({
      id: ov.id,
      text: ov.text,
      x: ov.x,
      y: ov.y,
      color: ov.color,
      fontStyle: ov.fontStyle,
      align: ov.align,
      bgStyle: ov.bgStyle,
      fontSize: ov.fontSize,
      startTime: ov.startTime,
      endTime: ov.endTime,
    }));
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      id: 'a', text: 'Hello', x: 0.5, y: 0.3,
      color: '#ffffff', fontStyle: 'classic', align: 'center',
      bgStyle: 'none', fontSize: 28,
    });
    expect(payload[1].color).toBe('#ff0000');
  });
});
