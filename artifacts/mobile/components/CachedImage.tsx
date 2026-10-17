import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { rewriteImageSource } from '@/lib/cdnUrl';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { lowResPlaceholder } from '@/lib/imageVariants';

const DEFAULT_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

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
 *
 * `fallbackLabel` (a person, brand or product name): if the image fails to
 * load, the same box shows that name's initial on a plain tile instead of a
 * broken image or an endless blurhash.
 * Pass `placeholder={null}` (with `transition={0}`) for media laid out from
 * known dimensions — feed pages, carousels — so already-seen media paints
 * straight from cache with no blurhash flash or fade.
 */
export function CachedImage({
  source,
  // Low-res → sharp: where the host can resize, a tiny copy paints first
  // and the transition fades to the full photo (lib/imageVariants.ts).
  placeholder = lowResPlaceholder(source),
  transition = 180,
  cachePolicy = 'memory-disk',
  contentFit = 'cover',
  fallbackLabel,
  ...props
}: ImageProps & { fallbackLabel?: string }) {
  const [failed, setFailed] = useState(false);
  const sourceKey = JSON.stringify(source ?? null);
  useEffect(() => setFailed(false), [sourceKey]);
  if (failed && fallbackLabel !== undefined) {
    return <InitialTile label={fallbackLabel} style={props.style as StyleProp<ViewStyle>} />;
  }
  // Accessibility: an image with a description (`alt` / `accessibilityLabel`,
  // e.g. the product name) is exposed to screen readers; one without is
  // decorative and skipped, so a card's own label is not read twice and a
  // bare "image" is never announced. Callers can still force either way by
  // passing `accessible` explicitly.
  const described = Boolean(props.alt || props.accessibilityLabel);
  return (
    <Image
      accessible={described}
      placeholderContentFit={contentFit}
      {...props}
      source={rewriteImageSource(source)}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      placeholder={placeholder === null ? undefined : placeholder}
      onError={(event) => {
        if (fallbackLabel !== undefined) setFailed(true);
        props.onError?.(event);
      }}
    />
  );
}

/** First letter of the first word, uppercased; '?' when there is none. */
export function initialFor(label: string): string {
  const first = label.replace(/^[\s!-/:-@[-`{-~]+/, '').charAt(0);
  return first ? first.toUpperCase() : '?';
}

function InitialTile({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  const flat = StyleSheet.flatten(style) ?? {};
  const size = Math.min(Number(flat.width) || 48, Number(flat.height) || Number(flat.width) || 48);
  return (
    <View
      testID="image-initial-tile"
      accessibilityLabel={label || undefined}
      style={[style, styles.tile, { backgroundColor: theme.card }]}
    >
      <Text style={[styles.initial, { color: theme.muted, fontSize: Math.max(13, Math.round(size * 0.38)) }]}>{initialFor(label)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: FONT.semibold },
});
