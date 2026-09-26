import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

/**
 * Root HTML document for the static/dev web export (expo-router convention —
 * this only runs on web, and only wraps the very first server-rendered
 * paint; it has no effect on native).
 *
 * This is the one place to put truly global, framework-level web polish that
 * can't live in a themed React component: font-loading behavior before the
 * app's JS has hydrated, and small, universal CSS rules (hover/focus/active
 * feedback and cursor for every interactive element, scrollbar styling,
 * keyboard focus rings) that would otherwise mean touching dozens of
 * individual shared components one at a time.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the page extend under the browser's own
            notch/status-bar chrome (and, importantly, under a simulated
            notch in a phone-frame preview like Replit's), which is what
            makes `env(safe-area-inset-*)` return non-zero values at all.
            Without it, react-native-safe-area-context's web implementation
            always reads 0 for insets.top/bottom, so every header rendered
            on web sits flush at the very top regardless of device frame. */}
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"
        />
        {/* Disabled because the root <div id="root"> must fill the screen and
            expo-router's default reset conflicts with scroll-behavior for
            the elements we manage ourselves (ScrollView, FlatList). This is
            the standard expo-router web template setting. */}
        <ScrollViewStyleReset />

        {/* The app already waits for the real Inter faces to load before
            rendering any text (see useFonts + fontsLoaded gating in
            app/_layout.tsx), so there's no fallback-font flash once React
            mounts. This preconnect just gets Google Fonts' CDN connection
            warmed up before that JS runs, shaving time off the wait rather
            than changing the gating behavior itself. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        <style dangerouslySetInnerHTML={{ __html: webPolishCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// The document background before the app's own theme paints — avoids a
// flash of white behind the themed app (app/_layout.tsx also sets this at
// module load for the same reason once JS runs; this covers the gap before
// that).
const responsiveBackground = `
  html, body, #root { background-color: #0A0A0B; height: 100%; }
`;

// Universal, theme-agnostic interaction polish for every shared
// Pressable/Button/IconButton/Card in the app. react-native-web renders
// these as <div role="button"> (never a real <button>, so nested pressables
// never produce invalid nested-<button> HTML), already sets cursor: pointer
// and touch-action automatically, and respects the browser's own
// :focus-visible semantics — this stylesheet is what turns that hookup into
// visible feedback instead of doing nothing.
const webPolishCss = `
  [role="button"]:not([aria-disabled="true"]) {
    transition: filter 120ms ease-out;
  }
  @media (hover: hover) {
    [role="button"]:not([aria-disabled="true"]):hover {
      filter: brightness(1.08);
    }
  }
  [role="button"]:not([aria-disabled="true"]):active {
    filter: brightness(0.92);
  }
  /* Keyboard focus: a soft theme-tinted glow drawn INSIDE the element's own
     box (box-shadow, not outline — outline ignores border-radius and by
     default sits outside the box, which is what used to make a tap on a
     tightly packed control, like a profile tab, show a hard rectangular
     white ring bleeding into the row above it). --bt-accent is set on
     :root by AppThemeContext whenever the active theme changes (see
     contexts/AppThemeContext.tsx), so this is correct in all 12 themes,
     never a fixed white. Every element already keeps its own border-radius,
     so the glow follows pills, chips and circles exactly. */
  [role="button"]:focus-visible,
  [role="tab"]:focus-visible,
  [role="link"]:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--bt-accent, rgba(255,255,255,0.55));
  }
  [role="button"]:focus:not(:focus-visible),
  [role="tab"]:focus:not(:focus-visible) {
    outline: none;
    box-shadow: none;
  }
  /* Text inputs: no browser outline AND no box-shadow ring of our own here.
     react-native-web renders a rounded pill/card as a *wrapping* View around
     a plain, square-cornered <input>/<textarea> with no border-radius of its
     own, so the [role="button"] glow above — or the browser's native focus
     outline — draws a hard rectangle floating inside the rounded container
     (reported as a "box inside the rounded search field", doubling up with
     any focus border the component already paints on its own wrapper, e.g.
     components/BrandthreadUI.tsx's SearchBar). The premium focus state for
     an input is the responsibility of that input's own wrapper component
     (it brightens its own border on focus, see SearchBar/BuyerTabBar's
     search field) — this rule only ever needs to remove the raw element's
     default decoration, on every focus path, not just :focus-visible. */
  input,
  textarea {
    outline: none;
  }
  input:focus,
  input:focus-visible,
  textarea:focus,
  textarea:focus-visible {
    outline: none;
    box-shadow: none;
  }

  /* Thin, unobtrusive scrollbars instead of the browser's chunky default —
     still visible (never fully hidden) so scrollable areas stay discoverable. */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.25) transparent;
  }
  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background-color: rgba(255,255,255,0.2);
    border-radius: 8px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  *::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255,255,255,0.35);
  }
`;
