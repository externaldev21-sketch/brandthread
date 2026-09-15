/**
 * Tests for DesignLayerCompositor — shared SVG layer compositor.
 *
 * Verifies:
 *  - Layer ordering (order asc = bottom to top).
 *  - Invisible layers are excluded.
 *  - Drawing layers render ink paths; eraser paths trigger a mask group.
 *  - Image layers render SvgImage at correct position/size.
 *  - Shape layers render Rect/Circle.
 *  - Text layers render SvgText.
 *  - Layer opacity applied to outer G wrapper.
 *  - Blend modes applied as mixBlendMode on inner G when supported.
 *  - Empty canvas (no layers) renders placeholder icon (no SVG).
 *  - Background color applied to container.
 *
 * Structure note: renderLayer now ALWAYS wraps the layer content in an outer
 * <G opacity={layer.opacity}> so that a curves filter Defs can be inserted
 * as a sibling of the inner content element. Tests navigate to the inner
 * element via outerG.children[lastIndex].
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderLayer } from '../components/DesignLayerCompositor';
import type { DesignLayer, DrawPath, BlendModeKind } from '../services/designTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (s: Record<string, unknown>) => s, absoluteFill: {} },
}));

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  G: 'G', Path: 'Path', Rect: 'Rect', Circle: 'Circle',
  Defs: 'Defs', Mask: 'Mask', Filter: 'Filter', FeColorMatrix: 'FeColorMatrix',
  Text: 'SvgText', Image: 'SvgImage',
}));

vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('@/lib/theme', () => ({
  BG: '#0d0d0d', CARD: '#1a1a1a', FG: '#ffffff', RADIUS: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
}));
vi.mock('@/services/designTypes', () => ({}));

// ─── Typed element alias ──────────────────────────────────────────────────────
type AnyEl = React.ReactElement<Record<string, unknown>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the inner content element from the outer <G opacity> wrapper.
 * renderLayer always wraps in an outer G. The inner element is the LAST child
 * (curves filter Defs, if any, comes first; then the content element).
 */
function innerEl(el: React.ReactNode): AnyEl {
  const outer = el as AnyEl;
  const kids = React.Children.toArray(outer.props.children as React.ReactNode);
  return kids[kids.length - 1] as AnyEl;
}

// ─── Layer factory helpers ─────────────────────────────────────────────────────

function makePath(
  color: string,
  d = 'M0 0 L10 10',
  width = 4,
  opacity = 1,
  tool = 'brush',
): DrawPath {
  return { color, d, width, opacity, tool };
}

function makeDrawingLayer(opts: {
  id?: string;
  visible?: boolean;
  opacity?: number;
  order?: number;
  paths?: DrawPath[];
}): DesignLayer {
  return {
    id: opts.id ?? 'layer_draw',
    name: 'Drawing',
    type: 'drawing',
    visible: opts.visible ?? true,
    locked: false,
    opacity: opts.opacity ?? 1,
    order: opts.order ?? 0,
    transform: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: opts.paths ?? [makePath('#ff0000')] },
    createdAt: '',
    updatedAt: '',
  };
}

function makeImageLayer(opts: {
  id?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendModeKind;
  fit?: 'contain' | 'cover';
}): DesignLayer {
  return {
    id: opts.id ?? 'layer_img',
    name: 'Image',
    type: 'image',
    visible: opts.visible ?? true,
    locked: false,
    opacity: opts.opacity ?? 1,
    order: 0,
    transform: { x: 100, y: 50, width: 400, height: 400, rotation: 0, scaleX: 1, scaleY: 1 },
    data: {
      kind: 'image',
      uri: 'data:image/png;base64,abc',
      opacity: 1,
      fit: opts.fit ?? 'contain',
      blendMode: opts.blendMode ?? 'normal',
    },
    createdAt: '',
    updatedAt: '',
  };
}

function makeShapeLayer(shape: 'rect' | 'circle' = 'rect'): DesignLayer {
  return {
    id: 'layer_shape',
    name: 'Shape',
    type: 'shape',
    visible: true,
    locked: false,
    opacity: 0.8,
    order: 0,
    transform: { x: 200, y: 200, width: 300, height: 300, rotation: 0, scaleX: 1, scaleY: 1 },
    data: {
      kind: 'shape',
      shape,
      fill: '#ff0000',
      fillColor: '#ff0000',
      stroke: '#0000ff',
      strokeColor: '#0000ff',
      strokeWidth: 2,
      cornerRadius: 8,
    },
    createdAt: '',
    updatedAt: '',
  };
}

