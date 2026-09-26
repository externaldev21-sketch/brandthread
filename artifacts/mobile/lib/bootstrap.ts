/**
 * Side effects that must run before any screen module loads.
 * Imported first by the app entry (`index.ts`).
 */
import { initMonitoring } from '@/lib/monitoring';
import { startBackgroundUpdateChecks } from '@/lib/otaUpdates';
import { injectWebTextRenderingStyles } from '@/lib/webTextRendering';

initMonitoring();
startBackgroundUpdateChecks();
injectWebTextRenderingStyles();
