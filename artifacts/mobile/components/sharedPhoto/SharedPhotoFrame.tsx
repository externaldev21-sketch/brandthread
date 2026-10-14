/**
 * Wrap a product tile's photo in this; `openWithSharedPhoto` then grows that
 * exact photo into the product page (lib/sharedPhoto.ts). The frame only
 * remembers that it was the one touched — it renders nothing of its own.
 */
import React, { useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { markSharedPhotoTouched } from '@/lib/sharedPhoto';

export function SharedPhotoFrame({ productId, uri, radius = 0, style, children }: {
  productId: string;
  uri?: string | null;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      onTouchStart={() => markSharedPhotoTouched({ productId, uri: uri ?? null, radius, node: ref.current })}
    >
      {children}
    </View>
  );
}
