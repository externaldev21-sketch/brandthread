/**
 * Privacy & social screens (audit: docs/audit/buyer-settings.md) — source
 * structure checks for the Privacy, Blocked & muted and Follow requests fixes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('Privacy (buyer-privacy-settings)', () => {
  const src = read('app/buyer-privacy-settings.tsx');

  it('has exactly one read-receipts control', () => {
    expect(src.match(/title="Read receipts"/g)).toHaveLength(1);
  });

  it('shows "50+" when the follow-request badge hits the page cap', () => {
    expect(src).toContain('const FOLLOW_REQUEST_CAP = 50;');
    expect(src).toContain('api.followRequests.list(FOLLOW_REQUEST_CAP, 0)');
    expect(src).toMatch(/count >= cap \? `\$\{cap\}\+`/);
  });

  it('shows the Private account row only once the server allows it (fails closed)', () => {
    expect(src).toContain('setCanBePrivate(server.canBePrivate)');
    expect(src).toContain('const showPrivateRow = canBePrivate === true || serverPrivate === true;');
    expect(src).toMatch(/\{showPrivateRow \? \(/);
  });

  it('shows the server reason when Private account is refused, and never rolls back a saved change for a cache write', () => {
    expect(src).toContain(`setSaveError(friendlyError(err, "Couldn't update your account privacy. Try again."));`);
    expect(src).toContain("await cachePrivacySettings({ profileVisibility: value ? 'private' : 'public' });");
    expect(src).not.toMatch(/updatePrivacySettings\(\{ profileVisibility/);
  });

  it('reads every server-held choice from /api/auth/privacy and saves them there in one write', () => {
    expect(src).toContain('const value = server?.settings?.[key];');
    expect(src).toMatch(/await api\.privacy\.update\(\{\s*dmPrivacy, readReceipts: settings\.readReceiptsEnabled, showActivityStatus: settings\.activityStatusVisible, settings: serverSettings,/);
  });

  it('labels the followers-only DM option "People you follow"', () => {
    expect(src).not.toContain("'Followers only'");
    expect(src.match(/People you follow'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('stays on the screen when the back-save fails', () => {
    expect(src).toMatch(/const ok = await saveSettings\(false\);\s*if \(!ok\) \{ backSaveFailed\.current = true; return; \}/);
  });

  it('pads the scroll for the bottom safe area and survives a failed local load', () => {
    expect(src).toContain('paddingBottom: SP.xxl + insets.bottom');
    expect(src).toContain('getPrivacySettings().catch(() => ({ ...DEFAULT_PRIVACY_SETTINGS }))');
  });
});

describe('Blocked & muted (buyer-blocked)', () => {
  const src = read('app/buyer-blocked.tsx');

  it('shows a Retry error instead of "No muted accounts" when the muted list fails', () => {
    expect(src).toContain('setMutedError(friendlyError(m.reason');
    expect(src).toContain('ListEmptyComponent={!mutedError ? (');
  });

  it('confirms before unmuting, like Muted accounts', () => {
    expect(src).toMatch(/await confirmAlert\(\{\s*title: 'Unmute'/);
    expect(src).toContain("cancelLabel: 'Keep muted'");
  });

  it('has pull-to-refresh on both tabs', () => {
    expect(src.match(/refreshControl=\{<ThemedRefreshControl/g)).toHaveLength(2);
  });
});

describe('Follow requests (buyer-friend-requests)', () => {
  const src = read('app/buyer-friend-requests.tsx');

  it('titles the screen like the entry rows', () => {
    expect(src).toContain('title="Follow requests"');
    expect(src).not.toContain('title="Connections"');
  });

  it('persists Dismiss server-side and reverts on failure', () => {
    expect(src).toContain('await api.social.dismissFollower(row.userId)');
    expect(src).toContain('!f.followBackDismissed');
    expect(src).toContain("showAlert('Couldn’t dismiss'");
  });

  it('awaits Block, reports the result and drops the row', () => {
    expect(src).toMatch(/await blockUser\(/);
    expect(src).toContain("showAlert('Couldn’t block'");
    expect(src).toContain("onPress: () => { void handleBlock(row); }");
  });

  it('tracks the pending action per row so Delete and Confirm spin separately', () => {
    expect(src).toContain("loading={isPending(row.userId, 'decline')}");
    expect(src).toContain("loading={isPending(row.userId, 'approve')}");
  });

  it('uses sentence-title alerts with friendly messages only', () => {
    expect(src).not.toMatch(/Alert\.alert\(/);
    expect(src).not.toMatch(/showAlert\('Error'/);
  });
});

describe('client', () => {
  it('exposes the follower dismiss endpoint', () => {
    expect(read('lib/api.ts')).toContain('`/api/social/followers/${encodeURIComponent(userId)}/dismiss`');
  });
});
