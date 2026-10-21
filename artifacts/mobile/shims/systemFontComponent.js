/**
 * Wraps a Text-like component so its style passes through `withSystemFont`
 * (lib/systemFont.ts) first. Only the style prop is touched, and only when
 * its fontFamily is a weight token; every other prop, ref and static passes
 * through. Used by shims/react-native.js and shims/react-native-web-*.js.
 */
const React = require('react');
const { withSystemFont } = require('../lib/systemFont');

const PRIVATE_ICON_GLYPH = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u;
function containsIconGlyph(children) {
  if (typeof children === 'string') return PRIVATE_ICON_GLYPH.test(children);
  return Array.isArray(children) && children.some(containsIconGlyph);
}

// Only icon Text instances subscribe. Ordinary app text incurs no font-loading
// subscription and keeps its existing system-font behavior.
const ReadyIconText = React.forwardRef(function ReadyIconText({ Base, family, ...props }, ref) {
  // Deliberately lazy: eager font imports here can recreate the native
  // React Native -> font helper -> React Native bootstrap cycle.
  const { subscribeIconFonts, isIconFontReady, getIconFontServerHidden } = require('../lib/iconFonts');
  const ready = React.useSyncExternalStore(
    subscribeIconFonts,
    () => isIconFontReady(family),
    getIconFontServerHidden,
  );
  return React.createElement(Base, {
    ...props,
    ref,
    style: ready ? props.style : [props.style, { opacity: 0 }],
  });
});

function withFontStyle(Base, displayName) {
  const Wrapped = React.forwardRef(function SystemFontText(props, ref) {
    const style = withSystemFont(props.style);
    // Icon fonts use private-use characters. Never expose their fallback
    // missing-glyph square while a slow/failed asset is still unresolved.
    if (containsIconGlyph(props.children)) {
      const family = require('react-native').StyleSheet.flatten(style)?.fontFamily;
      const { isBundledIconFont } = require('../lib/iconFonts');
      if (isBundledIconFont(family)) {
        return React.createElement(ReadyIconText, { ...props, Base, family, style, ref });
      }
    }
    return React.createElement(Base, style === props.style ? { ...props, ref } : { ...props, style, ref });
  });
  Wrapped.displayName = displayName;
  // Statics such as TextInput.State (focus helpers) stay reachable.
  for (const key of Object.getOwnPropertyNames(Base)) {
    if (key in Wrapped) continue;
    try {
      Wrapped[key] = Base[key];
    } catch {
      // Read-only builtins (name, length, …) are irrelevant here.
    }
  }
  return Wrapped;
}

module.exports = { withFontStyle };
