#!/usr/bin/env node
// Preserve the original arbitrary-route audit CLI while routing the newer
// exported-build dashboard pass through its local build/session harness.
const buildHarness = process.argv.some((arg) => arg.startsWith('--build-dir='));
await import(buildHarness ? './text-fit.web-build.mjs' : './text-fit.web-legacy.mjs');