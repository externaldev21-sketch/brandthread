import { describe, expect, it } from 'vitest';
import {
  COMMENT_AUDIENCE_OPTIONS,
  DEFAULT_INTERACTION_SETTINGS,
  commentAudienceLabel,
  hiddenListChanged,
  peopleCountLabel,
} from './interactionSettings';

describe('interaction settings helpers', () => {
  it('matches the server defaults', () => {
    expect(DEFAULT_INTERACTION_SETTINGS).toEqual({ commentAudience: 'everyone', allowReposts: true, allowDownloads: true });
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
