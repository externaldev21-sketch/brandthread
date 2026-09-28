import React, { useState } from 'react';
import { Image, Platform, Text } from 'react-native';

/**
 * One consistent emoji glyph across iOS, Android and web.
 *
 * iOS already renders real Apple emoji natively (the system font) — nothing
 * to replace there. Android's system font (Noto Color Emoji) and most web
 * fonts look visibly different/uglier by comparison, which is the actual
 * complaint this component fixes: it renders those two platforms as an
 * image instead, so the art is identical everywhere.
 *
 * Apple's own emoji artwork is a proprietary part of its system font and
 * can't be legally bundled or redistributed outside Apple's own platforms —
 * shipping ripped Apple glyphs in a general (non-Apple) app is a real
 * trademark/copyright risk, not a "no dead buttons" shortcut worth taking.
 * Twemoji (Twitter's emoji set, CC-BY 4.0 — explicit permission to modify
 * and redistribute) is the standard, legally-clean solution real apps reach
 * for to solve exactly this "same art on every platform" problem, so that's
 * what renders here instead. Falls back to the plain text glyph (still
 * correct, just platform-styled) if the image can't load — e.g. no network.
 */
export function AppleEmoji({ emoji, size = 24 }: { emoji: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (Platform.OS === 'ios' || failed) {
    return <Text style={{ fontSize: size }}>{emoji}</Text>;
  }

  const codepoint = Array.from(emoji)
    .map(char => char.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join('-');

  return (
    <Image
      source={{ uri: `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoint}.png` }}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      accessibilityLabel={emoji}
    />
  );
}
