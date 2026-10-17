import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Leftover from the grid redesign's own screenshot (Dev): the store avatar
 * in the Studio sheet header rendered as a plain grey filled circle
 * (theme.accentDim) — off-brand for an app whose whole palette is black,
 * white and silver only. Fixed to a black fill and a plain white initial,
 * matching the rest of the app's monochrome identity instead of a generic
 * accent-tinted circle. No ring around it: avatars are seamless everywhere
 * (Dev: "circle, seamless picture cuts off on the circle").
 */
describe('Seller Studio sheet header avatar is black/white/silver, not a grey filled circle', () => {
  it('fills with the theme background (black), not accentDim (grey)', () => {
    const avatarBlock = studio.slice(studio.indexOf('avatar: {'), studio.indexOf('avatar: {') + 300);
    const block = avatarBlock.slice(0, avatarBlock.indexOf('},'));
    expect(block).toContain('backgroundColor: theme.background');
    expect(block).not.toContain('theme.accentDim');
  });

  it('is seamless: no ring or border around it', () => {
    const avatarBlock = studio.slice(studio.indexOf('avatar: {'), studio.indexOf('avatar: {') + 300);
    const block = avatarBlock.slice(0, avatarBlock.indexOf('},'));
    expect(block).not.toContain('borderWidth');
    expect(block).not.toContain('borderColor');
  });

  it('the initial letter is plain white text, not accent-tinted', () => {
    expect(studio).toContain("avatarLetter: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text }");
  });
});
