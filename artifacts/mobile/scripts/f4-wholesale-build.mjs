#!/usr/bin/env node
/** Exports the preview web build for the wholesale screenshots: node scripts/f4-wholesale-build.mjs <outDir> */
import path from 'node:path';
import { buildPreviewWeb } from './store-screenshots/harness.mjs';

buildPreviewWeb(path.resolve(process.argv[2]));
