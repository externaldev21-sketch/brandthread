/**
 * Story stickers: countdown maths and wiring checks (the editor needs a camera
 * and the viewer needs a backend, so the rendered states are verified in the
 * dev preview screenshots; see the PR).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  StyleSheet: { create: (s: unknown) => s },
  View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: 'CachedImage' }));

import { countdownParts } from '@/components/social/StoryStickers';

const read = (rel: string) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('countdownParts', () => {
  it('splits a duration into days / hours / minutes / seconds', () => {
    expect(countdownParts(2 * 86400e3 + 3 * 3600e3 + 12 * 60e3 + 9e3)).toEqual({ days: 2, hours: 3, minutes: 12, seconds: 9 });
    expect(countdownParts(59_999)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 59 });
  });
  it('never goes negative once the drop has launched', () => {
    expect(countdownParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('sticker wiring', () => {
  it('the editor tray opens composers for poll / question / countdown and keeps the existing tiles', () => {
    const src = read('app/buyer-story-create.tsx');
    for (const label of ['Mention', 'Location', 'Time', 'Poll', 'Question', 'Link', 'Product', 'Shop link', 'Thread Cash', 'Countdown']) {
      expect(src).toContain(`label="${label}"`);
    }
    expect(src).toContain('setPollComposerOpen(true)');
    expect(src).toContain('setQuestionComposerOpen(true)');
    expect(src).toMatch(/isSeller \? \(\s*<StickerTile icon="clock" label="Countdown"/); // sellers only
    expect(src).toMatch(/type: 'product',\s*x: [^\n]+\s*productId: p\.id/); // the product sticker carries productId
    expect(src).toMatch(/type: 'countdown'[^\n]+dropId: drop\.id/);
  });

  it('the viewer renders the interactive layer and reuses the existing drop alert + product / drop routes', () => {
    const src = read('app/buyer-story-viewer.tsx');
    expect(src).toContain('<ViewerStickerLayer');
    expect(src).toContain('api.publicDrops.subscribe(dropId)');
    expect(src).toContain('/thread-product-detail?productId=');
    expect(src).toContain('/buyer-drop-detail?dropId=');
    expect(src).toContain('api.social.pollVote');
    expect(src).toContain('api.social.questionAnswer(');
  });

  it('overlay types include the countdown sticker', () => {
    expect(read('services/socialTypes.ts')).toMatch(/\| 'countdown'/);
  });
});
