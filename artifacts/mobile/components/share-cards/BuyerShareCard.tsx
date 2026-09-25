import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { BuyerShareCardData, ShareCardVariant } from '@/lib/shareCard';
import { ShareCardFrame } from './ShareCardFrame';

interface BuyerShareCardProps {
  theme: AppThemePreset;
  data: BuyerShareCardData;
  variant: ShareCardVariant;
  qrValue: string | null;
}

export const BuyerShareCard = React.forwardRef<View, BuyerShareCardProps>(
  function BuyerShareCard({ theme, data, variant, qrValue }, ref) {
    const initials = data.name.trim().slice(0, 1).toUpperCase() || '?';
    const thumbs = data.topPosts.slice(0, 3);

    return (
      <ShareCardFrame ref={ref} theme={theme} qrValue={qrValue}>
        <View style={[styles.avatar, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
          {data.avatarUri ? (
            <Image source={{ uri: data.avatarUri }} style={styles.avatarImg} />
          ) : (
            <Text style={[styles.avatarInitials, { color: theme.text }]}>{initials}</Text>
          )}
        </View>

        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{data.name}</Text>
        <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{data.handle}</Text>

        <View style={[styles.statPill, { borderColor: theme.border, backgroundColor: theme.cardGlass }]}>
          <Feather name="users" size={13} color={theme.text} />
          <Text style={[styles.statText, { color: theme.text }]}>
            {data.statValue} {data.statLabel}
          </Text>
        </View>

        {variant === 'grid' && thumbs.length > 0 ? (
          <View style={styles.thumbRow}>
            {thumbs.map(post => (
              <View key={post.id} style={[styles.thumb, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
                {post.uri ? <Image source={{ uri: post.uri }} style={styles.thumbImg} /> : null}
              </View>
            ))}
          </View>
        ) : null}

        <Text style={[styles.tagline, { color: theme.muted }]}>Find me on Brandthread</Text>
      </ShareCardFrame>
    );
  },
);

const styles = StyleSheet.create({
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: SP.md,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { fontFamily: FONT.bold, fontSize: FS.xxl },
  name: { fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  handle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, textAlign: 'center' },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SP.md,
    paddingHorizontal: SP.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  statText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  thumbRow: { flexDirection: 'row', gap: 6, marginTop: SP.lg },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  tagline: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.lg, textAlign: 'center' },
});
