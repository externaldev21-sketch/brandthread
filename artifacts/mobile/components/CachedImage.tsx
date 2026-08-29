import React from 'react';
import { Image, ImageProps } from 'expo-image';

const DEFAULT_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

/**
 * Shared remote-image behavior: memory+disk caching prevents scroll flicker,
 * while a short fade and blurhash keep loading states visually stable.
 */
export function CachedImage({
  placeholder,
  transition = 180,
  cachePolicy = 'memory-disk',
  contentFit = 'cover',
  ...props
}: ImageProps) {
  return (
    <Image
      {...props}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      placeholder={placeholder ?? { blurhash: DEFAULT_BLURHASH }}
    />
  );
}