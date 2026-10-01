import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeMentionQuery, insertMentionHandle, parseMentionSegments } from '../lib/commentMentions';

const mayac = { userId: 'u1', handle: 'mayac' };
const ruth = { userId: 'u2', handle: 'ruth_a' };

describe('parseMentionSegments', () => {
  it('returns plain text when there are no verified mentions', () => {
    expect(parseMentionSegments('hi @someone', [])).toEqual([{ type: 'text', text: 'hi @someone' }]);
    expect(parseMentionSegments('hi @someone', undefined)).toEqual([{ type: 'text', text: 'hi @someone' }]);
  });

  it('splits verified handles into tappable segments, case-insensitively', () => {
    expect(parseMentionSegments('thanks @MayaC for this', [mayac])).toEqual([
      { type: 'text', text: 'thanks ' },
      { type: 'mention', text: '@MayaC', userId: 'u1', handle: 'mayac' },
      { type: 'text', text: ' for this' },
    ]);
  });

  it('handles several mentions, underscores, start of string and trailing punctuation', () => {
    const segments = parseMentionSegments('@mayac and @ruth_a!', [mayac, ruth]);
    expect(segments.filter((s) => s.type === 'mention').map((s) => s.text)).toEqual(['@mayac', '@ruth_a']);
    expect(segments.map((s) => s.text).join('')).toBe('@mayac and @ruth_a!');
  });

  it('leaves unverified handles and emails as text', () => {
    const segments = parseMentionSegments('mail me at a@mayac.com or @nobody', [mayac]);
    expect(segments).toEqual([{ type: 'text', text: 'mail me at a@mayac.com or @nobody' }]);
  });

  it('never drops or duplicates characters', () => {
    const body = 'x @mayac\n@mayac, @ruth_a. end';
    expect(parseMentionSegments(body, [mayac, ruth]).map((s) => s.text).join('')).toBe(body);
  });
});

describe('composer @token helpers', () => {
  it('detects an active trailing token only', () => {
    expect(activeMentionQuery('hello @ma')).toBe('ma');
    expect(activeMentionQuery('@')).toBe('');
    expect(activeMentionQuery('hello @ma ')).toBeNull();
    expect(activeMentionQuery('mail a@ma')).toBeNull();
    expect(activeMentionQuery('hello')).toBeNull();
  });

  it('inserts the picked handle in place of the partial', () => {
    expect(insertMentionHandle('hello @ma', 'mayac')).toBe('hello @mayac ');
    expect(insertMentionHandle('@', '@ruth_a')).toBe('@ruth_a ');
  });
});

describe('comments screen wiring', () => {
  const screen = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
  it('uses MentionText, the shared suggestions bar and the pin action additively', () => {
    expect(screen).toContain('<MentionText');
    expect(screen).toContain('<MentionSuggestionsBar');
    expect(screen).toContain('Pin comment');
    expect(screen).toContain('testID="comment-pinned-label"');
  });
  it('pin never calls the API for preview posts', () => {
    const handler = screen.slice(screen.indexOf('const handleTogglePin'), screen.indexOf('const handlePressMention'));
    expect(handler.indexOf('if (isPreviewPost)')).toBeLessThan(handler.indexOf('api.comments.pin'));
  });
});
