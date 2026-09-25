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
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"
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
  [role="button"]:focus-visible,
  [role="tab"]:focus-visible,
  [role="link"]:focus-visible,
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid rgba(255,255,255,0.85);
    outline-offset: 2px;
    border-radius: 4px;
  }
  [role="button"]:focus:not(:focus-visible) {
    outline: none;
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
