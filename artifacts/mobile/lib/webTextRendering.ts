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

/**
 * Clips the whole app to exactly one viewport (the device frame, in a
 * phone-frame preview like Replit's): `html`/`body`/`#root` are pinned to
 * `100%`/`100dvh` with `overflow: hidden`, so the outer document itself can
 * never scroll or grow taller than the viewport. Every screen's own content
 * still scrolls normally — this only removes the OUTER page's ability to
 * scroll, which is what let content spill out past the bottom of a
 * phone-frame preview's rounded device edge when some element's layout
 * pushed the real document height taller than the visible frame (seen live:
 * the seller dashboard's "Traffic sources" section visible under the
 * floating tab bar and past the frame's own bottom edge).
 *
 * `100dvh` (dynamic viewport height, falls back silently to `100vh` on
 * browsers that don't support it) rather than a fixed `100vh`, so a mobile
 * browser's own address-bar show/hide doesn't leave a stale, too-tall value.
 *
 * Same reasoning as the other injectors here: this needs to run before any
 * screen mounts, from lib/bootstrap.ts, since there's no live index.html/
 * global stylesheet for this build to hand-edit.
 */
export function injectWebRootClipStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('bt-root-clip')) return; // idempotent (fast refresh, re-imports)

  const style = document.createElement('style');
  style.id = 'bt-root-clip';
  style.textContent = `
    html, body {
      height: 100%;
      overflow: hidden;
      overscroll-behavior: none;
    }
    #root {
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Kills the browser's default focus ring on every text input/textarea on
 * web — react-native-web renders `<TextInput>` as a real `<input>`/
 * `<textarea>`, which Chromium outlines with its native focus ring
 * (`-webkit-focus-ring-color`, an amber/orange rectangle on this sandbox's
 * and most Linux/Chrome-OS-themed Chromium builds) on focus unless that's
 * explicitly suppressed — seen live on the story-reply field and the chat
 * composer, and reproduced locally on any `<TextInput>` that doesn't set
 * its own `outlineStyle: 'none'` (see lib/inputReset.ts's WEB_INPUT_RESET,
 * which a number of screens already apply per-field).
 *
 * `app/+html.tsx` looks like the natural place for this (and already
 * carries a near-identical, never-applied rule) but is NOT the template
 * this app's web build actually uses — see injectWebTextRenderingStyles's
 * doc comment above and WEB_DEPLOYMENT.md; Expo's default `index.html` is
 * used as-is for this project's `web.output: "single"` config, so anything
 * written only in +html.tsx never reaches a real page. This function, run
 * from lib/bootstrap.ts before any screen loads (the one place proven to
 * actually land in <head>), is the real fix — monochrome-only per Dev's
 * rule, dead code on native (Platform.OS guard below).
 */
export function injectWebFocusOutlineStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('bt-focus-outline')) return; // idempotent (fast refresh, re-imports)

  const style = document.createElement('style');
  style.id = 'bt-focus-outline';
  style.textContent = `
    input, textarea {
      outline: none;
    }
    input:focus, input:focus-visible,
    textarea:focus, textarea:focus-visible {
      outline: none;
      box-shadow: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Hides every scrollbar on web — Dev's rule: no visible scrollbar (the
 * white bar on the right edge) on any screen, ever, vertical or horizontal
 * (chip rows/carousels included). Seen live on Discover's Brands/People
 * tabs; every ScrollView/FlatList/FlashList/SectionView renders as a plain
 * scrollable `<div>` on web, which shows the browser's own scrollbar unless
 * that's explicitly suppressed — this is the CSS half of that fix (see
 * lib/scrollIndicators.ts for the native-prop half: `showsVerticalScroll
 * Indicator`/`showsHorizontalScrollIndicator` default to `false`).
 *
 * `scrollbar-width`/`-ms-overflow-style` are the standard/legacy properties
 * (Firefox, old Edge); `::-webkit-scrollbar` is what Chromium/Safari
 * actually need. `overflow` itself is untouched — hiding the scrollbar's
 * paint never removes the element's ability to scroll.
 *
 * Same reasoning as injectWebFocusOutlineStyles above: `app/+html.tsx`
 * already carries a near-identical (but merely thin, not hidden) scrollbar
 * rule that is proven dead code for this build — see that function's doc
 * comment. This is the one place that actually reaches a live page.
 */
export function injectWebScrollbarHideStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('bt-scrollbar-hide')) return; // idempotent (fast refresh, re-imports)

  const style = document.createElement('style');
  style.id = 'bt-scrollbar-hide';
  style.textContent = `
    html, body, * {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    *::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
  `;
  document.head.appendChild(style);
}
