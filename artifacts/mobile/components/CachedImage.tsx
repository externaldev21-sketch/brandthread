import React from 'react';
import { Image, ImageProps } from 'expo-image';

const DEFAULT_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

/**
 * Shared remote-image behavior: memory+disk caching prevents scroll flicker,
 * while a short fade and blurhash keep loading states visually stable.
 * expo-image decodes at the rendered size (allowDownscaling), so a 56 pt
 * thumbnail never holds a full-resolution bitmap in memory. Inside FlashList
 * rows pass `recyclingKey` (e.g. the item id) so a recycled cell never shows
 * the previous item's image while the new one loads.
 */
export function CachedImage({
  placeholder,
  transition = 180,
  cachePolicy = 'memory-disk',
  contentFit = 'cover',
  ...props
}: ImageProps) {
  // Accessibility: an image with a description (`alt` / `accessibilityLabel`,
  // e.g. the product name) is exposed to screen readers; one without is
  // decorative and skipped, so a card's own label is not read twice and a
  // bare "image" is never announced. Callers can still force either way by
  // passing `accessible` explicitly.
  const described = Boolean(props.alt || props.accessibilityLabel);
  return (
    <Image
      accessible={described}
      {...props}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      placeholder={placeholder ?? { blurhash: DEFAULT_BLURHASH }}
    />
  );
}