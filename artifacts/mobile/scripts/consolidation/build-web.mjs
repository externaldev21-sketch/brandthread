#!/usr/bin/env node
/** Exports the signed-out web preview the capture script serves: node scripts/consolidation/build-web.mjs <out-dir> */
import { buildPreviewWeb } from '../store-screenshots/harness.mjs';

buildPreviewWeb(process.argv[2]);
