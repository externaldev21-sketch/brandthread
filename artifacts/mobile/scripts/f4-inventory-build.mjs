// Builds the preview web bundle into the folder given as argv[2].
// Run it under the shared build lock: flock /tmp/bt-webbuild.lock node scripts/f4-inventory-build.mjs <abs dir>
import { buildPreviewWeb } from './store-screenshots/harness.mjs';

buildPreviewWeb(process.argv[2]);
