/**
 * Visuals shared by the story composer and the story viewer so a mention
 * sticker / reshare card looks identical on both sides.
 *
 *  - MentionStickerView: the @username sticker in its four monochrome styles.
 *  - ReshareCard: the original story as a rounded card with its credit row.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS, ON_DARK, SP } from '@/lib/theme';
import { withAt, type MentionStyle } from '@/lib/storyMentionSticker';
import { RESHARE_CARD_RADIUS } from '@/lib/storyReshare';

export const RESHARE_CARD_WIDTH = 252;
export const RESHARE_CARD_HEIGHT = 448; // 9:16

export function MentionStickerView({ handle, variant = 'classic' }: { handle?: string; variant?: MentionStyle }) {
  const label = withAt(handle) || '@username';
  const v = variantStyles[variant] ?? variantStyles.classic;
  return (
    <View style={[styles.base, v.box]}>
      <Text style={[styles.text, v.text]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function ReshareCard({
  imageUri, radius = RESHARE_CARD_RADIUS, handle, unavailable, onCreditPress,
}: {
  imageUri?: string;
  radius?: number;
  /** Credit comes from story.original (viewer) / the route param (editor), never from media. */
  handle?: string;
  unavailable?: boolean;
  onCreditPress?: () => void;
}) {
  return (
    <View style={[styles.card, { borderRadius: radius }]}>
      {unavailable || !imageUri ? (
        <View style={styles.cardUnavailable}>
          <Icon name="slash" size={28} color="rgba(255,255,255,0.7)" />
          <Text style={styles.cardUnavailableText}>Story unavailable</Text>
        </View>
      ) : (
        <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {handle ? (
        <View style={styles.creditWrap}>
          <Pressable
            onPress={onCreditPress}
            disabled={!onCreditPress}
            hitSlop={8}
            style={styles.creditPill}
            accessibilityRole={onCreditPress ? 'button' : 'text'}
            accessibilityLabel={onCreditPress ? `Open ${withAt(handle)}'s story` : `From ${withAt(handle)}`}
          >
            <Text style={styles.creditText} numberOfLines={1}>{withAt(handle)}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5, borderColor: 'transparent' },
  text: { fontSize: FS.md, fontFamily: FONT.bold },

  card: {
    width: RESHARE_CARD_WIDTH, height: RESHARE_CARD_HEIGHT, overflow: 'hidden',
    backgroundColor: '#0B0B0B', borderWidth: 1, borderColor: 'rgba(192,192,192,0.28)',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cardUnavailable: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  cardUnavailableText: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.semibold },
  creditWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: SP.sm, paddingBottom: SP.sm, paddingTop: SP.xl,
    backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'flex-start',
  },
  creditPill: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  creditText: { color: ON_DARK, fontSize: FS.sm, fontFamily: FONT.semibold },
});

// Monochrome only: black / white / silver.
const variantStyles: Record<MentionStyle, { box: object; text: object }> = {
  classic: {
    box: { backgroundColor: 'rgba(0,0,0,0.6)' },
    text: { color: '#FFFFFF' },
  },
  outline: {
    box: { backgroundColor: 'transparent', borderColor: '#FFFFFF' },
    text: { color: '#FFFFFF' },
  },
  solid: {
    box: { backgroundColor: '#FFFFFF' },
    text: { color: '#000000' },
  },
  neon: {
    box: { backgroundColor: '#000000', borderColor: '#C7C7CC', shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
    text: { color: '#FFFFFF', textShadowColor: '#FFFFFF', textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  },
};
