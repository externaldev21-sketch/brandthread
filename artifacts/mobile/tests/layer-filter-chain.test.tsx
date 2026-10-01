/**
 * layer-filter-chain.test.tsx — the ONE shared adjustment-stage builder
 * (components/design-studio/layerFilterChain.tsx) and its use by the
 * read-only compositor (DesignLayerCompositor.renderLayer), which is what
 * gallery thumbnails, preview modals and the mockup preview render.
 *
 * Asserts the stage chain's real structure (primitive type, in/result
 * threading, order, scale) rather than snapshots, so a regression that
 * silently drops a stage from exports fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (s: Record<string, unknown>) => s, absoluteFill: {} },
}));
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  G: 'G', Path: 'Path', Rect: 'Rect', Circle: 'Circle',
  Defs: 'Defs', Mask: 'Mask', Filter: 'Filter', Text: 'SvgText', Image: 'SvgImage',
  FeColorMatrix: 'FeColorMatrix', FeComposite: 'FeComposite', FeGaussianBlur: 'FeGaussianBlur',
  FeOffset: 'FeOffset', FeBlend: 'FeBlend',
}));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('@/lib/theme', () => ({
  BG: '#0d0d0d', CARD: '#1a1a1a', FG: '#ffffff', RADIUS: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
}));
vi.mock('@/services/designTypes', () => ({}));

import { buildAdjustmentStages, safeSvgId } from '../components/design-studio/layerFilterChain';
import { renderLayer, buildAdjustmentsFilter } from '../components/DesignLayerCompositor';
import type { DesignLayer } from '../services/designTypes';
import type { DesignLayerAdjustments } from '../lib/adjustmentsModel';

type AnyEl = React.ReactElement<Record<string, unknown>>;

/** Flatten a stage list (which may contain Fragments) into primitive elements, in document order. */
function flatten(nodes: React.ReactNode): AnyEl[] {
  const out: AnyEl[] = [];
  React.Children.forEach(nodes, n => {
    if (!React.isValidElement(n)) return;
    const el = n as AnyEl;
    if (el.type === React.Fragment) out.push(...flatten(el.props.children as React.ReactNode));
    else out.push(el);
  });
  return out;
}
const types = (nodes: React.ReactNode) => flatten(nodes).map(e => e.type as string);

const HSB: DesignLayerAdjustments = { hsb: { hue: 30, saturation: 0, brightness: 0 } };

