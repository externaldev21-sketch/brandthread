/**
 * DesignLayerCompositor — shared SVG layer compositor
 *
 * Renders a DesignProject's canvas into an SVG at an arbitrary display size.
 * Used by both the gallery thumbnail (design.tsx) and any other surface that
 * needs a read-only flattened view of a canvas (preview modals, export previews).
 *
 * Composition semantics match design-canvas.tsx's renderLayerInSvg exactly
 * because both now import from lib/layerRenderer.ts.
 *
 * Curves adjustment: applied via SVG feColorMatrix type="matrix" using the
 * shared curvesToColorMatrixString helper.  All four channels (gamma, red,
 * green, blue) produce real channel-specific colour effects visible in both
 * editor and gallery.
 *
 * Liquify displacement: applied as an additional translate from netLiquifyDisplacement,
 * factoring in momentum.  Values come from layer.adjustments.liquify or
 * layer.transform.liquifyDx/Dy (whichever is set).
 *
 * Distort/Warp: applied via layer.transform.affineSvgMatrix through buildLayerTransform.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  G, Path, Rect, Circle, Defs, Mask as SvgMask, Text as SvgText,
  Image as SvgImage, Filter, FeColorMatrix,
} from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, FG, RADIUS,
} from '@/lib/theme';
import type {
  DesignProject, DesignLayer,
  DesignDrawingLayer, DesignImageLayer, DesignShapeLayer, DesignTextLayer,
  BlendModeKind,
} from '@/services/designTypes';
import { buildLayerTransform, curvesToColorMatrixString, isIdentityCurves } from '@/lib/layerRenderer';
import type { CurvesAdjustment } from '@/lib/adjustmentsModel';

// ─── Supported blend modes in react-native-svg ────────────────────────────────

const RN_SVG_BLEND_MODES = new Set<string>([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
]);

function blendModeStyle(bm: BlendModeKind | string | undefined): object | undefined {
  if (!bm || bm === 'normal' || !RN_SVG_BLEND_MODES.has(bm)) return undefined;
  return { mixBlendMode: bm };
}

// ─── Curves filter element ────────────────────────────────────────────────────

/**
 * Render a <Defs><Filter><FeColorMatrix …></Filter></Defs> element for the
 * given curves adjustment.  Returns [filterId, defsElement].
 *
 * Uses feColorMatrix type="matrix" with the 20-value matrix from
 * curvesToColorMatrixString.  This is supported in react-native-svg ≥ 13 /
 * Expo SDK ≥ 50.
 *
 * Falls back gracefully: if the adjustment is identity we return undefined so
 * no filter element is emitted and the layer renders at full speed.
 */
