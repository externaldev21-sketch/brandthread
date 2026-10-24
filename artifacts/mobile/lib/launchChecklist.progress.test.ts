import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDemoLaunchChecklist, buildFreshLaunchChecklist, launchProgress,
  type LaunchChecklistResponse, type LaunchStepId,
} from './launchChecklist';

const ALL: LaunchStepId[] = ['name_handle', 'logo_banner', 'accent', 'socials', 'first_product', 'shipping', 'preview', 'publish', 'payouts'];
const make = (done: LaunchStepId[]): LaunchChecklistResponse => ({
  steps: ALL.map((id) => ({ id, done: done.includes(id) })),
  doneCount: done.length, total: ALL.length, complete: done.length === ALL.length, handle: null, dismissed: false,
});

describe('launchProgress — the one setup number', () => {
  it('counts done steps out of every server step', () => {
    expect(launchProgress(make(['name_handle', 'first_product', 'shipping']))).toEqual({
      done: 3, total: 9, percent: 33, label: '3/9', complete: false, next: 'logo_banner',
    });
  });
  it('is complete only when every step is done', () => {
    const p = launchProgress(make(ALL));
    expect(p).toMatchObject({ done: 9, total: 9, percent: 100, complete: true, next: null });
  });
  it('fresh preview starts at 0, demo matches its own doneCount', () => {
    expect(launchProgress(buildFreshLaunchChecklist()).label).toBe('0/9');
    const demo = buildDemoLaunchChecklist();
    expect(launchProgress(demo).done).toBe(demo.doneCount);
  });
});

describe('every setup prompt reads launchProgress', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
  it.each([
    'components/SellerHomeCommerceDashboard.tsx',
    'components/LaunchChecklistCard.tsx',
    'components/SetupWalkthroughSheet.tsx',
    'app/(tabs)/more.tsx',
    'app/setup.tsx',
    'app/launch-checklist.tsx',
  ])('%s', (file) => {
    const src = read(file);
    expect(src).toContain('launchProgress(');
    expect(src).not.toContain('completionPercent(');
  });
});
