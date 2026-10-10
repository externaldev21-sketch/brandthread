/**
 * Side effects that must run before any screen module loads.
 * Imported first by the app entry (`index.ts`).
 */
import { LogBox } from 'react-native';
import { initMonitoring } from '@/lib/monitoring';
import { startBackgroundUpdateChecks } from '@/lib/otaUpdates';
import { runAfterFirstPaint } from '@/lib/deferStartup';
import { logNativeRuntimeDiagnostics } from '@/lib/startupDiagnostics';
import { injectWebFocusOutlineStyles, injectWebRootClipStyles, injectWebScrollbarHideStyles, injectWebTextRenderingStyles } from '@/lib/webTextRendering';
// Android: headless FCM task that rings DM calls when the app is killed (no-op elsewhere).
import '@/lib/calls/native/registerBackgroundCallTask';

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

logNativeRuntimeDiagnostics();
initMonitoring();
// Registering the foreground update check is not needed for first paint.
runAfterFirstPaint(startBackgroundUpdateChecks);
injectWebTextRenderingStyles();
injectWebFocusOutlineStyles();
injectWebScrollbarHideStyles();
injectWebRootClipStyles();
