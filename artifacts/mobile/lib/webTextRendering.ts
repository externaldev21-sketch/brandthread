import { Platform } from 'react-native';

/**
 * Global web text-rendering fixes.
 *
 * Native (iOS/Android) always subpixel-antialiases and hints text using the
 * OS text engine — there is nothing to configure. react-native-web renders
 * through the browser's own text engine instead, which needs explicit CSS to
 * get the same crisp result:
 *
 *   - `-webkit-font-smoothing: antialiased` / `-moz-osx-font-smoothing:
 *     grayscale` ask WebKit/Blink and Firefox-on-macOS to use the thinner,
 *     grayscale antialiasing the OS uses elsewhere, instead of the default
 *     subpixel LCD-tuned rendering RN's own View/Text layers frequently defeat
 *     (any ancestor with a transform, opacity, or backdrop-filter forces the
 *     browser off the subpixel path anyway, so the fallback needs to look
 *     good too).
 *   - `text-rendering: optimizeLegibility` turns on kerning/ligatures, which
 *     otherwise vary between browsers and can make small text look uneven.
 *
 * There is no custom `index.html`/global stylesheet anywhere in this app
 * (Expo web's default template is used as-is — see WEB_DEPLOYMENT.md), so
 * this is the one place these rules are set. It runs from lib/bootstrap.ts,
 * which is imported before any screen module, so the tag is in <head> before
 * the first paint.
 */
export function injectWebTextRenderingStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('bt-text-rendering')) return; // idempotent (fast refresh, re-imports)

  const style = document.createElement('style');
  style.id = 'bt-text-rendering';
  style.textContent = `
    html, body, #root {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    /* Never let anything scale/transform the whole app: a zoom or transform
       on the root container would put every line of text in the app on a
       fractional pixel boundary at once. This does not affect, and is not
       affected by, chrome OUTSIDE this document (e.g. a preview tool's own
       iframe wrapper scaling the iframe from the parent page — see this
       sweep's report for how to rule that out). */
    html, body, #root {
      transform: none !important;
      zoom: 1 !important;
    }
  `;
  document.head.appendChild(style);
}
