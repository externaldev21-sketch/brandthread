/**
 * Wraps a Text-like component so its style passes through `withSystemFont`
 * (lib/systemFont.ts) first. Only the style prop is touched, and only when
 * its fontFamily is a weight token; every other prop, ref and static passes
 * through. Used by shims/react-native.js and shims/react-native-web-*.js.
 */
const React = require('react');
const { withSystemFont } = require('../lib/systemFont');

function withFontStyle(Base, displayName) {
  const Wrapped = React.forwardRef(function SystemFontText(props, ref) {
    const style = withSystemFont(props.style);
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
