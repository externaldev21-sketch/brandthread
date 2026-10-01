/**
 * Accessibility regression guard: an icon-only pressable (icon child, no text)
 * must carry an accessibilityLabel. The repo had 138 of these when the guard
 * was added; docs/audit/a11y-icon-only-baseline.json records how many each
 * file still has, and this test fails if any file goes ABOVE its baseline
 * (a new unlabeled control) — fixing one and lowering the baseline is always
 * welcome. Regenerate with: A11Y_UPDATE_BASELINE=1 pnpm --filter @workspace/mobile exec vitest run tests/a11y-icon-only-lint.test.ts
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { findUnlabeledIconOnlyPressables } from '@/lib/a11y/iconOnlyScan';

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.resolve(ROOT, '../../docs/audit/a11y-icon-only-baseline.json');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of ['app', 'components']) {
    for (const file of walk(path.join(ROOT, dir))) {
      const n = findUnlabeledIconOnlyPressables(file, fs.readFileSync(file, 'utf8')).length;
      if (n > 0) counts[path.relative(ROOT, file).split(path.sep).join('/')] = n;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('icon-only pressable scanner', () => {
  it('flags an icon-only pressable without a label', () => {
    const src = `const A = () => <TouchableOpacity onPress={f}><Feather name="x" /></TouchableOpacity>;`;
    expect(findUnlabeledIconOnlyPressables('a.tsx', src)).toHaveLength(1);
  });

  it('accepts a labeled one, one with text, and one that spreads props', () => {
    const labeled = `const A = () => <PressableScale accessibilityLabel="Close"><Feather name="x" /></PressableScale>;`;
    const withText = `const A = () => <Pressable><Feather name="x" /><Text>Close</Text></Pressable>;`;
    const spread = `const A = (p) => <Pressable {...p}><Feather name="x" /></Pressable>;`;
    const hidden = `const A = () => <Pressable accessible={false}><Feather name="x" /></Pressable>;`;
    for (const src of [labeled, withText, spread, hidden]) {
      expect(findUnlabeledIconOnlyPressables('a.tsx', src)).toHaveLength(0);
    }
  });

  it('treats an unknown expression child as possible text', () => {
    const src = `const A = () => <Pressable><Feather name="x" />{label}</Pressable>;`;
    expect(findUnlabeledIconOnlyPressables('a.tsx', src)).toHaveLength(0);
  });
});

describe('icon-only pressables in app/ and components/', () => {
  it('has no more unlabeled controls per file than the committed baseline', () => {
    const counts = currentCounts();
    if (process.env.A11Y_UPDATE_BASELINE) {
      fs.writeFileSync(BASELINE_PATH, JSON.stringify({ note: 'Per-file count of icon-only pressables without an accessibilityLabel. Only ever lower these numbers.', files: counts }, null, 2) + '\n');
      return;
    }
    const baseline = (JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { files: Record<string, number> }).files;
    const regressions = Object.entries(counts)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} unlabeled icon-only pressable(s), baseline ${baseline[file] ?? 0}`);
    expect(regressions, 'add accessibilityLabel to the new icon-only control').toEqual([]);
  });

  it('keeps the screens fixed in the accessibility PR at zero', () => {
    const counts = currentCounts();
    const fixed = [
      'app/(tabs)/feed.tsx', 'app/buyer-post-viewer.tsx', 'app/forgot-password.tsx', 'app/onboarding.tsx',
      'app/product-detail.tsx', 'app/edit-profile.tsx', 'app/seller-conversation.tsx', 'app/(buyer)/friends.tsx',
      'components/chat/MediaViewer.tsx', 'components/SupportChatBubble.tsx',
      'components/BrandthreadUI.tsx', 'components/ScreenHeader.tsx', 'components/SectionHeader.tsx',
    ];
    for (const file of fixed) expect(counts[file] ?? 0, file).toBe(0);
  });
});
