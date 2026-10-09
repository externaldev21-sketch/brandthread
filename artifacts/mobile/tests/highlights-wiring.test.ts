/**
 * Structural wiring checks for the highlights feature (the other-profile row
 * and the viewer mode can't be rendered in the dev preview: there is no seeded
 * "other person" / backend there).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('highlights wiring', () => {
  it("the visitor profile shows a highlights row only when there are visible highlights, and opens the viewer with highlightId", () => {
    const src = read('app/buyer-other-profile.tsx');
    expect(src).toContain('api.social.userHighlights(resolvedId)');
    expect(src).toMatch(/extras=\{highlights\.length > 0 && !iBlockedThem/);
    expect(src).toMatch(/pathname: '\/buyer-story-viewer'[\s\S]{0,80}params: \{ highlightId: item\.id \}/);
    // a failed highlights read must never fail the profile load
    expect(src).toMatch(/catch \{\s*setHighlights\(\[\]\)/);
  });

  it('the story viewer plays a highlight without like / view / reply side effects', () => {
    const src = read('app/buyer-story-viewer.tsx');
    expect(src).toContain('api.social.highlight(String(highlightId))');
    expect(src).toMatch(/if \(storyId && !highlightId\)/); // no view tracking on highlight items
    expect(src).toContain('isHighlight ? null');
  });

  it('the manager reaches Select stories from its create and edit sheets, and the screen is routed', () => {
    const manager = read('app/buyer-highlights-manager.tsx');
    expect(manager.match(/onSelectStories=/g)?.length).toBe(2);
    expect(manager).toContain('/buyer-highlight-stories?highlightId=');
    expect(read('app/_layout.tsx')).toContain('name="buyer-highlight-stories"');
    expect(read('scripts/audit/route-ownership.json')).toContain('/buyer-highlight-stories');
  });
});
