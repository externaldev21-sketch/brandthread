import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type BuyerNavIconName =
  | 'home' | 'discover' | 'inbox' | 'search' | 'profile'
  | 'close' | 'friends' | 'filters'
  // Seller bar
  | 'dashboard' | 'products' | 'orders' | 'studio';

/**
 * Line icons for the buyer and seller navigation. One consistent 24pt grid, rounded
 * joins, outline when idle and filled when selected, so every tab reads the
 * same on iOS, Android and web instead of mixing SF Symbols with fallbacks.
 */
export function BuyerNavIcon({
  name,
  color,
  focused = false,
  size = 24,
  strokeWidth = 1.8,
}: {
  name: BuyerNavIconName;
  color: string;
  focused?: boolean;
  size?: number;
  strokeWidth?: number;
}) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  switch (name) {
    case 'home':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M3.6 10.4 12 3.6l8.4 6.8v8.9a1.1 1.1 0 0 1-1.1 1.1h-4.6v-5.6a1 1 0 0 0-1-1h-3.4a1 1 0 0 0-1 1v5.6H4.7a1.1 1.1 0 0 1-1.1-1.1v-8.9Z"
            fill={focused ? color : 'none'}
            {...common}
          />
        </Svg>
      );
    case 'discover':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8.6} fill="none" {...common} />
          <Path
            d="m15.4 8.6-2 4.8-4.8 2 2-4.8 4.8-2Z"
            fill={focused ? color : 'none'}
            {...common}
          />
        </Svg>
      );
    case 'inbox':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M4 6.6A2.6 2.6 0 0 1 6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v7.9a2.6 2.6 0 0 1-2.6 2.6h-6.6L6.6 20v-2.9A2.6 2.6 0 0 1 4 14.5V6.6Z"
            fill={focused ? color : 'none'}
            {...common}
          />
        </Svg>
      );
    case 'search':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={10.8} cy={10.8} r={6.6} fill="none" {...common} strokeWidth={strokeWidth + (focused ? 0.5 : 0)} />
          <Line x1={15.6} y1={15.6} x2={20.2} y2={20.2} {...common} strokeWidth={strokeWidth + (focused ? 0.5 : 0)} />
        </Svg>
      );
    case 'profile':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={8.4} r={3.9} fill={focused ? color : 'none'} {...common} />
          <Path
            d="M4.9 19.6c.9-3.6 3.6-5.6 7.1-5.6s6.2 2 7.1 5.6"
            fill={focused ? color : 'none'}
            {...common}
          />
        </Svg>
      );
    case 'friends':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={9} cy={8.6} r={3.4} fill={focused ? color : 'none'} {...common} />
          <Path d="M2.9 19.2c.7-3.2 3-5 6.1-5s5.4 1.8 6.1 5" fill="none" {...common} />
          <Path d="M15.2 5.4a3.2 3.2 0 0 1 0 6.3" fill="none" {...common} />
          <Path d="M17.3 14.4c2 .6 3.3 2.2 3.8 4.8" fill="none" {...common} />
        </Svg>
      );
    case 'filters':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line x1={4} y1={7} x2={20} y2={7} {...common} />
          <Line x1={4} y1={12} x2={20} y2={12} {...common} />
          <Line x1={4} y1={17} x2={20} y2={17} {...common} />
          <Circle cx={15} cy={7} r={2.1} fill={color} {...common} />
          <Circle cx={8.5} cy={12} r={2.1} fill={color} {...common} />
          <Circle cx={13} cy={17} r={2.1} fill={color} {...common} />
        </Svg>
      );
    case 'dashboard':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3.8} y={3.8} width={7} height={8.4} rx={2} fill={focused ? color : 'none'} {...common} />
          <Rect x={13.2} y={3.8} width={7} height={5} rx={2} fill="none" {...common} />
          <Rect x={3.8} y={14.6} width={7} height={5.6} rx={2} fill="none" {...common} />
          <Rect x={13.2} y={11.2} width={7} height={9} rx={2} fill={focused ? color : 'none'} {...common} />
        </Svg>
      );
    case 'products':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3.4 19.8 7.5 12 11.6 4.2 7.5 12 3.4Z" fill={focused ? color : 'none'} {...common} />
          <Path d="M4.2 7.5v9L12 20.6l7.8-4.1v-9" fill="none" {...common} />
          <Line x1={12} y1={11.6} x2={12} y2={20.6} {...common} />
        </Svg>
      );
    case 'orders':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M5.3 8.3h13.4l-.9 10.9a1.7 1.7 0 0 1-1.7 1.5H7.9a1.7 1.7 0 0 1-1.7-1.5L5.3 8.3Z"
            fill={focused ? color : 'none'}
            {...common}
          />
          <Path d="M8.8 8.3V7.1a3.2 3.2 0 0 1 6.4 0v1.2" fill="none" {...common} />
        </Svg>
      );
    case 'studio':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M11 4.6c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z"
            fill={focused ? color : 'none'}
            {...common}
          />
          <Path d="M18.4 3.4v3.4M16.7 5.1h3.4" fill="none" {...common} />
          <Path d="M18 17.6v2.4M16.8 18.8h2.4" fill="none" {...common} />
        </Svg>
      );
    case 'close':
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line x1={6.5} y1={6.5} x2={17.5} y2={17.5} {...common} strokeWidth={strokeWidth + 0.2} />
          <Line x1={17.5} y1={6.5} x2={6.5} y2={17.5} {...common} strokeWidth={strokeWidth + 0.2} />
        </Svg>
      );
  }
}