describe('buildAdjustmentStages', () => {
  it('identity / absent adjustments produce NO stages (no no-op filter)', () => {
    expect(buildAdjustmentStages(undefined, 1)).toEqual({ stages: [], lastResult: 'SourceGraphic' });
    expect(buildAdjustmentStages({ hsb: { hue: 0, saturation: 0, brightness: 0 }, effects: {} }, 1).stages).toHaveLength(0);
    expect(buildAdjustmentStages({ effects: { gaussianBlur: 0, motionBlur: { amount: 0, angle: 45 } } }, 1).stages).toHaveLength(0);
  });

  it('HSB is one feColorMatrix reading SourceGraphic; lastResult is its result name', () => {
    const r = buildAdjustmentStages(HSB, 1);
    const els = flatten(r.stages);
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe('FeColorMatrix');
    expect(els[0].props.in).toBe('SourceGraphic');
    expect(els[0].props.result).toBe('hsbd');
    expect(r.lastResult).toBe('hsbd');
  });

  it('threads every stage from the previous one, in the fixed order hsb → curves → balance → gradient → gaussian → motion → sharpen → chromatic → bloom', () => {
    const r = buildAdjustmentStages({
      hsb: { hue: 10, saturation: 0, brightness: 0 },
      curves: { gamma: { channel: 'gamma', points: [{ t: 0, v: 0.1 }, { t: 1, v: 1 }] }, red: { channel: 'red', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, green: { channel: 'green', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, blue: { channel: 'blue', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } },
      effects: {
        colorBalance: { cyanRed: 0.2, magentaGreen: 0, yellowBlue: 0 },
        gradientMap: { from: '#000000', to: '#ffffff', mix: 0.5 },
        gaussianBlur: 2, motionBlur: { amount: 4, angle: 0 }, sharpen: 0.5, chromatic: 2, bloom: 0.5,
      },
    }, 1);
    const keys = (r.stages as AnyEl[]).map(s => s.key);
    expect(keys).toEqual(['hsb', 'curves', 'cbal', 'gmap', 'gblur', 'mblur', 'sharp', 'chrom', 'bloom']);
    const resultOf = (k: string) => ({ hsb: 'hsbd', curves: 'curved', cbal: 'cbal', gmap: 'gmap', gblur: 'gblur', mblur: 'mblur', sharp: 'sharp', chrom: 'chrom', bloom: 'bloom' } as Record<string, string>)[k];
    // Each stage's FIRST primitive reads the previous stage's result.
    let prev = 'SourceGraphic';
    for (const stage of r.stages as AnyEl[]) {
      const first = flatten(stage)[0];
      expect(first.props.in).toBe(prev);
      prev = resultOf(String(stage.key));
    }
    expect(r.lastResult).toBe('bloom');
  });

  it('Motion Blur = 7 feOffset taps + 7 arithmetic feComposite averages; Chromatic = 2 feOffset', () => {
    const mb = buildAdjustmentStages({ effects: { motionBlur: { amount: 12, angle: 0 } } }, 1);
    const t = types(mb.stages);
    expect(t.filter(x => x === 'FeOffset')).toHaveLength(7);
    expect(t.filter(x => x === 'FeComposite')).toHaveLength(7);
    const offsets = flatten(mb.stages).filter(e => e.type === 'FeOffset');
    expect(offsets[0].props.dx).toBe(-6);
    expect(offsets[6].props.dx).toBe(6);
    const last = flatten(mb.stages).filter(e => e.type === 'FeComposite').pop()!;
    expect(last.props.result).toBe('mblur');

    const ca = buildAdjustmentStages({ effects: { chromatic: 3 } }, 1);
    expect(types(ca.stages).filter(x => x === 'FeOffset')).toHaveLength(2);
  });

  it('pixel-sized effects scale with xScale so a thumbnail keeps the same relative blur', () => {
    const full = flatten(buildAdjustmentStages({ effects: { gaussianBlur: 8, chromatic: 4 } }, 1).stages);
    const thumb = flatten(buildAdjustmentStages({ effects: { gaussianBlur: 8, chromatic: 4 } }, 0.25).stages);
    expect(full.find(e => e.type === 'FeGaussianBlur')!.props.stdDeviation).toBe(8);
    expect(thumb.find(e => e.type === 'FeGaussianBlur')!.props.stdDeviation).toBe(2);
    expect(full.find(e => e.type === 'FeOffset')!.props.dx).toBe(4);
    expect(thumb.find(e => e.type === 'FeOffset')!.props.dx).toBe(1);
  });

  it('safeSvgId strips everything that is not alphanumeric', () => {
    expect(safeSvgId('layer-1:a.b')).toBe('layer_1_a_b');
  });
});

// ─── Compositor port ──────────────────────────────────────────────────────────

function drawingLayer(adjustments?: DesignLayerAdjustments): DesignLayer {
  return {
    id: 'layer:draw-1', name: 'Drawing', type: 'drawing', visible: true, locked: false, opacity: 1, order: 0,
    transform: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [{ color: '#ff0000', d: 'M0 0 L10 10', width: 4, opacity: 1, tool: 'brush' }] },
    createdAt: '', updatedAt: '',
    ...(adjustments ? { adjustments } : {}),
  } as DesignLayer;
}

describe('DesignLayerCompositor carries the full adjustment chain', () => {
  it('buildAdjustmentsFilter is undefined for an unadjusted layer, and a padded cf_ Filter otherwise', () => {
    expect(buildAdjustmentsFilter('x', undefined, 1)).toBeUndefined();
    expect(buildAdjustmentsFilter('x', { effects: {} }, 1)).toBeUndefined();
    const f = buildAdjustmentsFilter('layer:draw-1', HSB, 1)!;
    expect(f.filterId).toBe('cf_layer_draw_1');
    const defs = f.filterEl as AnyEl;
    expect(defs.type).toBe('Defs');
    const filter = React.Children.only(defs.props.children) as AnyEl;
    expect(filter.type).toBe('Filter');
    expect(filter.props.id).toBe('cf_layer_draw_1');
    // Same padded region as the editor so blur/offset stages bleed instead of clipping.
    expect(filter.props).toMatchObject({ x: '-20%', y: '-20%', width: '140%', height: '140%' });
    expect(types(filter.props.children as React.ReactNode)).toEqual(['FeColorMatrix']);
  });

  it('renderLayer attaches the filter to the content and emits the same primitives the editor would', () => {
    const el = renderLayer(drawingLayer({ hsb: { hue: 30, saturation: 0, brightness: 0 }, effects: { chromatic: 2, gaussianBlur: 4 } }), 1, 1, '#ffffff') as AnyEl;
    const kids = React.Children.toArray(el.props.children as React.ReactNode) as AnyEl[];
    const defs = kids[0];
    expect(defs.type).toBe('Defs');
    const filter = React.Children.only(defs.props.children) as AnyEl;
    const t = types(filter.props.children as React.ReactNode);
    expect(t.filter(x => x === 'FeColorMatrix').length).toBeGreaterThanOrEqual(1 + 3); // hsb + 3 chromatic channel splits
    expect(t.filter(x => x === 'FeOffset')).toHaveLength(2);
    expect(t).toContain('FeGaussianBlur');
    const inner = kids[kids.length - 1];
    expect(inner.props.filter).toBe('url(#cf_layer_draw_1)');
  });

  it('an unadjusted layer renders with no Defs and no filter attribute at all', () => {
    const el = renderLayer(drawingLayer(), 1, 1, '#ffffff') as AnyEl;
    const kids = React.Children.toArray(el.props.children as React.ReactNode) as AnyEl[];
    expect(kids.some(k => k.type === 'Defs')).toBe(false);
    expect(kids[kids.length - 1].props.filter).toBeUndefined();
  });

  it('a thumbnail-scale render (xScale 0.1) scales blur radius by the same factor', () => {
    const el = renderLayer(drawingLayer({ effects: { gaussianBlur: 10 } }), 0.1, 0.1, '#ffffff') as AnyEl;
    const defs = (React.Children.toArray(el.props.children as React.ReactNode) as AnyEl[])[0];
    const filter = React.Children.only(defs.props.children) as AnyEl;
    const blur = flatten(filter.props.children as React.ReactNode).find(e => e.type === 'FeGaussianBlur')!;
    expect(blur.props.stdDeviation).toBeCloseTo(1, 9);
  });
});
