/**
 * The "New posts" pill (Instagram home feed) — see lib/feed/newPostsPill.ts
 * for the rules. `useNewPostsCheck` runs the quiet background check;
 * `<NewPostsPill>` is the floating control under the feed header: drops in
 * from above, tap = scroll to top + refresh. Monochrome: white pill, black
 * Inter label, up arrow.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { CREATE_CANVAS, FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useHomeFeedTab } from './HomeFeedTabs';
import { NEW_POSTS_POLL_MS, freshPostIds, shouldCheckForNewPosts } from '@/lib/feed/newPostsPill';

/**
 * Polls `fetchTopIds` every NEW_POSTS_POLL_MS while the viewer is scrolled
 * into the feed; `available` flips true once the top of the feed has posts
 * the current list lacks. `dismiss()` hides it (tap, or back at the top).
 */
export function useNewPostsCheck({
  focused, activeIndex, loading, currentIds, fetchTopIds,
}: {
  focused: boolean;
  activeIndex: number;
  loading: boolean;
  currentIds: readonly string[];
  fetchTopIds: () => Promise<string[]>;
}) {
  const [available, setAvailable] = useState(false);
  const idsRef = useRef(currentIds);
  idsRef.current = currentIds;
  const fetchRef = useRef(fetchTopIds);
  fetchRef.current = fetchTopIds;
  const run = shouldCheckForNewPosts({
    focused, activeIndex, loading, pillShown: available, hasPosts: currentIds.length > 0,
  });

  useEffect(() => {
    if (!run) return undefined;
    let alive = true;
    const t = setInterval(() => {
      void fetchRef.current().then(
        (top) => { if (alive && freshPostIds(idsRef.current, top).length > 0) setAvailable(true); },
        () => { /* offline / server hiccup: just try again next tick */ },
      );
    }, NEW_POSTS_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [run]);

  // Back at the first post on their own: nothing left to point at.
  useEffect(() => { if (activeIndex === 0) setAvailable(false); }, [activeIndex]);

  const dismiss = useCallback(() => setAvailable(false), []);
  return { available, dismiss, show: useCallback(() => setAvailable(true), []) };
}

export function NewPostsPill({ visible: wanted, top, onPress }: { visible: boolean; top: number; onPress: () => void }) {
  const reduceMotion = useReduceMotion();
  // The LIVE header tab covers the post feed; the pill belongs to the posts.
  const homeTab = useHomeFeedTab();
  const visible = wanted && homeTab !== 'live';
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
    const duration = reduceMotion ? 0 : visible ? 260 : 180;
    progress.value = withTiming(visible ? 1 : 0, { duration, easing: Easing.out(Easing.cubic) });
    if (!visible) {
      const t = setTimeout(() => setMounted(false), duration + 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible, reduceMotion, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -16 }, { scale: 0.94 + progress.value * 0.06 }],
  }));

  if (!mounted) return null;
  return (
    <Animated.View style={[styles.wrap, { top }, style]} pointerEvents={visible ? 'box-none' : 'none'}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="New posts. Scroll to top"
        testID="feed-new-posts-pill"
        hitSlop={8}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
      >
        <Icon name="arrow-up" size={14} color={CREATE_CANVAS.black} />
        <Text style={styles.label}>New posts</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 30, elevation: 30 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 34, paddingHorizontal: 14, borderRadius: RADII.pill,
    backgroundColor: CREATE_CANVAS.white,
    shadowColor: CREATE_CANVAS.black, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  label: { color: CREATE_CANVAS.black, fontFamily: FONT.semibold, fontSize: 14, letterSpacing: -0.1 },
});
