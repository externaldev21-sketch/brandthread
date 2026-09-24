/**
 * BrandDropsCard — small, standalone entry point surfaced on a seller's public
 * profile when they have a live or upcoming drop. Renders nothing (null) when
 * the seller has no active drops, so it never clutters someone else's profile
 * with an empty state.
 *
 * There is no server filter-by-seller on the public drops list endpoint, so
 * this filters the small "live"/"upcoming" lists client-side by ownerId —
 * acceptable given how small those lists are.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

interface BrandDropsCardProps {
  sellerId: string;
  sellerName?: string;
}

interface MiniDrop {
  id: string;
  name: string;
  isLive: boolean;
  releaseAt?: string | null;
  effectiveReleaseAt?: string | null;
  ownerId?: string;
  sellerId?: string;
}

function ownerMatches(drop: MiniDrop, sellerId: string): boolean {
  return drop.ownerId === sellerId || drop.sellerId === sellerId;
}

export function BrandDropsCard({ sellerId, sellerName }: BrandDropsCardProps) {
  const api = useApi();
  const router = useRouter();
  const { theme } = useAppTheme();
  const [drop, setDrop] = useState<MiniDrop | null>(null);

  useEffect(() => {
    let active = true;
    if (!sellerId) return () => { active = false; };
    Promise.all([
      api.publicDrops.list('live').catch(() => []),
      api.publicDrops.list('upcoming').catch(() => []),
    ]).then(([live, upcoming]) => {
      if (!active) return;
      const liveMatch = (Array.isArray(live) ? live : []).find(d => ownerMatches(d, sellerId));
      if (liveMatch) {
        setDrop({ ...liveMatch, isLive: true });
        return;
      }
      const upcomingMatches = (Array.isArray(upcoming) ? upcoming : [])
        .filter(d => ownerMatches(d, sellerId))
        .sort((a, b) =>
          new Date(a.effectiveReleaseAt ?? a.releaseAt ?? 0).getTime() -
          new Date(b.effectiveReleaseAt ?? b.releaseAt ?? 0).getTime());
      setDrop(upcomingMatches[0] ? { ...upcomingMatches[0], isLive: false } : null);
    }).catch(() => { if (active) setDrop(null); });
    return () => { active = false; };
  }, [sellerId, api]);

  if (!drop) return null;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((`/buyer-drop-detail?dropId=${encodeURIComponent(drop!.id)}&dropName=${encodeURIComponent(drop!.name)}`) as never);
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.cardElevated, borderColor: drop.isLive ? theme.accent : theme.border }]}
      activeOpacity={0.85}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${drop.isLive ? 'Live drop' : 'Upcoming drop'}: ${drop.name}${sellerName ? ` by ${sellerName}` : ''}`}
      testID="brand-drops-card"
    >
      <View style={[styles.iconWrap, { backgroundColor: drop.isLive ? `${theme.accent}22` : theme.card }]}>
        <Feather name="zap" size={17} color={drop.isLive ? theme.accent : theme.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.eyebrow, { color: drop.isLive ? theme.accent : theme.muted }]}>
          {drop.isLive ? 'LIVE DROP' : 'UPCOMING DROP'}
        </Text>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{drop.name}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.muted} />
    </TouchableOpacity>
  );
}

export default BrandDropsCard;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
    marginBottom: SP.md,
    padding: SP.sm + 2,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 1.1,
    marginBottom: 2,
  },
  name: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
});
