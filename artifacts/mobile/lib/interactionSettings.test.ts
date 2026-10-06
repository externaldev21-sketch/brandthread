import { describe, expect, it } from 'vitest';
import {
  REMIX_AUDIENCE_OPTIONS,
  SUGGESTED_SNOOZE_DAYS,
  activeSnoozeUntil,
  applyInteractionPatch,
  pendingTagTitle,
  remixAudienceLabel,
  remixCreditLabel,
  snoozeLabel,
  COMMENT_AUDIENCE_OPTIONS,
  DEFAULT_INTERACTION_SETTINGS,
  commentAudienceLabel,
  hiddenListChanged,
  peopleCountLabel,
} from './interactionSettings';

describe('interaction settings helpers', () => {
  it('matches the server defaults', () => {
    expect(DEFAULT_INTERACTION_SETTINGS).toEqual({
      commentAudience: 'everyone', allowReposts: true, allowDownloads: true,
      manualTagApproval: false, remixAudience: 'everyone', suggestedSnoozedUntil: null,
    });
  });

  it('labels every comment audience the server accepts', () => {
    expect(COMMENT_AUDIENCE_OPTIONS.map(option => option.id)).toEqual(['everyone', 'following', 'nobody']);
    expect(commentAudienceLabel('everyone')).toBe('Everyone');
    expect(commentAudienceLabel('following')).toBe('People you follow');
    expect(commentAudienceLabel('nobody')).toBe('No one');
  });

  it('counts people', () => {
    expect(peopleCountLabel(0)).toBe('0 people');
    expect(peopleCountLabel(1)).toBe('1 person');
    expect(peopleCountLabel(12)).toBe('12 people');
    expect(peopleCountLabel(-3)).toBe('0 people');
    expect(peopleCountLabel(Number.NaN)).toBe('0 people');
  });

  it('detects changes to the hidden-story selection', () => {
    expect(hiddenListChanged(['a', 'b'], new Set(['b', 'a']))).toBe(false);
    expect(hiddenListChanged(['a'], new Set(['a', 'b']))).toBe(true);
    expect(hiddenListChanged(['a', 'b'], new Set(['a']))).toBe(true);
    expect(hiddenListChanged(['a'], new Set(['b']))).toBe(true);
    expect(hiddenListChanged([], [])).toBe(false);
  });
});

describe('tag approval, remix and snooze helpers', () => {
  const NOW = new Date(2026, 9, 6, 12, 0, 0);

  it('offers the remix audiences the server accepts', () => {
    expect(REMIX_AUDIENCE_OPTIONS.map(option => option.id)).toEqual(['everyone', 'following', 'off']);
    expect(remixAudienceLabel('everyone')).toBe('Everyone');
    expect(remixAudienceLabel('following')).toBe('People you follow');
    expect(remixAudienceLabel('off')).toBe('Off');
  });

  it('labels the snooze row Off or Until <date>', () => {
    expect(snoozeLabel(null, NOW)).toBe('Off');
    expect(snoozeLabel(new Date(2026, 9, 1).toISOString(), NOW)).toBe('Off');
    expect(snoozeLabel(new Date(2026, 10, 5, 12).toISOString(), NOW)).toBe('Until Nov 5');
    expect(snoozeLabel(new Date(2027, 0, 4, 12).toISOString(), NOW)).toBe('Until Jan 4, 2027');
    expect(activeSnoozeUntil('nonsense', NOW)).toBeNull();
  });

  it('applies a patch locally the way the server does (signed-out preview)', () => {
    const snoozed = applyInteractionPatch(DEFAULT_INTERACTION_SETTINGS, { snoozeSuggested: true, manualTagApproval: true }, NOW);
    expect(snoozed.manualTagApproval).toBe(true);
    expect(snoozed.suggestedSnoozedUntil).toBe(new Date(NOW.getTime() + SUGGESTED_SNOOZE_DAYS * 86_400_000).toISOString());
    expect(snoozeLabel(snoozed.suggestedSnoozedUntil, NOW)).toBe('Until Nov 5');
    expect(applyInteractionPatch(snoozed, { snoozeSuggested: false }, NOW).suggestedSnoozedUntil).toBeNull();
    expect(applyInteractionPatch(snoozed, { remixAudience: 'off' }, NOW).remixAudience).toBe('off');
    expect('snoozeSuggested' in applyInteractionPatch(snoozed, { snoozeSuggested: false }, NOW)).toBe(false);
  });

  it('titles pending tags by who tagged you and where', () => {
    expect(pendingTagTitle({ kind: 'post', authorUsername: 'maison', authorName: 'Maison' })).toBe('@maison tagged you in a post');
    expect(pendingTagTitle({ kind: 'story', authorUsername: null, authorName: 'Ana' })).toBe('Ana tagged you in their story');
    expect(pendingTagTitle({ kind: 'post', authorUsername: null, authorName: null })).toBe('Someone tagged you in a post');
  });

  it('credits a remix only when the source handle is known', () => {
    expect(remixCreditLabel({ username: 'maison' })).toBe('Remix of @maison');
    expect(remixCreditLabel({ username: '@maison' })).toBe('Remix of @maison');
    expect(remixCreditLabel({ username: null })).toBeNull();
    expect(remixCreditLabel(null)).toBeNull();
  });
});
