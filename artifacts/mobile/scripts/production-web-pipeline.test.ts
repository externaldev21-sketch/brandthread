import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { writeLandingPage } = require('./landing-page');
const { writePrelaunchLegalPages } = require('./prelaunch-legal');
const project = path.resolve(__dirname, '..');
let fixture: string;

function verify(root: string, shouldPackage = false) {
  return spawnSync(process.execPath, [
    path.join(root, 'scripts/verify-production-web.cjs'),
    ...(shouldPackage ? ['--package'] : []),
  ], { encoding: 'utf8', timeout: 15_000 });
}

describe('production web deployment packaging', () => {
  beforeAll(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-web-pipeline-'));
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.mkdirSync(path.join(fixture, 'static-build'));
    fs.cpSync(path.join(project, 'server'), path.join(fixture, 'server'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'verify-production-web.cjs'),
      path.join(fixture, 'scripts/verify-production-web.cjs'));
    const html = writeLandingPage(path.join(fixture, 'static-build'), project, {});
    fs.writeFileSync(path.join(fixture, 'static-build/index.html'), html);
    fs.writeFileSync(path.join(fixture, 'static-build/app-shell.html'), 'EXPORTED APP SHELL');
    writePrelaunchLegalPages(path.join(fixture, 'static-build'), project);
  });
  afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it('packages the current seal and verifies the published entrypoint over HTTP', () => {
    const result = verify(fixture, true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Production seal verified: 18 HTTP checks');
    expect(fs.readFileSync(path.join(fixture, 'static-build-runtime/prelaunchGate.cjs'), 'utf8'))
      .toBe(fs.readFileSync(path.join(project, 'server/prelaunchGate.cjs'), 'utf8'));
    expect(fs.existsSync(path.join(fixture, 'static-build/static-build-runtime'))).toBe(false);
  }, 20_000);

  it.each([
    ['server/prelaunchGate.cjs', 'Packaged server is stale relative to the current source'],
    ['static-build-runtime/prelaunchGate.cjs', 'Packaged server does not match its build manifest'],
    ['static-build/app-shell.html', 'App shell changed after packaging'],
  ])('rejects stale or mismatched build files: %s', (name, message) => {
    const file = path.join(fixture, name);
    const original = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, '\n/* changed after build */');
      const result = verify(fixture);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
    } finally {
      fs.writeFileSync(file, original);
    }
  });
});
