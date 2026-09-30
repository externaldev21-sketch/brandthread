import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');
const cover = readFileSync(resolve(process.cwd(), 'components/StudioCardCover.tsx'), 'utf8');

/**
 * Dev's "cover art" pass: every one of the 16 cards gets its own full-bleed
 * "album cover" backdrop instead of a plain icon on the sheet's own
 * background — built entirely from gradients/vector shapes in code (no
 * bitmap assets, no licensing risk), sharing one art direction (monochrome
 * black/white/silver, a soft radial glow, a seeded grain pattern) so all 16
 * read as one series.
 */
describe('Studio card covers: one shared "album cover" art direction, built in code', () => {
  it('every card renders its own StudioCoverBackdrop behind the icon/name', () => {
    expect(studio).toContain("from '@/components/StudioCardCover'");
    expect(studio).toContain('<StudioCoverBackdrop />');
  });

  it('the cover backdrop is a diagonal black gradient + a soft silver radial glow — monochrome only', () => {
    expect(cover).toContain("from 'expo-linear-gradient'");
    expect(cover).toContain("colors={['#050505', '#161616', '#000000']}");
    expect(cover).toContain('RadialGradient');
    expect(cover).toContain('stopColor="#ffffff"');
    // No bitmap image assets — everything is a gradient/vector composition.
    expect(cover).not.toContain('require(');
    expect(cover).not.toMatch(/<Image\b/);
  });

  it('the grain is a seeded (deterministic) pattern computed once at module load, not Math.random() re-shuffling per render', () => {
    expect(cover).toContain('function mulberry32');
    // Computed once, outside any component function, as a module constant —
    // the actual dot-generation logic uses the seeded generator, never
    // Math.random() (which the file's own comment explains it avoids).
    const grainBlock = cover.slice(cover.indexOf('const GRAIN_DOTS = (() => {'), cover.indexOf('})();'));
    expect(grainBlock).not.toContain('Math.random()');
    expect(grainBlock).toContain('mulberry32(20260930)');
  });

  it('the grain overlay is shared ONCE across the whole card area, not duplicated per card', () => {
    const cardAreaBlock = studio.slice(studio.indexOf('testID="seller-studio-card-area"'), studio.indexOf('</GestureDetector>', studio.indexOf('testID="seller-studio-card-area"')));
    const grainOccurrences = cardAreaBlock.match(/<StudioCoverGrain \/>/g) ?? [];
    expect(grainOccurrences.length).toBe(1);
  });
});

/**
 * Dev, firm (overriding an earlier "dimmed slivers" note): at rest, NOTHING
 * from the previous/next card may be visible — the current cover fills the
 * carousel edge to edge. A neighbor only ever exists visually during the
 * ~90ms transition between cards.
 */
describe('Studio card covers: zero neighbor peek at rest', () => {
  it('cardSpacing is the MEASURED card-area width itself (not a fraction of screen width), so cards tile with zero gap and zero overlap', () => {
    expect(studio).toContain('const cardSpacing = cardAreaSize.width;');
    expect(studio).not.toContain('CARD_SPACING_RATIO');
  });

  it('each card is sized to the exact measured card-area dimensions, not a percentage/fraction "poster" box', () => {
    expect(studio).toContain('style={[styles.card, { width: cardAreaSize.width, height: cardAreaSize.height }, cardStyle]}');
  });

  it('a card fully fades out by the time it is one full card-width away (i.e. exactly adjacent, never partially overlapping at rest)', () => {
    const cardStyleBlock = studio.slice(studio.indexOf('const cardStyle = useAnimatedStyle'), studio.indexOf('const contentStyle = useAnimatedStyle'));
    expect(cardStyleBlock).toContain('interpolate(absDistance, [0, 1], [1, 0], Extrapolation.CLAMP)');
  });
});

/**
 * Dev: every cover subject gets its own one-shot signature micro-animation,
 * NEVER looping, playing the moment its card becomes current — a tiny
 * 100ms scale-pop while scrubbing fast, or the full ~350-450ms motion once
 * the finger slows/dwells (and again on lock). Built entirely from
 * transforms/opacity on the existing icon (plus, for go-live, a small extra
 * dot + sweep) — no bespoke illustration needed per subject.
 */
