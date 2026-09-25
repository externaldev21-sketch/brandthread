/**
 * Standard alpha-transparency checkerboard, tiled via an SVG pattern.
 * Drop it as the first child of a relatively-positioned container so it
 * fills behind a transparent-PNG preview.
 */
import React from 'react';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

interface Props {
  tile?: number;
  light?: string;
  dark?: string;
}

export default function Checkerboard({ tile = 10, light = '#F2F2F2', dark = '#D9D9D9' }: Props) {
  return (
    <Svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Defs>
        <Pattern id="checkerTile" width={tile * 2} height={tile * 2} patternUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={tile * 2} height={tile * 2} fill={light} />
          <Rect x={0} y={0} width={tile} height={tile} fill={dark} />
          <Rect x={tile} y={tile} width={tile} height={tile} fill={dark} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#checkerTile)" />
    </Svg>
  );
}
