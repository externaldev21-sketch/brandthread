/**
 * Apple-style emoji rendering for web/Android.
 *
 * iOS native already renders Apple's own emoji glyphs, so this only matters
 * off native-iOS: on web (which falls back to whatever OS font is installed —
 * usually the blobby Noto/Segoe glyphs) and on Android (Noto Color Emoji).
 * Rather than fighting font stacks (no web-safe font ships Apple's actual
 * artwork), we render each quick-reaction emoji as an image from the
 * `emoji-datasource-apple` sprite set published on jsdelivr — the same
 * Apple-style PNGs used by Twemoji-alternative pickers like emoji-mart.
 *
 * Falls back to the plain unicode glyph (via `AppleEmojiText`) if the image
 * 404s, so a CDN hiccup never blanks a reaction.
 */
import React, { useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextStyle } from 'react-native';

/** codepoint (lowercase, hyphen-joined, no leading zeros) per quick reaction */
const APPLE_EMOJI_CODEPOINTS: Record<string, string> = {
  '❤️': '2764-fe0f',
  '😂': '1f602',
  '😍': '1f60d',
  '😢': '1f622',
  '😮': '1f62e',
  '🔥': '1f525',
  '👏': '1f44f',
  '🙌': '1f64c',
};

const APPLE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64';

/** Apple already renders its own emoji on iOS native — only image-fetch elsewhere. */
const NEEDS_IMAGE_FALLBACK = Platform.OS !== 'ios';

export function AppleEmoji({ emoji, size = 22 }: { emoji: string; size?: number }) {
  const codepoint = APPLE_EMOJI_CODEPOINTS[emoji];
  const [failed, setFailed] = useState(false);

  if (!NEEDS_IMAGE_FALLBACK || !codepoint || failed) {
    return <Text style={{ fontSize: size, fontFamily: EMOJI_FONT_STACK }}>{emoji}</Text>;
  }

  return (
    <Image
      source={{ uri: `${APPLE_EMOJI_CDN}/${codepoint}.png` }}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      accessibilityLabel={emoji}
    />
  );
}

/**
 * For emoji rendered as part of a longer text string (not one of the fixed
 * quick-reaction glyphs, e.g. an emoji already typed into a comment) — no
 * image swap is possible there, so this just biases the font stack toward
 * Apple's own emoji font where the OS provides one, falling back to the
 * system default everywhere else instead of forcing Noto/Segoe.
 */
export const EMOJI_FONT_STACK: TextStyle['fontFamily'] = Platform.select({
  web: '"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji"',
  default: undefined,
});

export const QUICK_REACTION_EMOJI = ['❤️', '😂', '😍', '😢', '😮', '🔥', '👏', '🙌'];