function buildCurvesFilter(
  layerId: string,
  adj: CurvesAdjustment,
): { filterId: string; filterEl: React.ReactNode } | undefined {
  if (isIdentityCurves(adj)) return undefined;
  const filterId = `cf_${layerId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const matrixValues = curvesToColorMatrixString(adj);
  const filterEl = (
    <Defs key={`defs_${filterId}`}>
      <Filter id={filterId} x="0%" y="0%" width="100%" height="100%">
        <FeColorMatrix type="matrix" values={matrixValues} />
      </Filter>
    </Defs>
  );
  return { filterId, filterEl };
}

// ─── Layer renderer (pure function, matches design-canvas renderLayerInSvg) ───

/**
 * Render a single layer into SVG elements.
 *
 * @param layer    The layer to render.
 * @param xScale   Logical-to-display scale on the X axis  (displayW / canvasW).
 * @param yScale   Logical-to-display scale on the Y axis  (displayH / canvasH).
 * @param bgHex    Canvas background colour (used as fallback fill).
 */
export function renderLayer(
  layer: DesignLayer,
  xScale: number,
  yScale: number,
  bgHex: string,
): React.ReactNode {
  if (!layer.visible) return null;

  const t = layer.transform;

  // Stable transform: affine → liquify → rotation → flip (via shared helper)
  const transformAttr = buildLayerTransform(t, xScale, yScale);

  // Curves adjustment filter (feColorMatrix)
  const curvesAdj = layer.adjustments?.curves;
  const curvesFilter = curvesAdj ? buildCurvesFilter(layer.id, curvesAdj) : undefined;
  const filterRef: string | undefined = curvesFilter ? `url(#${curvesFilter.filterId})` : undefined;

  // ── Drawing layer ──────────────────────────────────────────────────────────
  if (layer.type === 'drawing') {
    const d = layer.data as DesignDrawingLayer;
    const scaledStroke = (w: number) => w * Math.min(xScale, yScale);

    const inkPaths   = d.paths.filter(p => p.color !== 'erase');
    const erasePaths = d.paths.filter(p => p.color === 'erase');
    const hasErase   = erasePaths.length > 0;

    const maskId = `emask_${layer.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const LARGE  = 99999;

    const renderedInkPaths = inkPaths.map((p, pi) => {
      if (p.color === 'smudge') return null;
      return (
        <Path
          key={pi}
          d={p.d}
          stroke={p.color}
          strokeWidth={scaledStroke(p.width)}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={p.opacity}
        />
      );
    });

    const innerContent = !hasErase ? (
      <G transform={transformAttr} filter={filterRef}>
        {renderedInkPaths}
      </G>
    ) : (
      <G transform={transformAttr} filter={filterRef}>
        <Defs>
          <SvgMask id={maskId} x={0} y={0} width="100%" height="100%">
            <Rect x={-LARGE / 2} y={-LARGE / 2} width={LARGE} height={LARGE} fill="white" />
            {erasePaths.map((p, pi) => (
              <Path
                key={`e${pi}`}
                d={p.d}
                stroke="black"
                strokeWidth={scaledStroke(p.width)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </SvgMask>
        </Defs>
        <G mask={`url(#${maskId})`}>
          {renderedInkPaths}
        </G>
      </G>
    );

    return (
      <G key={layer.id} opacity={layer.opacity}>
        {curvesFilter?.filterEl}
        {innerContent}
      </G>
    );
  }

  // ── Image layer ────────────────────────────────────────────────────────────
  if (layer.type === 'image') {
    const d  = layer.data as DesignImageLayer;
    const bm = blendModeStyle(d.blendMode);
    return (
      <G key={layer.id} opacity={layer.opacity * (d.opacity ?? 1)}>
        {curvesFilter?.filterEl}
        <G transform={transformAttr} filter={filterRef} {...(bm ? { style: bm } : {})}>
          <SvgImage
            x={t.x * xScale}
            y={t.y * yScale}
            width={t.width  * xScale}
            height={t.height * yScale}
            href={d.uri}
            preserveAspectRatio={d.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
          />
        </G>
      </G>
    );
  }

  // ── Shape layer ────────────────────────────────────────────────────────────
  if (layer.type === 'shape') {
    const d      = layer.data as DesignShapeLayer;
    const fill   = d.fill ?? d.fillColor ?? bgHex;
    const stroke = d.stroke ?? d.strokeColor ?? 'transparent';
    const sw     = (d.strokeWidth ?? 0) * Math.min(xScale, yScale);

    if (d.shape === 'circle') {
      return (
        <G key={layer.id} opacity={layer.opacity}>
          {curvesFilter?.filterEl}
          <Circle
            cx={(t.x + t.width  / 2) * xScale}
            cy={(t.y + t.height / 2) * yScale}
            r={Math.min(t.width, t.height) / 2 * Math.min(xScale, yScale)}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            transform={transformAttr}
            filter={filterRef}
          />
        </G>
      );
    }

    return (
      <G key={layer.id} opacity={layer.opacity}>
        {curvesFilter?.filterEl}
        <Rect
          x={t.x * xScale}
          y={t.y * yScale}
          width={t.width  * xScale}
          height={t.height * yScale}
          rx={d.cornerRadius ?? 0}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          transform={transformAttr}
          filter={filterRef}
        />
      </G>
    );
  }

  // ── Text layer ─────────────────────────────────────────────────────────────
  if (layer.type === 'text') {
    const d = layer.data as DesignTextLayer;
    return (
      <G key={layer.id} opacity={layer.opacity}>
        {curvesFilter?.filterEl}
        <SvgText
          x={(t.x + t.width / 2) * xScale}
          y={(t.y + (d.fontSize ?? 24)) * yScale}
          fill={d.color ?? d.textColor ?? FG}
          fontSize={(d.fontSize ?? 24) * Math.min(xScale, yScale)}
          textAnchor="middle"
          fontWeight={d.bold ? 'bold' : 'normal'}
          fontStyle={d.italic ? 'italic' : 'normal'}
          transform={transformAttr}
          filter={filterRef}
        >
          {d.content ?? d.text ?? ''}
        </SvgText>
      </G>
    );
  }

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DesignLayerCompositorProps {
  project: DesignProject;
  /** Rendered display width in logical pixels (not canvas units). */
  displaySize: number;
  /** Optional border radius on the container View. */
  borderRadius?: number;
}

/**
 * DesignLayerCompositor
 *
 * Renders all visible layers of a project at a given display size.
 * The SVG viewBox is set to the project's logical canvas dimensions so that
 * all layer coordinates (which are in canvas space) map correctly regardless
 * of the display size requested.
 *
 * Falls back to a type-icon placeholder only when the project has no layers
 * at all (e.g. a brand-new blank canvas).
 */
export default function DesignLayerCompositor({
  project,
  displaySize,
  borderRadius = RADIUS.xs,
}: DesignLayerCompositorProps) {
  const layers  = project.layers ?? [];
  const cw      = project.canvas.width  || 1080;
  const ch      = project.canvas.height || 1080;

  const bgHex = project.canvas.backgroundHex || CARD;

  // Sort layers by order ascending (bottom to top)
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const hasAnyLayer = sorted.some(l => l.visible);

  return (
    <View
      style={[
        cs.container,
        {
          width: displaySize,
          height: displaySize,
          backgroundColor: bgHex === 'transparent' ? 'transparent' : bgHex,
          borderRadius,
        },
      ]}
    >
      {hasAnyLayer ? (
        <Svg
          width={displaySize}
          height={displaySize}
          viewBox={`0 0 ${cw} ${ch}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          {sorted.map(layer => renderLayer(layer, 1, 1, bgHex))}
        </Svg>
      ) : (
        <View style={cs.placeholder}>
          <Feather
            name={
              project.type === 'garment'  ? 'layers'       :
              project.type === 'campaign' ? 'trending-up'  :
              project.type === 'mockup'   ? 'box'          :
              project.type === 'social'   ? 'instagram'    : 'edit-2'
            }
            size={displaySize * 0.35}
            color={FG}
            style={{ opacity: 0.2 }}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cs = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
