/**
 * Web-only `hitSlop` support for react-native-web touchables.
 *
 * react-native-web's Pressable and TouchableOpacity silently drop `hitSlop`,
 * so every touch-area extension the app declares for small controls
 * (switches, icon buttons, back arrows, chips — the 44×44pt minimum) did
 * nothing in the web preview. Metro resolves react-native-web's own
 * `./exports/Pressable` and `./exports/TouchableOpacity` to thin wrappers
 * built here (see metro.config.js). Each renders the original component
 * unchanged and, when `hitSlop` is set, adds one invisible,
 * absolutely-positioned child that extends the clickable box by the slop on
 * each side. Clicks on it bubble to the touchable's own element, so press
 * handling stays on the original code path. Layout and appearance do not
 * change: the child is out of flow, transparent and hidden from assistive
 * tech. Native is untouched (it already honors hitSlop).
 */
import * as React from 'react';
import View from 'react-native-web/dist/exports/View';
import StyleSheet from 'react-native-web/dist/exports/StyleSheet';

export function normalizeSlop(hitSlop) {
  if (hitSlop == null) return null;
  if (typeof hitSlop === 'number') {
    return hitSlop > 0 ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop } : null;
  }
  const top = Math.max(0, hitSlop.top || 0);
  const bottom = Math.max(0, hitSlop.bottom || 0);
  const left = Math.max(0, hitSlop.left || 0);
  const right = Math.max(0, hitSlop.right || 0);
  if (top === 0 && bottom === 0 && left === 0 && right === 0) return null;
  return { top, bottom, left, right };
}

// An absolutely-positioned child is placed relative to its parent's padding
// box, but native hitSlop extends from the outer (border) edge — add the
// touchable's own border widths so a bordered chip gets the full slop.
function borderWidths(style) {
  let flat;
  try {
    flat = StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false, hovered: false, focused: false }) : style) || {};
  } catch {
    flat = {};
  }
  const all = typeof flat.borderWidth === 'number' ? flat.borderWidth : 0;
  const pick = (v) => (typeof v === 'number' ? v : all);
  return { top: pick(flat.borderTopWidth), bottom: pick(flat.borderBottomWidth), left: pick(flat.borderLeftWidth), right: pick(flat.borderRightWidth) };
}

function slopChild(slop, border) {
  return React.createElement(View, {
    key: '__hitslop',
    'aria-hidden': true,
    dataSet: { hitslop: '1' },
    style: {
      position: 'absolute',
      top: -(slop.top + border.top),
      bottom: -(slop.bottom + border.bottom),
      left: -(slop.left + border.left),
      right: -(slop.right + border.right),
    },
  });
}

export function withWebHitSlop(Component, { functionChildren }) {
  function WithHitSlop(props, ref) {
    const { hitSlop, children, ...rest } = props;
    // Kept on disabled controls too, as native does — the press is ignored
    // either way, and the tap area doesn't jump when the control enables.
    const slop = normalizeSlop(hitSlop);
    if (!slop) return React.createElement(Component, { ...rest, ref }, children);
    const border = borderWidths(rest.style);
    const content = functionChildren
      ? (state) => [slopChild(slop, border), React.createElement(React.Fragment, { key: '__content' }, typeof children === 'function' ? children(state) : children)]
      : [slopChild(slop, border), React.createElement(React.Fragment, { key: '__content' }, children)];
    return React.createElement(Component, { ...rest, ref }, content);
  }
  const Wrapped = React.memo(React.forwardRef(WithHitSlop));
  Wrapped.displayName = Component.displayName || 'Touchable';
  return Wrapped;
}
