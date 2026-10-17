#!/usr/bin/env node
// Run with Node >=24 (built-in TypeScript stripping). No app/runtime imports.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { evaluatePerformanceBudgets, PERFORMANCE_TARGETS } from '../lib/navigation/performanceBudgets.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const webFile = option('--web-report', '.local/performance/after-verified.json');
const output = option('--out', '.local/performance/native-targets.csv');
const web = JSON.parse(await readFile(webFile, 'utf8'));
const nativeFile = option('--native-evidence', null);
const native = nativeFile ? JSON.parse(await readFile(nativeFile, 'utf8')) : { observations: [] };
if (!Array.isArray(native.observations)) throw Error('Native evidence must contain observations[]');
const keys = ['feedback16ms', 'cachedUnder100ms', 'freshUnder300ms', 'noJsStallOver50ms', 'steady60fps', 'steady120fps'];
const headers = [
  'role', 'screen', 'route', 'native_release_gate', ...keys,
  'browser_navigation_settle_proxy_ms_NOT_layout',
  'browser_worst_JS_frame_gap_ms_NOT_native_stall', 'evidence_note',
];
const rows = web.results.map(screen => {
  const observations = native.observations.filter(row => row.role === screen.role && row.route === screen.route);
  if (observations.length > 1) throw Error(`Ambiguous native evidence for ${screen.role} ${screen.route}`);
  const observation = observations[0];
  const budget = evaluatePerformanceBudgets(observation ?? { production: false, platform: 'web', engine: 'V8' });
  const gaps = screen.samples.map(s => s.worstJsFrameMs).filter(Number.isFinite);
  return [
    screen.role, screen.name, screen.route, budget.releaseGate, ...keys.map(k => budget.targets[k]),
    screen.medianMs, gaps.length ? Math.round(Math.max(...gaps)) : '',
    observation ? 'Native results apply only to the supplied measured device/scenario'
      : 'Native production evidence missing; gate fails; browser proxy cannot certify layout, feedback or FPS',
  ];
});
const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, [headers, ...rows].map(row => row.map(escape).join(',')).join('\n') + '\n');
const failed = rows.filter(row => row[3] !== 'PASS').length;
console.log(JSON.stringify({ targets: PERFORMANCE_TARGETS, screens: rows.length, passed: rows.length - failed, notPassed: failed, output }));
// Machine-readable release gate: missing device measurements cannot pass CI.
if (failed) process.exitCode = 1;
