import React from 'react';
import { Image, ImageProps } from 'expo-image';
import { rewriteImageSource } from '@/lib/cdnUrl';

const DEFAULT_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

/**
 * Shared remote-image behavior: memory+disk caching prevents scroll flicker,
 * while a short fade and blurhash keep loading states visually stable.
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
  return (
    <Image
      {...props}
      source={rewriteImageSource(source)}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      placeholder={placeholder ?? { blurhash: DEFAULT_BLURHASH }}
    />
  );
}