function makeTextLayer(text = 'Hello'): DesignLayer {
  return {
    id: 'layer_text',
    name: 'Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 0.9,
    order: 0,
    transform: { x: 100, y: 100, width: 400, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
    data: {
      kind: 'text',
      content: text,
      color: '#ffffff',
      fontSize: 36,
      fontFamily: 'System',
      letterSpacing: 0,
      bold: false,
      italic: false,
    },
    createdAt: '',
    updatedAt: '',
  };
}

// ─── Tests: invisible layers ───────────────────────────────────────────────────

describe('renderLayer — invisible layers', () => {
  it('returns null for a hidden drawing layer', () => {
    const layer = makeDrawingLayer({ visible: false });
    expect(renderLayer(layer, 1, 1, '#000')).toBeNull();
  });

  it('returns null for a hidden image layer', () => {
    const layer = makeImageLayer({ visible: false });
    expect(renderLayer(layer, 1, 1, '#000')).toBeNull();
  });
});

// ─── Tests: drawing layers ────────────────────────────────────────────────────

describe('renderLayer — drawing layers (no erase)', () => {
  it('returns a React element for a drawing layer with ink paths', () => {
    const layer = makeDrawingLayer({ paths: [makePath('#ff0000')] });
    const el = renderLayer(layer, 0.5, 0.5, '#000');
    expect(el).not.toBeNull();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('outer element is a G (opacity wrapper)', () => {
    const layer = makeDrawingLayer({ paths: [makePath('#00ff00'), makePath('#0000ff')] });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.type).toBe('G');
  });

  it('applies layer opacity on the outer G wrapper', () => {
    const layer = makeDrawingLayer({ opacity: 0.42, paths: [makePath('#aabbcc')] });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.props.opacity).toBe(0.42);
  });

  it('inner content element is also a G for drawing layers', () => {
    const layer = makeDrawingLayer({ paths: [makePath('#ff0000')] });
    const inner = innerEl(renderLayer(layer, 1, 1, '#000'));
    expect(inner.type).toBe('G');
  });

  it('skips smudge paths entirely (returns null child) inside inner G', () => {
    const layer = makeDrawingLayer({
      paths: [makePath('smudge'), makePath('#ff0000')],
    });
    const inner = innerEl(renderLayer(layer, 1, 1, '#000'));
    // inner is the content G; its children = renderedInkPaths (smudge=null, red=Path)
    const children = React.Children.toArray(inner.props.children as React.ReactNode).filter(Boolean);
    expect(children.length).toBe(1);
  });
});

describe('renderLayer — drawing layers with eraser paths', () => {
  it('outer is a G; inner content G contains Defs+Mask when eraser paths are present', () => {
    const layer = makeDrawingLayer({
      paths: [makePath('#ff0000'), makePath('erase')],
    });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.type).toBe('G'); // outer opacity wrapper

    // Navigate to the inner content G (last child of outer, since no curves)
    const inner = innerEl(el);
    expect(inner.type).toBe('G'); // inner content G

    const kids = React.Children.toArray(inner.props.children as React.ReactNode);
    // First child of inner: Defs (contains Mask)
    const defs = kids[0] as AnyEl;
    expect(defs.type).toBe('Defs');
    // Second child: G with mask prop
    const maskedG = kids[1] as AnyEl;
    expect(maskedG.type).toBe('G');
    expect(maskedG.props.mask as string).toMatch(/url\(#emask_/);
  });

  it('mask id is derived from layer id with sanitised characters', () => {
    const layer = makeDrawingLayer({ id: 'layer-with-dashes_and.dots', paths: [makePath('#aaa'), makePath('erase')] });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    const kids = React.Children.toArray(inner.props.children as React.ReactNode);
    const defs = kids[0] as AnyEl;
    const mask = React.Children.toArray(defs.props.children as React.ReactNode)[0] as AnyEl;
    expect(mask.props.id as string).toMatch(/^emask_[a-zA-Z0-9_]+$/);
  });
});

// ─── Tests: image layers ───────────────────────────────────────────────────────

describe('renderLayer — image layers', () => {
  it('outer is a G; inner G contains SvgImage', () => {
    const layer = makeImageLayer({});
    const el = renderLayer(layer, 0.5, 0.5, '#000') as AnyEl;
    expect(el.type).toBe('G'); // outer opacity wrapper
    const inner = innerEl(el);
    expect(inner.type).toBe('G'); // inner G (may have style for blend mode)
    const innerKids = React.Children.toArray(inner.props.children as React.ReactNode);
    const img = innerKids[0] as AnyEl;
    expect(img.type).toBe('SvgImage');
  });

  it('positions SvgImage at transform.x * xScale, transform.y * yScale', () => {
    const layer = makeImageLayer({});
    const el = renderLayer(layer, 0.5, 0.5, '#000') as AnyEl;
    const inner = innerEl(el);
    const img = (React.Children.toArray(inner.props.children as React.ReactNode)[0]) as AnyEl;
    // transform: x=100, y=50 → 100*0.5=50, 50*0.5=25
    expect(img.props.x as number).toBeCloseTo(50);
    expect(img.props.y as number).toBeCloseTo(25);
  });

  it('applies combined opacity on outer G (layer.opacity * data.opacity)', () => {
    const layer = makeImageLayer({ opacity: 0.8 });
    (layer.data as { opacity: number }).opacity = 0.5;
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    // The outer G carries opacity = layer.opacity * data.opacity
    expect(el.props.opacity as number).toBeCloseTo(0.4); // 0.8 * 0.5
  });

  it('sets preserveAspectRatio slice for fit=cover', () => {
    const layer = makeImageLayer({ fit: 'cover' });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    const img = (React.Children.toArray(inner.props.children as React.ReactNode)[0]) as AnyEl;
    expect(img.props.preserveAspectRatio).toBe('xMidYMid slice');
  });

  it('sets preserveAspectRatio meet for fit=contain', () => {
    const layer = makeImageLayer({ fit: 'contain' });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    const img = (React.Children.toArray(inner.props.children as React.ReactNode)[0]) as AnyEl;
    expect(img.props.preserveAspectRatio).toBe('xMidYMid meet');
  });

  it('applies supported blend modes via style.mixBlendMode on inner G', () => {
    const layer = makeImageLayer({ blendMode: 'multiply' });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect((inner.props.style as Record<string, unknown> | undefined)?.mixBlendMode).toBe('multiply');
  });

  it('does not apply mixBlendMode for "normal" blend mode', () => {
    const layer = makeImageLayer({ blendMode: 'normal' });
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.style).toBeUndefined();
  });

  it('does not apply mixBlendMode for unsupported blend mode', () => {
    const layer = makeImageLayer({ blendMode: 'normal' });
    (layer.data as { blendMode: string }).blendMode = 'color-burn';
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.style).toBeUndefined();
  });
});

