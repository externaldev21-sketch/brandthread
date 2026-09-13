import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { Animated, useWindowDimensions, View, StyleSheet, Platform } from 'react-native';
import { useRouter, Href } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BG } from '@/lib/theme';

type ThreadPullContextType = {
  push: (href: Href) => void;
  replace: (href: Href) => void;
  back: () => void;
};

const ThreadPullContext = createContext<ThreadPullContextType | null>(null);

export function useThreadPull() {
  const ctx = useContext(ThreadPullContext);
  const router = useRouter();
  return ctx ?? {
    push: (href: Href) => router.push(href),
    replace: (href: Href) => router.replace(href),
    back: () => router.back(),
  };
}

export function ThreadPullProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [active, setActive] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const progress = useRef(new Animated.Value(0)).current;
  const isTransitioning = useRef(false);
  const pendingTransition = useRef<{ direction: 'forward' | 'back'; action: () => void } | null>(null);

  const sweep = (nextDirection: 'forward' | 'back', routeAction: () => void) => {
    if (isTransitioning.current) {
      pendingTransition.current = { direction: nextDirection, action: routeAction };
      return;
    }
    isTransitioning.current = true;
    setDirection(nextDirection);
    setActive(true);
    progress.setValue(0);

    requestAnimationFrame(() => {
      routeAction();
      Animated.timing(progress, {
        toValue: 1,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => {
        isTransitioning.current = false;
        const pending = pendingTransition.current;
        pendingTransition.current = null;
        if (pending) {
          sweep(pending.direction, pending.action);
        } else {
          setActive(false);
        }
      });
    });
  };

  const push = useCallback((href: Href) => {
    sweep('forward', () => router.push(href));
  }, [router, progress]);

  const replace = useCallback((href: Href) => {
    sweep('forward', () => router.replace(href));
  }, [router, progress]);

  const back = useCallback(() => {
    sweep('back', () => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(buyer)/' as any);
      }
    });
  }, [router, progress]);

  const forward = direction === 'forward';
  const contentTranslateX = progress.interpolate({
    inputRange: [0, 0.18, 1],
    outputRange: [forward ? 12 : -12, forward ? 5 : -5, 0],
  });
  const contentScaleX = progress.interpolate({
    inputRange: [0, 0.32, 1],
    outputRange: [1.012, 1.006, 1],
  });
  const veilOpacity = progress.interpolate({
    inputRange: [0, 0.24, 0.68, 1],
    outputRange: [0.02, 0.16, 0.07, 0],
  });
  const seamTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: forward ? [-8, screenWidth + 8] : [screenWidth + 8, -8],
  });
  const threadTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: forward ? [-screenWidth * 0.48, screenWidth] : [screenWidth, -screenWidth * 0.48],
  });

  const strands = Array.from({ length: 9 }).map((_, i) => {
    const width = 42 + ((i * 31) % 92);
    return (
      <Animated.View
        key={i}
        style={{
          position: 'absolute',
          top: `${10 + i * 10}%`,
          width,
          height: StyleSheet.hairlineWidth,
          backgroundColor: theme.accent,
          opacity: 0.09,
          transform: [{ translateX: threadTranslateX }],
        }}
      />
    );
  });

  return (
    <ThreadPullContext.Provider value={{ push, replace, back }}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: active ? contentTranslateX : 0 }, { scaleX: active ? contentScaleX : 1 }] }}>
        {children}
      </Animated.View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 99999, display: active ? 'flex' : 'none', overflow: 'hidden' }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BG, opacity: veilOpacity }]} />
        {strands}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: theme.accent,
            opacity: 0.48,
            shadowColor: theme.accent,
            shadowOpacity: 0.7,
            shadowRadius: 7,
            shadowOffset: { width: 0, height: 0 },
            transform: [{ translateX: seamTranslateX }],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            top: '48%',
            left: 0,
            width: screenWidth * 0.48,
            height: 2,
            borderRadius: 2,
            backgroundColor: theme.accent,
            opacity: 0.92,
            shadowColor: theme.accent,
            shadowOpacity: 0.9,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            transform: [{ translateX: threadTranslateX }],
          }}
        />
      </View>
    </ThreadPullContext.Provider>
  );
}
