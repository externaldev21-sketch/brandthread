/**
 * A POST carousel as people see it: fixed 3:4 frame, horizontal swipe between
 * slides, dots under the frame, and videos that autoplay MUTED while their
 * slide is the visible one (and the screen is focused). Photos-only posts
 * (and legacy single-photo posts) use the same component.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View, type ViewToken } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '@/components/ui/Icon';
import { CachedImage } from '@/components/CachedImage';
import type { PostSlide } from '@/services/socialTypes';
import { CREATE_CANVAS } from '@/lib/theme';

export const POST_RATIO = 3 / 4;

function SlideVideo({ uri, active, width, height }: { uri: string; active: boolean; width: number; height: number }) {
  const focused = useIsFocused();
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    if (active && focused) player.play(); else player.pause();
  }, [active, focused, player]);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  return (
    <View style={{ width, height }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <Pressable
        onPress={() => setMuted((m) => !m)}
        style={s.mute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        testID="carousel-mute"
        hitSlop={8}
      >
        <Icon name={muted ? 'volume-x' : 'volume-2'} size={14} color={CREATE_CANVAS.white} />
      </Pressable>
    </View>
  );
}

export function PostCarousel({ slides, width, dotColor = CREATE_CANVAS.white, dotDim = CREATE_CANVAS.silverDim }: {
  slides: PostSlide[]; width: number; dotColor?: string; dotDim?: string;
}) {
  const height = Math.round(width / POST_RATIO);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<PostSlide>>(null);
  const go = (next: number) => list.current?.scrollToIndex({ index: Math.max(0, Math.min(slides.length - 1, next)), animated: true });
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first && typeof first.index === 'number') setIndex(first.index);
  }, []);
  return (
    <View style={{ width }} testID="post-carousel">
      <FlatList
        ref={list}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          item.kind === 'video'
            ? <SlideVideo uri={item.url} active={i === index} width={width} height={height} />
            : <CachedImage source={{ uri: item.url }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        )}
        style={{ width, height }}
      />
      {/* A mouse can't swipe: the web build gets explicit previous/next controls. */}
      {Platform.OS === 'web' && slides.length > 1 ? (
        <>
          {index > 0 ? (
            <Pressable onPress={() => go(index - 1)} style={[s.arrow, { left: 10, top: height / 2 - 16 }]} accessibilityRole="button" accessibilityLabel="Previous slide" testID="carousel-prev">
              <Icon name="chevron-left" size={18} color={CREATE_CANVAS.white} />
            </Pressable>
          ) : null}
          {index < slides.length - 1 ? (
            <Pressable onPress={() => go(index + 1)} style={[s.arrow, { right: 10, top: height / 2 - 16 }]} accessibilityRole="button" accessibilityLabel="Next slide" testID="carousel-next">
              <Icon name="chevron-right" size={18} color={CREATE_CANVAS.white} />
            </Pressable>
          ) : null}
        </>
      ) : null}
      {slides.length > 1 ? (
        <View style={s.dots} testID="carousel-dots" accessibilityLabel={`Slide ${index + 1} of ${slides.length}`}>
          {slides.map((_, i) => <View key={i} style={[s.dot, { backgroundColor: i === index ? dotColor : dotDim }]} />)}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingVertical: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  arrow: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: CREATE_CANVAS.black, alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: CREATE_CANVAS.black, alignItems: 'center', justifyContent: 'center' },
});
