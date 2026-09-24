// Imported first by src/index.ts so error reporting is active before any
// other module runs. A no-op unless SENTRY_DSN is set.
import { initMonitoring } from "./lib/monitoring";

initMonitoring();
