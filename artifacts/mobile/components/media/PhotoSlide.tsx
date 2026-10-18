/**
 * One photo page: blurred, darkened copy of the same photo fills the page;
 * the foreground keeps its authored/natural aspect with "contain" (never
 * cropped or stretched). The foreground accepts an animated zoom style.
 */
import React, { useEffect, useState } from 'react';
import { Image as NativeImage, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { CREATE_CANVAS as MEDIA } from '@/lib/theme';
import { containRect, resolveSlideAspect } from '@/components/buyer-feed/photoSlideGeometry';

export type PhotoSlideProps = {
  uri: string; index: number; count: number; pageWidth: number; pageHeight: number;
  authoredAspect?: number | null; priority: 'high' | 'normal' | 'low';
  zoomStyle?: React.ComponentProps<typeof Animated.View>['style'];
  onPainted?: () => void;
  onAspect?: (index: number, aspect: number) => void;
};

export function PhotoSlide({ uri, index, count, pageWidth, pageHeight, authoredAspect, priority, zoomStyle, onPainted, onAspect }: PhotoSlideProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [paintedUri, setPaintedUri] = useState<string | null>(null);
  // A pre-mounted image can finish before its page becomes active.
  useEffect(() => { if (paintedUri === uri) onPainted?.(); }, [paintedUri, uri, onPainted]);
  const aspect = resolveSlideAspect(authoredAspect, natural);
  useEffect(() => {
    if (aspect || !uri) return;
    let active = true;
    NativeImage.getSize(uri, (width, height) => {
      if (active && width > 0 && height > 0) setNatural({ width, height });
    }, () => {});
    return () => { active = false; };
  }, [uri, aspect]);
  useEffect(() => { if (aspect) onAspect?.(index, aspect); }, [aspect, index, onAspect]);
  const rect = containRect(pageWidth, pageHeight, aspect);
  return (
    <View style={{ width: pageWidth, height: pageHeight, backgroundColor: MEDIA.black, overflow: 'hidden' }} testID={`photo-slide-${index}`}>
      {uri ? (
        <>
          <CachedImage
            source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40}
            transition={0} priority="low" accessible={false} testID={`photo-slide-backdrop-${index}`}
          />
          <View style={[StyleSheet.absoluteFill, styles.backdropDim]} pointerEvents="none" />
          <Animated.View
            style={[{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height }, zoomStyle]}
            pointerEvents="none"
          >
            <CachedImage
              source={{ uri }} contentFit="contain" placeholder={null} transition={0}
              priority={priority === 'low' ? 'low' : priority}
              style={[StyleSheet.absoluteFill, !aspect && { opacity: 0 }]}
              onLoad={(e) => {
                const src = e?.source;
                if (src && src.width > 0 && src.height > 0
                  && (!natural || natural.width !== src.width || natural.height !== src.height)) {
                  setNatural({ width: src.width, height: src.height });
                }
                setPaintedUri(uri);
              }}
              accessibilityLabel={`Photo ${index + 1} of ${count}`}
              testID={`photo-slide-image-${index}`}
            />
          </Animated.View>
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Feather name="image" size={42} color={MEDIA.silverDim} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdropDim: { backgroundColor: `${MEDIA.black}8C` },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: MEDIA.surface },
});
