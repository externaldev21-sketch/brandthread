import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Guards against the "plain white outline ring" bug: a hard, full-opacity
 * white/near-white ring appearing around a pressed/focused control, drawn
 * OUTSIDE its own box so it can visually touch a neighboring control in a
 * tightly packed row (e.g. the profile tabs). Two independent sources of
 * this were found and fixed:
 *   1. app/+html.tsx's default web :focus-visible style used a fixed
 *      rgba(255,255,255,0.85) `outline` with a positive offset (outside the
 *      box, ignores border-radius).
 *   2. components/profile/ProfileControls.tsx's InteractionLayer drew a
 *      solid 2px border in theme.accent for the focused state — on the
 *      monochrome theme (the app default) theme.accent is near-white
 *      (#F7F7FA), so it read as the same plain white ring.
 */
describe('no outer white focus/press ring', () => {
  it('draws the web keyboard-focus glow inside the box (box-shadow), never an outside outline', () => {
    const html = read('app/+html.tsx');
    expect(html).toContain('outline: none;');
    expect(html).toContain('box-shadow: inset 0 0 0 2px var(--bt-accent');
    // The old bug: a fixed white outline with a positive (outside) offset.
    expect(html).not.toMatch(/outline:\s*2px solid rgba\(255,\s*255,\s*255/);
    expect(html).not.toContain('outline-offset: 2px');
  });

  it('wires the web focus glow color to the active theme, not a fixed value', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("document.documentElement.style.setProperty('--bt-accent'");
    expect(layout).toContain('theme.accent');
  });

  it('gives ProfileControls a soft, theme-tinted focus/press wash instead of a hard border ring', () => {
    const controls = read('components/profile/ProfileControls.tsx');
    // Old bug: `borderWidth: 2, borderColor: theme.accent` at full opacity.
    expect(controls).not.toMatch(/borderWidth:\s*2,\s*borderColor:\s*theme\.accent\s*\}/);
    expect(controls).toContain('state.pressed');
    expect(controls).toMatch(/theme\.accent\}(1F|22|33|2E|55)/);
  });

  it('gives shared Pressable-based components a themed Android ripple instead of the OS default', () => {
    expect(read('components/ui/Button.tsx')).toContain('android_ripple=');
    expect(read('components/ui/IconButton.tsx')).toContain('android_ripple=');
    expect(read('components/BrandthreadUI.tsx')).toContain('android_ripple=');
  });

  it('gives the profile tabs an animated sliding indicator instead of a static per-tab mark', () => {
    const controls = read('components/profile/ProfileControls.tsx');
    expect(controls).toContain('tabIndicator');
    expect(controls).toMatch(/Animated\.spring\(indicatorX/);
  });
});
