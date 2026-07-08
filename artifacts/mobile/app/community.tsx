import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';

const FORUM_POSTS = [
  { user: 'Maria V.', title: 'How I got my first 100 orders', likes: 284, comments: 42, time: '2h ago', badge: 'Trending' },
  { user: 'Kai T.', title: 'Best manufacturers for premium denim?', likes: 98, comments: 31, time: '5h ago', badge: null },
  { user: 'Zoe R.', title: 'AI mockups saved me $3k in photography', likes: 176, comments: 24, time: '1d ago', badge: 'Popular' },
  { user: 'Milo C.', title: 'My first 6 months: what I wish I knew', likes: 412, comments: 88, time: '2d ago', badge: 'Pinned' },
];

const EVENTS = [
  { title: 'Live: Sourcing Your First Collection', host: 'Brandthread Team', date: 'Jul 12, 3 PM EST', attendees: 342 },
  { title: 'Mentorship Office Hours', host: 'Maria V. (Top Brand)', date: 'Jul 14, 5 PM EST', attendees: 84 },
  { title: 'AI Design Workshop', host: 'Design Team', date: 'Jul 18, 2 PM EST', attendees: 218 },
];

const FREELANCERS = [
  { name: 'Alex P.', skill: 'Graphic Design', rating: 5.0, rate: '$80/hr', badge: 'Top Rated' },
  { name: 'Lin W.', skill: 'Copywriting', rating: 4.9, rate: '$55/hr', badge: null },
  { name: 'Sam K.', skill: 'Social Media', rating: 4.8, rate: '$65/hr', badge: 'New' },
];

export default function CommunityScreen() {
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<'forum' | 'events' | 'hire'>('forum');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Community" subtitle="Connect, learn & grow with other brand founders" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Member Badge */}
      <View style={[styles.memberCard, { backgroundColor: '#17140F', borderColor: '#C1440E44' }]}>
        <Feather name="award" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.memberTitle, { color: colors.foreground }]}>Member since Jan 2025</Text>
          <Text style={[styles.memberSub, { color: colors.mutedForeground }]}>12,400+ brand founders worldwide</Text>
        </View>
        <View style={[styles.memberBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.memberBadgeText, { color: colors.primaryForeground }]}>PRO</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['forum', 'events', 'hire'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabBtn, { backgroundColor: tab === t ? colors.primary : 'transparent' }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: tab === t ? colors.primaryForeground : colors.mutedForeground }]}>
              {t === 'forum' ? 'Forum' : t === 'events' ? 'Events' : 'Hire'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'forum' && (
        <>
          {FORUM_POSTS.map((post, i) => (
            <TouchableOpacity
              key={post.title}
              activeOpacity={0.8}
              style={[styles.postCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.postHeader}>
                <View style={[styles.userAvatar, { backgroundColor: '#C1440E33' }]}>
                  <Text style={[styles.userInitial, { color: colors.primary }]}>{post.user[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.userName, { color: colors.mutedForeground }]}>{post.user} · {post.time}</Text>
                  <Text style={[styles.postTitle, { color: colors.foreground }]}>{post.title}</Text>
                </View>
                {post.badge != null && <Badge label={post.badge} variant={post.badge === 'Trending' ? 'error' : post.badge === 'Pinned' ? 'gold' : 'info'} />}
              </View>
              <View style={[styles.postFooter, { borderTopColor: colors.border }]}>
                <Feather name="heart" size={14} color={colors.mutedForeground} />
                <Text style={[styles.postStat, { color: colors.mutedForeground }]}>{post.likes}</Text>
                <Feather name="message-circle" size={14} color={colors.mutedForeground} />
                <Text style={[styles.postStat, { color: colors.mutedForeground }]}>{post.comments}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {tab === 'events' && (
        <>
          {EVENTS.map((e) => (
            <View key={e.title} style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.eventBadge, { backgroundColor: '#C1440E22' }]}>
                <Feather name="video" size={14} color={colors.primary} />
                <Text style={[styles.eventBadgeText, { color: colors.primary }]}>LIVE</Text>
              </View>
              <Text style={[styles.eventTitle, { color: colors.foreground }]}>{e.title}</Text>
              <Text style={[styles.eventHost, { color: colors.mutedForeground }]}>Hosted by {e.host}</Text>
              <View style={styles.eventMeta}>
                <Feather name="calendar" size={13} color={colors.mutedForeground} />
                <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{e.date}</Text>
                <Feather name="users" size={13} color={colors.mutedForeground} />
                <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{e.attendees} attending</Text>
              </View>
              <TouchableOpacity style={[styles.rsvpBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
                <Text style={[styles.rsvpText, { color: colors.primaryForeground }]}>RSVP</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {tab === 'hire' && (
        <>
          <Text style={[styles.hireSubtitle, { color: colors.mutedForeground }]}>Vetted creatives ready to work on your brand</Text>
          {FREELANCERS.map((f) => (
            <View key={f.name} style={[styles.freelancerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.freAvatar, { backgroundColor: '#C1440E22' }]}>
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
        </>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 20 },
  memberTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  memberSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  memberBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  memberBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  tabRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  postCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  userAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  userInitial: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  userName: { fontSize: 11, fontFamily: 'Inter_400Regular', marginBottom: 3 },
  postTitle: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  postFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  postStat: { fontSize: 12, fontFamily: 'Inter_400Regular', marginRight: 8 },
  eventCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  eventBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 10 },
  eventBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  eventTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  eventHost: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  eventDate: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  rsvpBtn: { borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  rsvpText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
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
