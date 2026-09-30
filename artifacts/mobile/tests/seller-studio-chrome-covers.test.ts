import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Checkpoint pass: Dev rejected the icon-on-gradient covers as cheap and
 * asked for real "dark studio, chrome hero object" cover art per card, with
 * an explicit gate — "before building all 16, send me 3 finished covers...
 * I'll review them before you do the rest." These tests cover only the
 * three checkpoint cards; the other 13 stay on the plain StudioCoverBackdrop
 * (see components/StudioCoverHeroArt.tsx's own header for why).
 */
const art = readFileSync(resolve(process.cwd(), 'components/StudioCoverHeroArt.tsx'), 'utf8');

describe('StudioCoverHeroArt: 3-card chrome cover checkpoint', () => {
  it('exposes exactly the 3 checkpoint ids Dev asked for, and nothing else yet', () => {
    expect(art).toContain("'add-product': AddProductChromeCover");
    expect(art).toContain("'go-live': GoLiveChromeCover");
    expect(art).toContain("'payouts': PayoutsChromeCover");
  });

  it('getCoverHeroArt returns null for ids outside the checkpoint (the other 13 cards are untouched)', () => {
    expect(art).toContain('export function getCoverHeroArt(itemId: string): React.ComponentType | null {');
    expect(art).toContain('return COVER_HERO_ART[itemId] ?? null;');
  });

  it('go-live keeps exactly one red light and it belongs to the camera housing, not a floating badge', () => {
    const goLive = art.slice(art.indexOf('function GoLiveChromeCover'), art.indexOf('/** Payouts'));
    const redMatches = goLive.match(/#ff3b30/g) ?? [];
    expect(redMatches.length).toBeGreaterThan(0);
    expect(redMatches.length).toBeLessThanOrEqual(2); // the lit dot + its soft glow ring, nothing more
  });

  it('is code-drawn (react-native-svg gradients), never a bundled bitmap asset — no image-gen tool is available in this environment', () => {
    expect(art).not.toMatch(/require\(.*\.(png|jpg|jpeg|webp)['"]\)/);
    expect(art).toContain("from 'react-native-svg'");
  });

  it('uses only white/black/silver-token/LIVE-red — no new hardcoded dark greys (see no-hardcoded-grey-lint)', () => {
    const HEX_GREY = /#(0[Aa-fA-F]|1[0-9A-Fa-f]|2[0-9A-Fa-f]|3[0-9Aa])\1\1\b/;
    const offendingLines = art.split('\n').filter((line) => HEX_GREY.test(line));
    expect(offendingLines).toEqual([]);
  });

  it('leaves motion (parallax/sweep/dwell animation) deliberately out for now, per the checkpoint gate', () => {
    expect(art).toContain('deliberately');
  });
});
