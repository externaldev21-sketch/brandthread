/**
 * Photo-mode carousel for a slideshow Thread (TikTok / Instagram photo mode):
 * swipe left/right between slides, vertical swipes still belong to the feed.
 *
 *  - "1/6" counter, top-right, and a thin segment indicator at the bottom.
 *  - Remembers the slide per post (lib/carouselMemory) — come back, same slide.
 *  - Preloads the next two slides (and the one behind) into memory+disk, so a
 *    swipe never shows a blank frame.
 *  - Final size on the first frame: each slide's box is computed from its
 *    server-stored pixel size (`aspects`, lib/mediaFrame) — never from an
 *    image onLoad or an onLayout — and painted with no placeholder and no
 *    fade, so returning to a cached slideshow shows it instantly at the same
 *    size.
 *  - Taps are not handled here: the parent page's Pressable still owns
 *    single/double tap, so double-tap like works on any slide.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { rememberSlide, rememberedSlide } from '@/lib/carouselMemory';
import { containRect } from '@/lib/mediaFrame';
import { CREATE_CANVAS as MEDIA, FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export type PhotoCarouselProps = {
  postId: string;
  uris: string[];
  /** Width / height per slide (from the post's stored pixel sizes). */
  aspects?: number[];
  pageWidth: number;
  pageHeight: number;
  /** Distance from the page top to the counter (clears the feed's top bar). */
  counterTop: number;
  /** Distance from the page bottom to the segment indicator. */
  indicatorBottom: number;
  onIndexChange?: (index: number) => void;
  onFirstImagePainted?: () => void;
  /** Only the active page prefetches its neighbour. */
  isActive?: boolean;
};

export function PhotoCarousel({
  postId, uris, aspects, pageWidth, pageHeight, counterTop, indicatorBottom, onIndexChange, onFirstImagePainted, isActive = true,
}: PhotoCarouselProps) {
  const pages = useMemo(() => (uris.length > 0 ? uris : ['']), [uris]);
  const count = pages.length;
  const initialIndex = useMemo(() => rememberedSlide(postId, count), [postId, count]);
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);
  const indexRef = useRef(initialIndex);

  const commit = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    if (clamped === indexRef.current) return;
    indexRef.current = clamped;
    setIndex(clamped);
    rememberSlide(postId, clamped);
    onIndexChange?.(clamped);
  }, [count, onIndexChange, postId]);

  useEffect(() => { onIndexChange?.(initialIndex); }, [initialIndex, onIndexChange]);

  // A web FlatList ignores initialScrollIndex until it has laid out once.
  useEffect(() => {
    if (initialIndex > 0 && pageWidth > 0) {
      const t = setTimeout(() => listRef.current?.scrollToOffset({ offset: initialIndex * pageWidth, animated: false }), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [initialIndex, pageWidth]);

  // Preload two ahead (and one behind) of the visible slide.
  useEffect(() => {
    if (!isActive) return;
    const neighbours = [pages[index + 1], pages[index + 2], pages[index - 1]].filter((u): u is string => !!u);
    if (neighbours.length > 0) void Image.prefetch(neighbours, 'memory-disk').catch(() => false);
  }, [index, isActive, pages]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    commit(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  }, [commit, pageWidth]);

  return (
    <View style={[StyleSheet.absoluteFill, { width: pageWidth, height: pageHeight }]} testID={`photo-carousel-${postId}`}>
      <FlatList
        ref={listRef}
        data={pages}
        style={StyleSheet.absoluteFill}
        keyExtractor={(uri, i) => `${uri}-${i}`}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        directionalLockEnabled
        nestedScrollEnabled
        initialScrollIndex={initialIndex}
        initialNumToRender={Math.min(count, initialIndex + 2)}
        windowSize={3}
        scrollEventThrottle={32}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
        renderItem={({ item: uri, index: i }) => (
          <View style={{ width: pageWidth, height: pageHeight, backgroundColor: MEDIA.black }}>
            {uri ? (
              <CachedImage
                source={{ uri }}
                style={{ position: 'absolute', ...containRect(aspects?.[i] ?? 9 / 16, pageWidth, pageHeight) }}
                contentFit="contain"
                transition={0}
                placeholder={null}
                recyclingKey={`${postId}-${i}`}
                priority={i === index ? 'high' : 'normal'}
                onLoad={i === initialIndex ? onFirstImagePainted : undefined}
                accessibilityLabel={`Photo ${i + 1} of ${count}`}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
                <Feather name="image" size={42} color={MEDIA.silverDim} />
              </View>
            )}
          </View>
        )}
      />
      {count > 1 ? (
        <>
          <View style={[styles.counter, { top: counterTop }]} pointerEvents="none" testID="carousel-counter">
            <Text style={styles.counterText} accessibilityLabel={`Photo ${index + 1} of ${count}`}>{`${index + 1}/${count}`}</Text>
          </View>
          <View style={[styles.segments, { bottom: indicatorBottom }]} pointerEvents="none" testID="carousel-segments">
            {pages.map((_, i) => (
              <View key={i} style={[styles.segment, i === index && styles.segmentActive]} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: MEDIA.surface },
  counter: {
    position: 'absolute', right: 12, minWidth: 38, height: 24, paddingHorizontal: 9,
    borderRadius: RADII.pill, backgroundColor: `${MEDIA.black}8C`, alignItems: 'center', justifyContent: 'center',
  },
  counterText: { color: MEDIA.white, fontFamily: FONT.semibold, fontSize: 12, letterSpacing: 0.3 },
  segments: { position: 'absolute', left: 16, right: 16, height: 2, flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 2, borderRadius: 1, backgroundColor: `${MEDIA.white}52` },
  segmentActive: { backgroundColor: MEDIA.white },
});
