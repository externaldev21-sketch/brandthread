import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Dev, "DEV CLARIFIED — supersedes my previous message about the menu
 * header": header content is ONLY the seller's profile picture (including
 * animated, muted + looped) and their real name (store name, else display
 * name/@handle) — no subtitle of any kind, no "View store" pill, no close
 * (X) button. Closing is swipe-down / Android back / the tab bar toggle —
 * see seller-studio-tab-toggle.test.ts and
 * seller-studio-menu-swipe-dismiss.test.ts.
 */
describe('Studio header: avatar + name only, nothing else', () => {
  it('has no View-store pill and no close (X) button', () => {
    expect(studio).not.toContain('accessibilityLabel="View store"');
    expect(studio).not.toContain("router.push('/store-preview'");
    expect(studio).not.toContain('accessibilityLabel="Close Studio tools"');
    expect(studio).not.toContain('testID="seller-studio-menu-close"');
  });

  it('has no subtitle of any kind — no "Set store name" link, no setup progress bar', () => {
    expect(studio).not.toContain('Set store name');
    expect(studio).not.toContain('setupBarTrack');
    expect(studio).not.toContain('setupBarFill');
  });

  it('the header row carries testID="seller-studio-header" (used by e2e/studio-header-text-fit.spec.ts to scope its scan)', () => {
    expect(studio).toContain('testID="seller-studio-header"');
  });

  it('the header row is exactly avatar + a single name Text, nothing else', () => {
    const headerBlock = studio.slice(studio.indexOf('testID="seller-studio-header"'), studio.indexOf('</GestureDetector>', studio.indexOf('testID="seller-studio-header"')));
    expect(headerBlock).toContain('<View style={styles.avatar}>');
    expect(headerBlock).toContain('<View style={styles.headerTextBlock}>');
    expect(headerBlock).toContain('styles.storeName');
    // Only the avatar's own monogram fallback and the name itself — nothing
    // else in the whole header block.
    const textBlock = headerBlock.slice(headerBlock.indexOf('<View style={styles.headerTextBlock}>'));
    const textCount = (textBlock.match(/<Text\b/g) ?? []).length;
    expect(textCount).toBe(1);
  });

  it('prioritizes an animated (muted, looped) avatar over the static photo, monogram, or generic icon fallback', () => {
    const avatarBlock = studio.slice(studio.indexOf('<View style={styles.avatar}>'), studio.indexOf('</View>', studio.indexOf('<View style={styles.avatar}>')));
    expect(avatarBlock).toContain('avatarVideoUrl ? (');
    expect(avatarBlock).toContain('<HeaderAvatarVideo uri={avatarVideoUrl} />');
    expect(avatarBlock.indexOf('avatarVideoUrl ? (')).toBeLessThan(avatarBlock.indexOf('avatarUrl ? ('));
    expect(avatarBlock).toContain('headerMonogram ? (');
    expect(avatarBlock).toContain('Feather name="shopping-bag"');
  });

  it('HeaderAvatarVideo autoplays muted and looped, like ProfileStoryAvatar\'s own AvatarVideo', () => {
    const fnBody = studio.slice(studio.indexOf('function HeaderAvatarVideo'), studio.indexOf('// ─── Component'));
    expect(fnBody).toContain('useVideoPlayer');
    expect(fnBody).toContain('p.loop = true;');
    expect(fnBody).toContain('p.muted = true;');
    expect(fnBody).toContain('p.play();');
    expect(fnBody).toContain('<VideoView');
  });

  it('the name falls back to display name, else "@handle" — never blank, never the old bare placeholder as anything but the true last resort', () => {
    expect(studio).toContain("setAccountName(profile?.displayName?.trim() || (profile?.username ? `@${profile.username}` : null));");
    expect(studio).toContain("const headerTitle = hasStoreName ? brandName!.trim() : (accountName?.trim() || null);");
    expect(studio).toContain('{headerTitle ?? \'Your store\'}');
  });

  it('fetches the avatar video alongside the rest of the header profile data', () => {
    expect(studio).toContain('api.avatarVideo.get()');
    expect(studio).toContain('setAvatarVideoUrl(res?.avatarVideoUrl ?? null)');
  });
});

/**
 * Dev: "remove the separate black band at the top — the menu's own
 * background must run seamlessly all the way to the top edge of the screen
 * (behind the status bar/notch — background colour only; no actual content
 * under the notch). No colour step between the status-bar area and the
 * header." The app-wide StatusBar (app/_layout.tsx) paints the Android
 * status bar with the current theme's ordinary background colour, which is
 * NOT this page's pure black — so this page overrides it back to black
 * while open, and iOS's translucent status bar already shows this page's
 * own background straight through.
 */
describe('Studio page: seamless black background under the status bar/notch', () => {
  it('overrides the Android status bar to pure black while this page is open', () => {
    expect(studio).toContain("import {\n  Image,\n  Modal,\n  Pressable,\n  StatusBar,");
    expect(studio).toContain('<StatusBar backgroundColor="#000000" barStyle="light-content" animated />');
  });

  it('the page background itself is still pure black regardless of theme, covering the full screen from y=0', () => {
    const pageStyleBlock = studio.slice(studio.indexOf('page: {', studio.indexOf('const makeStyles')), studio.indexOf('header: {', studio.indexOf('const makeStyles')));
    expect(pageStyleBlock).toContain("backgroundColor: '#000000'");
    expect(pageStyleBlock).toContain('top: 0');
  });
});
