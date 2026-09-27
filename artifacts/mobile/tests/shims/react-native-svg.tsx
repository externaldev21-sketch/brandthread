/**
 * Test-only shim for `react-native-svg`, aliased in vitest.config.ts.
 *
 * The real package fails to parse under Vitest/Node's ESM resolver in this
 * environment ("Unexpected token 'typeof'" — a Flow-annotated file, unrelated
 * to any app code), the same class of issue documented for
 * react-native-reanimated below. Any suite that transitively renders an SVG
 * component (icons, charts, the empty-state illustrations) hits this unless
 * it already provides its own `vi.mock('react-native-svg', ...)`, which still
 * takes precedence over this alias.
 */
import React from 'react';

function host(name: string) {
  return React.forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    React.createElement(name, { ...props, ref }, props.children as React.ReactNode));
}

const Svg = host('Svg');
export const Path = host('Path');
export const Circle = host('Circle');
export const Ellipse = host('Ellipse');
export const Line = host('Line');
export const Rect = host('Rect');
export const G = host('G');
export const Defs = host('Defs');
export const LinearGradient = host('LinearGradient');
export const RadialGradient = host('RadialGradient');
export const Stop = host('Stop');
export const Mask = host('Mask');
export const Pattern = host('Pattern');
export const Filter = host('Filter');
export const FeColorMatrix = host('FeColorMatrix');
export const Image = host('SvgImage');
export const Text = host('SvgText');
export const Polygon = host('Polygon');
export const Polyline = host('Polyline');

export default Svg;
