import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';

const FREELANCERS = [
  { name: 'Alex P.', skill: 'Graphic Design', rating: 5.0, rate: '$80/hr', badge: 'Top Rated' },
  { name: 'Lin W.', skill: 'Copywriting', rating: 4.9, rate: '$55/hr', badge: null },
  { name: 'Sam K.', skill: 'Social Media', rating: 4.8, rate: '$65/hr', badge: 'New' },
];

export default function CommunityScreen() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Community" subtitle="Connect, learn & grow with other brand founders" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Member Badge */}
      <View style={[styles.memberCard, { backgroundColor: '#17140F', borderColor: '#00C85344' }]}>
        <Feather name="award" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.memberTitle, { color: colors.foreground }]}>Member since Jan 2025</Text>
          <Text style={[styles.memberSub, { color: colors.mutedForeground }]}>12,400+ brand founders worldwide</Text>
        </View>
        <View style={[styles.memberBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.memberBadgeText, { color: colors.primaryForeground }]}>PRO</Text>
        </View>
      </View>

      <Text style={[styles.hireSubtitle, { color: colors.mutedForeground }]}>Vetted creatives ready to work on your brand</Text>
      {FREELANCERS.map((f) => (
        <View key={f.name} style={[styles.freelancerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.freAvatar, { backgroundColor: '#00C85322' }]}>
            <Text style={[styles.freInitial, { color: colors.primary }]}>{f.name[0]}</Text>
          </View>
          <View style={styles.freInfo}>
            <Text style={[styles.freName, { color: colors.foreground }]}>{f.name}</Text>
            <Text style={[styles.freSkill, { color: colors.mutedForeground }]}>{f.skill}</Text>
            <View style={styles.freRating}>
              <Feather name="star" size={12} color={colors.primary} />
              <Text style={[styles.freRatingText, { color: colors.foreground }]}>{f.rating}</Text>
              {f.badge != null && <Badge label={f.badge} variant={f.badge === 'Top Rated' ? 'gold' : 'success'} />}
            </View>
          </View>
          <View style={styles.freRight}>
            <Text style={[styles.freRate, { color: colors.foreground }]}>{f.rate}</Text>
            <TouchableOpacity style={[styles.hireBtn, { backgroundColor: colors.secondary }]} activeOpacity={0.8}>
              <Text style={[styles.hireBtnText, { color: colors.foreground }]}>Hire</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 20 },
  memberTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  memberSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  memberBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  memberBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  hireSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  freelancerCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  freAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  freInitial: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  freInfo: { flex: 1, gap: 2 },
  freName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  freSkill: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  freRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  freRatingText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  freRight: { alignItems: 'flex-end', gap: 8 },
  freRate: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  hireBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 10 },
  hireBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
