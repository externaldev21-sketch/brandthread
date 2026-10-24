/**
 * Creator program (seller + creator screens) behaviour pinned from source:
 * approval double-tap guard and un-nested row, confirm-before-remove with a
 * destructive button, validated settings with an unsaved-changes guard,
 * person-facing payout copy, paused-program sharing, and invite accept/decline
 * on the join screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('seller-creator-program', () => {
  const src = read('app/seller-creator-program.tsx');
  it('ignores repeat Approve taps and shows a pending label', () => {
    expect(src).toContain('approvingRef.current.has(id)');
    expect(src).toContain('loadingLabel="Approving…"');
    expect(src).toContain('friendlyError(');
  });
  it('keeps Approve outside the row button', () => {
    const row = src.slice(src.indexOf('visible.map((c) =>'));
    const openEnd = row.indexOf('</TouchableOpacity>');
    expect(row.indexOf('label="Approve"')).toBeGreaterThan(openEnd);
  });
});

describe('seller-creator-detail', () => {
  const src = read('app/seller-creator-detail.tsx');
  it('confirms Remove with a destructive alert instead of tap-again', () => {
    expect(src).not.toContain('Tap again to remove');
    expect(src).toMatch(/confirmAlert\(\{[\s\S]*destructive: true/);
    expect(src).toMatch(/label="Remove creator"\s+destructive/);
  });
  it('validates the rate and confirms a save', () => {
    expect(src).toContain('commissionError(rate, c.commissionPercent)');
    expect(src).toContain("rateSaved ? 'Saved' : 'Save rate'");
  });
});

describe('seller-creator-settings', () => {
  const src = read('app/seller-creator-settings.tsx');
  it('validates through the shared helper and guards unsaved edits', () => {
    expect(src).toContain('validateProgramSettings(');
    expect(src).toContain('useUnsavedChangesGuard(dirty)');
    expect(src).toContain('onBack={onBack}');
    expect(src).not.toMatch(/\.some\(\(v\) => v\.trim\(\)/);
  });
});

describe('creator-program', () => {
  const src = read('app/creator-program.tsx');
  it('never shows developer payout wording or the server reason', () => {
    expect(src).not.toContain('payout.reason');
    expect(src).toContain("Payouts aren't available yet. Your earnings are tracked and will be paid out once payouts open.");
    expect(read('lib/previewAffiliate.ts')).not.toMatch(/configured on this server/);
  });
  it('blocks sharing while the brand program is paused', () => {
    expect(src).toContain("Sharing is paused while the brand's program is paused.");
    expect(src).toContain('disabled={!b.programEnabled}');
    expect(src).toContain('disabled={!b.programEnabled || !b.shareLink}');
  });
  it('shows copy feedback on the tapped button', () => {
    expect(src).toContain("'Copied' : 'Copy code'");
    expect(src).toContain("'Copied' : 'Share link'");
    expect(src).not.toContain('copied`)');
  });
});

describe('creator-program-join', () => {
  const src = read('app/creator-program-join.tsx');
  it('offers Accept invite / Decline for an invited viewer', () => {
    expect(src).toContain("info.mine?.status === 'invited'");
    expect(src).toContain('label="Accept invite"');
    expect(src).toContain('api.affiliate.respondToInvite(info.mine.id, accept)');
  });
  it('shows action errors with the inline error style', () => {
    expect(src).toContain('<InlineError message={actionError}');
  });
});
