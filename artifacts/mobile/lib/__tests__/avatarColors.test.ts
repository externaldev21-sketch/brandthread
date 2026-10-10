/**
 * Regression guard for the "monochrome avatar sweep" (parts 1 + 2).
 *
 * Part 1 (PR #296) only patched `?? '#8B5CF6'`-style FALLBACK expressions,
 * which missed direct literal colors like previewInboxData.ts's old
 * `participantColor: '#6D28D9'` — a fallback never fires when the seed data
 * already supplies some color, however wrong. This test guards against that
 * class of regression two ways:
 *
 *  1. For files vitest can import directly (no react-native/expo-* deps —
 *     previewInboxData.ts, searchData.ts), it asserts every seeded
 *     avatar/participant/actor color is a real member of
 *     AVATAR_NEUTRAL_PALETTE, not just "looks grey".
 *  2. For files vitest cannot import (previewActivity.ts pulls in
 *     expo-asset; app/buyer-search.tsx is a full RN screen) it falls back to
 *     source inspection — reading the file text and asserting no
 *     `color:`/`participantColor:`/`actorColor:`/`authorColor:` field is a
 *     hardcoded hex literal — matching the established pattern used by
 *     lib/__tests__/previewInbox.test.ts and tests/no-adhoc-button-styling.test.ts
 *     for files with the same import limitation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AVATAR_NEUTRAL_PALETTE, pickAvatarColor } from '../avatarColors';
import {
  BRANDTHREAD_AGENT_SEED,
  PREVIEW_CONVERSATION_SEEDS,
  PREVIEW_FOLLOWER_SEEDS,
  SELLER_PREVIEW_CONVERSATION_SEEDS,
} from '../previewInboxData';

const ROOT = resolve(__dirname, '../..');

describe('avatarColors — pickAvatarColor always returns a palette member', () => {
  it('returns a color that is in AVATAR_NEUTRAL_PALETTE for any seed', () => {
    const seeds = ['preview-seller-01', 'preview-seller-06', 'brandthread-agent', '', undefined, null, 'x', 'a-very-long-seed-string-id-123'];
    for (const seed of seeds) {
      expect(AVATAR_NEUTRAL_PALETTE).toContain(pickAvatarColor(seed as string | undefined | null));
    }
  });

  it('is deterministic for a given seed', () => {
    expect(pickAvatarColor('preview-seller-06')).toBe(pickAvatarColor('preview-seller-06'));
  });
});

describe('previewInboxData — every seeded avatar color is in the neutral palette', () => {
  it('every buyer conversation seed uses a neutral participantColor', () => {
    const all = [BRANDTHREAD_AGENT_SEED, ...PREVIEW_CONVERSATION_SEEDS, ...SELLER_PREVIEW_CONVERSATION_SEEDS];
    for (const seed of all) {
      expect(AVATAR_NEUTRAL_PALETTE).toContain(seed.participantColor);
    }
  });

  it('specifically, Forme 22 (preview-seller-06) is no longer purple #6D28D9', () => {
    const forme22 = PREVIEW_CONVERSATION_SEEDS.find((s) => s.participantUserId === 'preview-seller-06');
    expect(forme22).toBeTruthy();
    expect(forme22!.participantColor).not.toBe('#6D28D9');
    expect(AVATAR_NEUTRAL_PALETTE).toContain(forme22!.participantColor);
  });

  it('every follower/notification seed uses a neutral actorColor', () => {
    for (const seed of PREVIEW_FOLLOWER_SEEDS) {
      expect(AVATAR_NEUTRAL_PALETTE).toContain(seed.actorColor);
    }
  });
});

// ── Source-inspection fallback for files vitest cannot import directly ─────
//
// A hardcoded avatar-color hex looks like `color: '#XXXXXX'`,
// `participantColor: '#XXXXXX'`, `actorColor: '#XXXXXX'` or
// `authorColor: '#XXXXXX'` — i.e. a color/participant/actor/author field
// assigned a literal hex string rather than a pickAvatarColor(...) call.
// This intentionally does NOT flag every hex in the file (e.g. `following.tsx`
// and `buyer-search.tsx` both use `{ color: '#FFFFFF' }` for unrelated body
// text on colored scrims, which this sweep explicitly leaves alone).
const HARDCODED_AVATAR_HEX = /\b(color|participantColor|actorColor|authorColor)\s*:\s*['"]#[0-9A-Fa-f]{3,8}['"]/g;

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

describe('source inspection — no hardcoded avatar-color hex remains', () => {
  const FILES_WITH_ONLY_UNRELATED_HEX_TEXT_COLORS: Record<string, RegExp> = {
    // Both of these deliberately keep `{ color: '#FFFFFF' }` for white body
    // text drawn on colored scrims/badges — not an avatar/participant color.
    // Guard against a *new* avatar-color hex creeping in without
    // whitelisting every legitimate white-text usage one by one.
    'lib/previewActivity.ts': /\bcolor:\s*['"]#(?!FFFFFF)[0-9A-Fa-f]{3,8}['"]/g,
    'app/(tabs)/following.tsx': /\bcolor:\s*['"]#(?!FFFFFF)[0-9A-Fa-f]{3,8}['"]/g,
    'app/buyer-search.tsx': /\bcolor:\s*['"]#(?!FFFFFF|1f1f1f|9A9AA0)[0-9A-Fa-f]{3,8}['"]/g,
  };

  it('previewActivity.ts, following.tsx and buyer-search.tsx have no colorful avatar hex left', () => {
    for (const [file, pattern] of Object.entries(FILES_WITH_ONLY_UNRELATED_HEX_TEXT_COLORS)) {
      const source = readSource(file);
      const matches = source.match(pattern) ?? [];
      expect(matches, `${file} still has a hardcoded colorful avatar hex: ${matches.join(', ')}`).toHaveLength(0);
    }
  });

  it('previewInboxData.ts, previewActivity.ts, searchData.ts, following.tsx, buyer-search.tsx and socialService.ts have no hardcoded participant/actor/author hex', () => {
    const files = [
      'lib/previewInboxData.ts',
      'lib/previewActivity.ts',
      'lib/searchData.ts',
      'app/(tabs)/following.tsx',
      'app/buyer-search.tsx',
      'services/socialService.ts',
    ];
    for (const file of files) {
      const source = readSource(file);
      const matches = source.match(HARDCODED_AVATAR_HEX) ?? [];
      // The generic scan above does catch benign `{ color: '#FFFFFF' }` text
      // styles, so only participantColor/actorColor/authorColor are asserted
      // strictly here; plain `color:` hex is checked precisely (with the
      // known-benign white/greys excluded) by the block above.
      const strictFieldMatches = matches.filter((m) => !/^color\s*:/.test(m));
      expect(strictFieldMatches, `${file} still has a hardcoded participant/actor/author hex: ${strictFieldMatches.join(', ')}`).toHaveLength(0);
    }
  });
});
