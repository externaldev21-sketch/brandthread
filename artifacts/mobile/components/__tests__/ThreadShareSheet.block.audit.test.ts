/**
 * Audit regression: the share sheet's Block action (App Store 1.2 moderation,
 * added in bd27679f) was lost when that branch was merged over the rewritten
 * sheet — `onBlock` was still accepted and passed by the feed, but nothing
 * rendered it, so the feed's "..." sheet offered no way to block the author.
 *
 * Source-structure test: the sheet's runtime deps (Sheet, contact picker,
 * expo-file-system, clerk) make a full render impractical in this shim env.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/ThreadShareSheet.tsx'), 'utf8');

describe('ThreadShareSheet — Block action', () => {
  it('renders a Block action in the moderation row when onBlock is supplied', () => {
    const report = source.indexOf('<ShareAction label="Report"');
    const block = source.indexOf('<ShareAction label="Block"');
    expect(report).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(report);
    // Gated on the prop (omitted for the viewer's own posts).
    expect(source.slice(report, block)).toContain('{onBlock ? (');
  });

  it('closes the sheet, then hands off to the caller’s block flow', () => {
    const block = source.indexOf('<ShareAction label="Block"');
    expect(source.slice(block, block + 160)).toContain('onPress={() => { onClose(); onBlock(); }}');
  });
});
