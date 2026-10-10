/**
 * Builds the preview web export into a chosen directory (default: the
 * harness's own). Lets a screenshot script compare a "before" build with the
 * current one:  node scripts/store-screenshots/build-preview.mjs <outDir>
 */
import path from 'node:path';
import { buildPreviewWeb, DEFAULT_BUILD_DIR } from './harness.mjs';

buildPreviewWeb(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_BUILD_DIR);