describe('Studio card covers: per-card one-shot signature micro-animations', () => {
  it('maps every one of the 16 cards to its own named motion kind', () => {
    const expectedKinds: Record<string, string> = {
      'add-product': 'swing',
      'go-live': 'pulse-dot',
      'analytics': 'rise',
      'payouts': 'flip',
      'community': 'pop-in',
      'taxes': 'rotate-notch',
      'content': 'slide-click',
      'finance': 'pie-pop',
      'manufacturer': 'turn-60',
      'customers': 'nudge',
      'design-studio': 'draw-stroke',
      'mockup-to-model': 'fade-outline',
      'remove-bg': 'snip',
      'ai-design': 'twinkle',
      'campaign-gen': 'target-pulse',
      'ai-photoshoot': 'blink',
    };
    Object.entries(expectedKinds).forEach(([id, kind]) => {
      expect(studio, `${id} should map to '${kind}'`).toMatch(new RegExp(`'${id}':\\s*'${kind}'`));
    });
  });

  it('never loops — every keyframe sequence is a finite withSequence/withTiming, never withRepeat', () => {
    expect(studio).toContain('withSequence');
    expect(studio).not.toContain('withRepeat');
  });

  it('is speed-aware: a fast scrub (< MICRO_DWELL_MS per card) only gets a tiny scale-pop, never the full signature motion', () => {
    expect(studio).toContain('const MICRO_DWELL_MS = 120;');
    expect(studio).toContain('microFast.value = elapsed < MICRO_DWELL_MS;');
    const reactionBody = studio.slice(studio.indexOf('useAnimatedReaction(\n      () => (microTriggerIndex.value === itemIndex'));
    const fastBlock = reactionBody.slice(reactionBody.indexOf('if (microFast.value) {'), reactionBody.indexOf('switch (microKind)'));
    expect(fastBlock).toContain('withTiming(1.06,');
    expect(fastBlock).toContain('return;');
  });

  it('a lock always forces the FULL signature animation, never the fast-pop, even if the preceding scrub was fast', () => {
    const horizontalBranch = studio.slice(studio.indexOf("cardGestureAxis.value === 'horizontal') {"));
    expect(horizontalBranch).toContain('microFast.value = false;');
  });

  it('respects Reduce Motion with a fade only — never a transform — for the micro-animation specifically', () => {
    const reactionBody = studio.slice(studio.indexOf('useAnimatedReaction(\n      () => (microTriggerIndex.value === itemIndex'));
    const reduceBlock = reactionBody.slice(reactionBody.indexOf('if (reduceMotion) {'), reactionBody.indexOf('if (microFast.value)'));
    expect(reduceBlock).toContain('microOpacity.value = 0.5;');
    expect(reduceBlock).toContain('microOpacity.value = withTiming(1,');
    expect(reduceBlock).not.toMatch(/micro(Scale|Rotate|TranslateX|TranslateY)\.value\s*=\s*withSequence/);
  });

  it('go-live gets its own extra dot-pulse + sweep, rendered only for that one item', () => {
    expect(studio).toContain("item.id === 'go-live'");
    expect(studio).toContain('liveDotScale');
    expect(studio).toContain('liveSweepProgress');
    expect(studio).toContain('styles.liveDot');
    expect(studio).toContain('styles.liveSweep');
  });
});

/**
 * Dev's FINAL layout call: a full-screen page (not a 75% sheet), header
 * with real profile photo/store name, compact View-store, and a close (X);
 * the "Entering page" fill button pinned above the home indicator; small
 * position dots instead of "X / 16" text.
 */
describe('Studio page: full-screen layout, real profile photo, position dots', () => {
  it('is a genuine full-screen page — pageHeight is the screen height, not a 75%/90% fraction', () => {
    expect(studio).toContain('const pageHeight = screenHeight;');
    expect(studio).not.toContain('screenHeight * 0.75');
    expect(studio).not.toContain('screenHeight * 0.9');
  });

  it('shows the real profile photo when one exists, with initials/neutral-icon fallbacks only otherwise', () => {
    expect(studio).toContain('avatarUrl ? (');
    expect(studio).toContain('<Image source={{ uri: avatarUrl }} style={styles.avatarImage} />');
    expect(studio).toContain('hasStoreName ? (');
    expect(studio).toContain('Feather name="shopping-bag"');
  });

  it('replaces the "X / 16" text indicator with a row of small position dots', () => {
    expect(studio).not.toContain('seller-studio-card-position');
    expect(studio).toContain('testID="seller-studio-position-dots"');
    expect(studio).toContain('i === cardIndexJS && styles.dotActive');
  });
});
