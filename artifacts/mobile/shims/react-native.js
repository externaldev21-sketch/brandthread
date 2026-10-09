/**
 * `react-native` with system-font-aware Text and TextInput.
 *
 * metro.config.js resolves every `import … from 'react-native'` in the app
 * (and its dependencies) to this file. It re-exports react-native unchanged
 * (every export keeps its original lazy getter) except `Text`, `TextInput`
 * and `Animated.Text`, which pass their style through `withSystemFont`
 * (lib/systemFont.ts) first. That is what lets the app drop Inter for the
 * platform system font without editing the thousands of styles that carry
 * their weight in `fontFamily` (`FONT.bold`, `'Inter_700Bold'`, …).
 *
 * On web, babel-preset-expo rewrites `react-native` imports straight to
 * react-native-web's per-component modules, so metro.config.js also points
 * those (Text, TextInput) at shims/react-native-web-*.js.
 */
const RN = require('react-native');
const { withFontStyle } = require('./systemFontComponent');

/** Copies every own property descriptor, so lazy getters stay lazy. */
function copyExports(source) {
  const target = {};
  for (const key of Object.getOwnPropertyNames(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    Object.defineProperty(target, key, { ...descriptor, configurable: true });
  }
  return target;
}

function lazy(target, key, create) {
  let value;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (value === undefined) value = create();
      return value;
    },
  });
}

const exportsWithSystemFont = copyExports(RN);
lazy(exportsWithSystemFont, 'Text', () => withFontStyle(RN.Text, 'Text'));
lazy(exportsWithSystemFont, 'TextInput', () => withFontStyle(RN.TextInput, 'TextInput'));
lazy(exportsWithSystemFont, 'Animated', () => {
  const Animated = copyExports(RN.Animated);
  lazy(Animated, 'Text', () => RN.Animated.createAnimatedComponent(exportsWithSystemFont.Text));
  return Animated;
});

module.exports = exportsWithSystemFont;
