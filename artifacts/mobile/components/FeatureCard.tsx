import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';

interface FeatureCardProps {
  title: string;
  subtitle?: string;
  icon: keyof typeof Feather.glyphMap;
  onPress?: () => void;
  accent?: boolean;
  badge?: string;
}

export function FeatureCard({ title, subtitle, icon, onPress, accent = false, badge }: FeatureCardProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: accent ? colors.primary : colors.border,
          borderWidth: accent ? 1.5 : 1,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: accent ? colors.muted : colors.secondary }]}>
        <Feather name={icon} size={20} color={accent ? colors.primary : colors.mutedForeground} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle != null && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {badge != null && (
        <View style={[styles.badge, { backgroundColor: colors.muted }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]}>{badge}</Text>
        </View>
      )}
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    padding: 14,
    gap: 12,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