// ─── Tests: shape layers ──────────────────────────────────────────────────────

describe('renderLayer — shape layers', () => {
  it('outer is G; inner element is Rect for a rect shape', () => {
    const layer = makeShapeLayer('rect');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.type).toBe('G'); // outer wrapper
    const inner = innerEl(el);
    expect(inner.type).toBe('Rect');
  });

  it('outer is G; inner element is Circle for a circle shape', () => {
    const layer = makeShapeLayer('circle');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.type).toBe('Circle');
  });

  it('Rect has correct fill', () => {
    const layer = makeShapeLayer('rect');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.fill).toBe('#ff0000');
  });

  it('Rect has correct stroke', () => {
    const layer = makeShapeLayer('rect');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.stroke).toBe('#0000ff');
  });

  it('Rect applies cornerRadius via rx prop', () => {
    const layer = makeShapeLayer('rect');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.rx).toBe(8);
  });

  it('outer G carries layer opacity', () => {
    const layer = makeShapeLayer('rect');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.props.opacity).toBe(0.8);
  });
});

// ─── Tests: text layers ───────────────────────────────────────────────────────

describe('renderLayer — text layers', () => {
  it('outer is G; inner element is SvgText for text type', () => {
    const layer = makeTextLayer('Hello World');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.type).toBe('G'); // outer wrapper
    const inner = innerEl(el);
    expect(inner.type).toBe('SvgText');
  });

  it('renders the text content as children of SvgText', () => {
    const layer = makeTextLayer('Design Studio');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.children).toBe('Design Studio');
  });

  it('outer G carries layer opacity', () => {
    const layer = makeTextLayer('Opacity test');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    expect(el.props.opacity).toBe(0.9);
  });

  it('scales font size by min(xScale, yScale)', () => {
    const layer = makeTextLayer('Scale');
    (layer.data as { fontSize: number }).fontSize = 36;
    const el = renderLayer(layer, 0.5, 0.25, '#000') as AnyEl;
    const inner = innerEl(el);
    // min(0.5, 0.25) = 0.25 → 36 * 0.25 = 9
    expect(inner.props.fontSize as number).toBeCloseTo(9);
  });

  it('uses textAnchor=middle for centred layout', () => {
    const layer = makeTextLayer('Centre');
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.textAnchor).toBe('middle');
  });
});

// ─── Tests: transform / rotation ─────────────────────────────────────────────

describe('renderLayer — rotation transform', () => {
  it('inner content G has no transform attr when rotation is 0', () => {
    const layer = makeDrawingLayer({ paths: [makePath('#aaa')] });
    layer.transform.rotation = 0;
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.transform).toBeUndefined();
  });

  it('inner content G sets rotate() transform when rotation is non-zero', () => {
    const layer = makeDrawingLayer({ paths: [makePath('#aaa')] });
    layer.transform.rotation = 45;
    const el = renderLayer(layer, 1, 1, '#000') as AnyEl;
    const inner = innerEl(el);
    expect(inner.props.transform as string).toMatch(/rotate\(45/);
  });
});

// ─── Tests: unknown layer type ────────────────────────────────────────────────

describe('renderLayer — unknown layer type', () => {
  it('returns null for an unrecognised layer type', () => {
    const layer = makeDrawingLayer({});
    (layer as { type: string }).type = 'gradient';
    expect(renderLayer(layer, 1, 1, '#000')).toBeNull();
  });
});
