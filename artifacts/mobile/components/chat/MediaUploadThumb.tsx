import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import UploadRing from './UploadRing';
import { RADIUS } from '@/lib/theme';

/**
 * Real thumbnail for a staged photo/video attachment in the composer, with a
 * dimmed overlay + spinning UploadRing while the file is uploading — item 74
 * (photo/video send with upload progress ring).
 *
 * Mobbin: WhatsApp "media send with a circular overlay control on the
 * thumbnail" (mobbin.com/screens/170ac3cf-9585-458d-9cf6-8f7b3448d58e) is the
 * closest indexed reference found — it shows a dark circular control
 * overlaid on the media thumbnail mid-send. Adapted here as a circular
 * PROGRESS ring (UploadRing) rather than a static button glyph, since
 * "upload progress ring" specifically calls for a ring communicating
 * in-flight work, not a static icon.
 *
 * Image attachments show the REAL picked photo (its local URI while
 * uploading, swapped to the uploaded remote URL once the upload resolves —
 * see handlePickPhoto in app/buyer-conversation.tsx / app/seller-
 * conversation.tsx). Video attachments show a plain icon tile instead of
 * attempting a video-frame thumbnail: the app has no video-poster-frame
 * extraction anywhere (the sent video bubble already just reuses the
 * attachment's own uri as an <Image> source, which fails silently for an
 * actual video file — a pre-existing gap, out of scope here), and faking a
 * frame would be dishonest, so this deliberately shows a plain glyph instead.
 */
export default function MediaUploadThumb({
  type,
  uri,
  uploading,
  size = 40,
  ringColor,
  iconColor,
  trackColor,
}: {
  type: 'image' | 'video';
  uri?: string;
  uploading: boolean;
  size?: number;
  ringColor: string;
  iconColor: string;
  trackColor: string;
}) {
  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor: trackColor }]} testID="media-upload-thumb">
      {type === 'image' && uri ? (
        <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} recyclingKey={uri} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Feather name={type === 'video' ? 'video' : 'image'} size={size * 0.46} color={iconColor} />
        </View>
      )}
      {uploading && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} testID="media-upload-thumb-overlay">
          <UploadRing size={size * 0.6} color="#fff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: RADIUS.sm, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  // Dimmed dark overlay, monochrome — matches the Mobbin reference's "dark
  // circular overlay control on the thumbnail" treatment (fixed opacity
  // black, not a new accent color).
  overlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
});
