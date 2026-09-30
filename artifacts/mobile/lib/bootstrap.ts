/**
 * Side effects that must run before any screen module loads.
 * Imported first by the app entry (`index.ts`).
 */
import { LogBox } from 'react-native';
import { initMonitoring } from '@/lib/monitoring';
import { startBackgroundUpdateChecks } from '@/lib/otaUpdates';
import { injectWebFocusOutlineStyles, injectWebScrollbarHideStyles, injectWebTextRenderingStyles } from '@/lib/webTextRendering';

// React's own dev-only console.error warnings (e.g. "Encountered two
// children with the same key") are logged at the *error* level, so React
// Native's built-in LogBox (which mirrors on web too) renders them as a
// full-screen red "error" overlay indistinguishable, to a real user seeing a
// preview build, from an actual app crash. Real crashes are still caught and
// shown by this app's own <ErrorBoundary>/<TabScreenErrorFallback> (thrown
// errors, via componentDidCatch) — that path is untouched by this call.
// LogBox itself only ever wraps `console.error`/`console.warn` output, which
// keeps logging to the console/terminal for developers either way; this only
// stops it from also painting an in-app banner over the real UI.
LogBox.ignoreAllLogs(true);

if (__DEV__) {
  // React logs its own dev-only render warnings (duplicate list keys, prop
  // deprecations, act() reminders, etc.) through `console.error`, not
  // `console.warn`. LogBox — which mirrors the app's console.error output
  // on native and web — treats every console.error as a fatal-looking red
  // "error" notification/box by default, so a harmless React warning ends
  // up rendered as an in-app error banner indistinguishable from a real
  // crash. These are diagnostics, not runtime failures (nothing threw, no
  // ErrorBoundary caught anything), so they should stay visible in the
  // terminal/browser console but never take over the screen. Only messages
  // matching React's own "Warning: ..." console.error convention are
  // ignored here — an application `console.error(...)` call (or anything
  // an ErrorBoundary reports) does not match this pattern and still shows.
  LogBox.ignoreLogs([/^Warning: /]);
}

initMonitoring();
startBackgroundUpdateChecks();
injectWebTextRenderingStyles();
injectWebFocusOutlineStyles();
injectWebScrollbarHideStyles();
