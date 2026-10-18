/**
 * Photo-mode carousel for a slideshow Thread (feed). Thin wrapper over the
 * shared ZoomablePhotoPager: UI-thread paging with a 10pt direction lock
 * (vertical swipes still belong to the feed), live tappable dots (no counter),
 * per-post remembered slide, neighbour preload, contain + blurred backdrop,
 * and pinch-to-zoom (up to 4x) that springs home on release while lifted
 * above the nav via PhotoZoomHost. Taps stay with the parent Pressable, so
 * double-tap like keeps working on any slide.
 */
import { PhotoAutoAdvance } from './photoAutoAdvance';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ZoomablePhotoPager } from '@/components/media/ZoomablePhotoPager';

export type PhotoCarouselProps = {
  postId: string;
  uris: string[];
  pageWidth: number;
  pageHeight: number;
  /** Distance from the page top to the counter (clears the feed's top bar). */
  counterTop: number;
  /** Distance from the page bottom to the dot indicator. */
  indicatorBottom: number;
  onIndexChange?: (index: number) => void;
  onFirstImagePainted?: () => void;
  /** Only the active page prefetches its neighbours. */
  isActive?: boolean;
  /** Optional authored aspect ratio (width / height) per slide. */
  aspects?: (number | null | undefined)[];
  onZoomChange?: (zoomed: boolean) => void;
  /** Viewer opted into 3s auto-advance and this page is the visible one. */
  autoAdvance?: boolean;
  /** Press-and-hold pauses auto-advance. */
  holding?: boolean;
};

export function PhotoCarousel({
  postId, uris, pageWidth, pageHeight, counterTop, indicatorBottom, onIndexChange, onFirstImagePainted, isActive = true, aspects, onZoomChange, autoAdvance = false, holding = false,
}: PhotoCarouselProps) {
  return (
    <View style={[StyleSheet.absoluteFill, { width: pageWidth, height: pageHeight }]} testID={`photo-carousel-${postId}`}>
      <ZoomablePhotoPager
        postId={postId}
        uris={uris}
        width={pageWidth}
        height={pageHeight}
        aspects={aspects}
        mode="reset"
        showCounter={false}
        counterTop={counterTop}
        dotsPlacement="overlay"
        dotsBottom={indicatorBottom}
        isActive={isActive}
        onIndexChange={onIndexChange}
        onFirstImagePainted={onFirstImagePainted}
        onZoomChange={onZoomChange}
        renderOverlay={({ index, count, zoomed, goTo }) => (
          <PhotoAutoAdvance index={index} count={count} zoomed={zoomed} goTo={goTo} enabled={autoAdvance} active={isActive} holding={holding} />
        )}
      />
    </View>
  );
}
