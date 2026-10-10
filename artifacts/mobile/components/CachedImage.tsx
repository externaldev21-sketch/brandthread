import React from 'react';
import { Image, ImageProps } from 'expo-image';
import { rewriteImageSource } from '@/lib/cdnUrl';

/**
 * Shared remote-image behavior: memory+disk caching prevents scroll flicker,
 * and a short fade keeps loading states visually stable. No blurhash: a
 * failed image never leaves a blurred smear on screen. Until it loads (or if
 * it never does) the image area is simply empty, showing whatever is behind
 * it (the page or the tile's own background), so transparent logos stay
 * clean too. A caller can still pass an explicit `placeholder`.
 * expo-image decodes at the rendered size (allowDownscaling), so a 56 pt
 * thumbnail never holds a full-resolution bitmap in memory. Inside FlashList
 * rows pass `recyclingKey` (e.g. the item id) so a recycled cell never shows
 * the previous item's image while the new one loads.
 *
 * When EXPO_PUBLIC_CDN_BASE_URL is set, storage URLs are served through that
 * CDN (lib/cdnUrl.ts); unset, `source` is passed through untouched.
 */
export function CachedImage({
  source,
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
      source={rewriteImageSource(source)}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      placeholder={placeholder}
    />
  );
}
