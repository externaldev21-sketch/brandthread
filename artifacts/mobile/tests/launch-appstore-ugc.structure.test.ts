/**
 * App Review Guideline 1.2 (user-generated content): every LIVE surface lets
 * a viewer report the stream and block the host, and sample data never
 * reaches a production deep link. Structure tests, the repo's convention for
 * screens that need native/Expo modules to render.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('LIVE swipe feed (app/live-feed.tsx)', () => {
  const src = read('app/live-feed.tsx');
  const sheet = read('components/live/LiveMoreSheet.tsx');

  it('reports a real room through the shared report sheet, not a toast', () => {
    expect(src).toContain("targetType: 'live'");
    expect(src).toMatch(/openReport\(\{[\s\S]*?targetId: room\.streamId/);
    expect(src).not.toContain("showToast('Thanks for the report. Our team will review this live.'");
  });

  it('offers Block for the host of a real room and hides the room afterwards', () => {
    expect(src).toMatch(/confirmBlock\(\{ userId: room\.sellerId, name: room\.brandName \}, api\.social\.block\)/);
    expect(src).toContain('onBlock={room.isSample || !room.sellerId ? undefined : handleBlock}');
    expect(sheet).toContain('{onBlock ? <Row icon="slash" label={blockLabel}');
  });
});

describe('LIVE replay (app/live-replay.tsx)', () => {
  const src = read('app/live-replay.tsx');

  it('gives non-owners a ••• menu with Report replay and Block host', () => {
    expect(src).toContain("actions={replay && !replay.isOwner ? [{ icon: 'more-horizontal'");
    expect(src).toContain("text: 'Report replay'");
    expect(src).toContain("text: 'Block host'");
    expect(src).toContain('api.social.block');
  });

  it('offers Try again when the replay failed to load', () => {
    expect(src).toContain("action={error === 'network' ? { label: 'Try again'");
  });
});

describe('LIVE co-host sample data', () => {
  it.each(['app/live-cohost.tsx', 'app/live-cohost-invite.tsx'])('%s only shows samples inside the dev preview', (file) => {
    expect(read(file)).toContain("const demo = params.demo === '1' && isPreviewDemoMode();");
  });
});
