/**
 * Polish #80: no text below 11pt anywhere.
 *
 * Scans every app/ and components/ .tsx file for a literal `fontSize`
 * under 11 (comment lines ignored). Files listed in KNOWN_BELOW_FLOOR are
 * owned by other in-flight work (create flow, Design Studio, Messages,
 * community chats, Discover, Following feed, profile banner) and were
 * left alone so those PRs merge cleanly; remove an entry once its file is
 * at 11pt+. A new file below the floor fails this test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const MIN = 11;

const KNOWN_BELOW_FLOOR = new Set([
  'app/(tabs)/feed.tsx',
  'app/buyer-conversation.tsx',
  'app/buyer-story-create.tsx',
  'app/conversation-details.tsx',
  'app/design.tsx',
  'app/seller-conversation.tsx',
  'components/chat/ThemePickerSheet.tsx',
  'components/chat/VoiceMessageBubble.tsx',
  'components/chat/VoiceRecordingBar.tsx',
  'components/community-chat/CommunityMessageRow.tsx',
  'components/create-post/CarouselEditor.tsx',
  'components/create-post/CreateCamera.tsx',
  'components/create-post/GalleryPicker.tsx',
  'components/design-studio/BrushLibrary.tsx',
  'components/design-studio/CanvasHost.tsx',
  'components/design-studio/ColorPicker.tsx',
  'components/design-studio/LayersPanel.tsx',
  'components/discover/DiscoverPager.tsx',
  'components/profile/BrandHero.tsx',
  'components/profile/ProfileControls.tsx',
  'components/profile/ProfileVideoGrid.tsx',
  'components/search/VideoTile.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(full);
  }
  return out;
}

export function smallFontSizes(source: string): number[] {
  const hits: number[] = [];
  for (const line of source.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(code)) continue;
    for (const m of code.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b(?![.\d])/g)) {
      const size = Number(m[1]);
      if (size > 0 && size < MIN) hits.push(size);
    }
  }
  return hits;
}

describe('minimum text size (polish #80)', () => {
  it('detects sub-11 sizes and ignores comments', () => {
    expect(smallFontSizes('a: { fontSize: 10 },\n// was fontSize: 9\nb: { fontSize: 11 }')).toEqual([10]);
  });

  it('keeps every file outside the known list at 11pt or larger', () => {
    const offenders = walk(path.join(ROOT, 'app'))
      .concat(walk(path.join(ROOT, 'components')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !KNOWN_BELOW_FLOOR.has(rel))
      .filter((rel) => smallFontSizes(readFileSync(path.join(ROOT, rel), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
});
