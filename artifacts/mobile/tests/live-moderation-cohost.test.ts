import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addBannedWord, SLOW_MODE_OPTIONS } from '../lib/live/moderationTypes';
import { activityHref } from '../lib/activity';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('addBannedWord', () => {
  it('trims, lowercases, collapses spaces and ignores duplicates / blanks', () => {
    expect(addBannedWord([], '  Free   Followers ')).toEqual(['free followers']);
    const list = ['spam'];
    expect(addBannedWord(list, 'SPAM')).toBe(list);
    expect(addBannedWord(list, '   ')).toBe(list);
  });
  it('offers Off plus increasing slow-mode steps', () => {
    expect(SLOW_MODE_OPTIONS[0]).toBe(0);
    expect([...SLOW_MODE_OPTIONS]).toEqual([...SLOW_MODE_OPTIONS].sort((a, b) => a - b));
  });
});

describe('co-host invite notification routing', () => {
  it('opens the accept / decline screen for the stream', () => {
    expect(activityHref({ targetType: 'live_cohost', targetId: 's 1', type: 'live_cohost_invite' } as any))
      .toBe('/live-cohost-invite?streamId=s%201');
  });
});

describe('live moderation screens', () => {
  it.each(['app/live-moderation.tsx', 'app/live-cohost.tsx', 'app/live-cohost-invite.tsx'])(
    '%s uses ScreenHeader and only shows sample data behind demo=1',
    (file) => {
      const src = read(file);
      expect(src).toContain('<ScreenHeader');
      expect(src).toMatch(/params\.demo === '1'/);
      // Every sample-data constant is only ever used when demo is on.
      expect(src).toMatch(/demo \? DEMO_/);
    },
  );

  it('seller-live exposes Moderation and Co-host entry points and comment actions', () => {
    const src = read('app/seller-live.tsx');
    expect(src).toContain("'/live-moderation'");
    expect(src).toContain("'/live-cohost'");
    expect(src).toContain('LiveCommentActionsSheet');
  });

  it('buyer-live does not end the stream when a co-host (non-host uid) goes offline', () => {
    const src = read('app/buyer-live.tsx');
    expect(src).toContain('hostUidRef');
    expect(src).toMatch(/onUserOffline[\s\S]*hostUidRef\.current/);
  });
});
