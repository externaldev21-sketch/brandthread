import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  useColorScheme, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

// ─── Mock data ────────────────────────────────────────────────────────────────

const FOLLOWING_BRANDS = [
  {
    id: 'b1', name: 'Vault Studio', handle: '@vaultstudio',
    initials: 'VS', color: '#7C3AED', verified: true,
    followers: '12.4K', hasNew: true,
    latestDrop: {
      name: 'Canvas Cargo Jacket',
      price: '$189',
      tag: 'New Drop',
      tagColor: '#7C3AED',
      desc: 'Oversized canvas jacket — limited run of 50.',
    },
  },
  {
    id: 'b2', name: 'Meridian Co.', handle: '@meridianclothing',
    initials: 'MC', color: '#0F766E', verified: false,
    followers: '8.1K', hasNew: true,
    latestDrop: {
      name: 'Essential Relaxed Tee',
      price: '$48',
      tag: 'Pre-order',
      tagColor: '#0F766E',
      desc: 'Clean minimal tees now in 6 colorways.',
    },
  },
  {
    id: 'b3', name: 'NxGen Drops', handle: '@nxgendrops',
    initials: 'NX', color: '#B45309', verified: true,
    followers: '31.2K', hasNew: false,
    latestDrop: {
      name: 'Archive Hoodie Vol. 3',
      price: '$135',
      tag: 'In Stock',
      tagColor: '#16A34A',
      desc: 'Garment-dyed heavyweight fleece, unisex sizing.',
    },
  },
  {
    id: 'b4', name: 'Softwear__', handle: '@softwear__',
    initials: 'SW', color: '#BE185D', verified: false,
    followers: '5.8K', hasNew: true,
    latestDrop: {
      name: 'Micro-Fleece Jogger',
      price: '$92',
      tag: 'New Drop',
      tagColor: '#BE185D',
      desc: 'Ultra-soft fleece with a relaxed silhouette.',
    },
  },
  {
    id: 'b5', name: 'Atlas Goods', handle: '@atlasgoods',
    initials: 'AG', color: '#1D4ED8', verified: true,
    followers: '19.7K', hasNew: false,
    latestDrop: {
      name: 'Utility Vest — Slate',
      price: '$220',
      tag: 'Limited',
      tagColor: '#1D4ED8',
      desc: 'Waxed cotton shell, 8 pockets. Ships in 2 weeks.',
    },
  },
];

// ─── Brand card ───────────────────────────────────────────────────────────────

function BrandDropCard({ brand, isDark }: { brand: typeof FOLLOWING_BRANDS[0]; isDark: boolean }) {
  const [saved, setSaved] = useState(false);
  const bg     = isDark ? '#111118' : '#FFFFFF';
  const border = isDark ? '#1E1E30' : '#DDD6FE';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#6D6892';

  return (
    <View style={[s.card, { backgroundColor: bg, borderColor: border }]}>
      {/* Brand header */}
      <View style={s.cardHeader}>
        <View style={[s.avatar, { backgroundColor: brand.color }]}>
          <Text style={s.avatarText}>{brand.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={[s.brandName, { color: fg }]}>{brand.name}</Text>
            {brand.verified && <Feather name="check-circle" size={13} color={brand.color} />}
          </View>
          <Text style={[s.brandHandle, { color: muted }]}>{brand.handle}</Text>
        </View>
        {brand.hasNew && (
          <View style={[s.newBadge, { backgroundColor: brand.color + '22', borderColor: brand.color + '44' }]}>
            <Text style={[s.newBadgeText, { color: brand.color }]}>NEW</Text>
          </View>
        )}
      </View>

      {/* Drop preview */}
      <LinearGradient
        colors={[brand.color + 'CC', brand.color + '44']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.dropVisual}
      >
        <View style={[s.dropInner, { backgroundColor: isDark ? '#00000040' : '#FFFFFF30' }]}>
          <Feather name="shopping-bag" size={28} color="#FFFFFF" />
          <Text style={s.dropName}>{brand.latestDrop.name}</Text>
          <Text style={s.dropPrice}>{brand.latestDrop.price}</Text>
        </View>
      </LinearGradient>

      {/* Drop info */}
      <View style={s.dropInfo}>
        <View style={[s.tagPill, { backgroundColor: brand.latestDrop.tagColor + '20', borderColor: brand.latestDrop.tagColor + '40' }]}>
          <Text style={[s.tagText, { color: brand.latestDrop.tagColor }]}>{brand.latestDrop.tag}</Text>
        </View>
        <Text style={[s.dropDesc, { color: muted }]} numberOfLines={2}>
          {brand.latestDrop.desc}
        </Text>
      </View>

      {/* Actions */}
      <View style={[s.cardFooter, { borderTopColor: border }]}>
        <TouchableOpacity
          onPress={() => { setSaved(!saved); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={s.footerBtn}
          activeOpacity={0.7}
        >
          <Feather name="bookmark" size={18} color={saved ? brand.color : muted} />
          <Text style={[s.footerBtnText, { color: muted }]}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.shopBtn, { backgroundColor: brand.color }]}
          activeOpacity={0.85}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
        >
          <Feather name="shopping-bag" size={14} color="#FFF" />
          <Text style={s.shopBtnText}>Shop Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FollowingScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';

  const bg     = isDark ? '#08080F' : '#F8F7FF';
  const fg     = isDark ? '#F0EEFF' : '#1A1035';
  const muted  = isDark ? '#6B6B8A' : '#6D6892';
  const border = isDark ? '#1E1E30' : '#DDD6FE';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  const newCount = FOLLOWING_BRANDS.filter(b => b.hasNew).length;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <View>
          <Text style={[s.headerTitle, { color: fg }]}>Following</Text>
          <Text style={[s.headerSub, { color: muted }]}>{newCount} new drops today</Text>
        </View>
        <TouchableOpacity style={[s.headerBtn, { borderColor: border }]} activeOpacity={0.7}>
          <Feather name="user-plus" size={18} color={muted} />
        </TouchableOpacity>
      </View>

      {/* Brand avatars row */}
      <View style={[s.avatarsRow, { borderBottomColor: border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.avatarsScroll}>
          {FOLLOWING_BRANDS.map(brand => (
            <TouchableOpacity key={brand.id} style={s.avatarItem} activeOpacity={0.8}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
              {brand.hasNew ? (
                <LinearGradient colors={['#F0ABFC', '#C026D3', '#7C3AED']} style={s.avatarRing}>
                  <View style={[s.avatarRingInner, { backgroundColor: bg }]}>
                    <View style={[s.avatarCircle, { backgroundColor: brand.color }]}>
                      <Text style={s.avatarInitials}>{brand.initials}</Text>
                    </View>
                  </View>
                </LinearGradient>
              ) : (
                <View style={[s.avatarRingViewed, { borderColor: border }]}>
                  <View style={[s.avatarCircle, { backgroundColor: brand.color }]}>
                    <Text style={s.avatarInitials}>{brand.initials}</Text>
                  </View>
                </View>
              )}
              <Text style={[s.avatarLabel, { color: muted }]} numberOfLines={1}>
                {brand.handle.replace('@', '')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Drop cards */}
      <FlatList
        data={FOLLOWING_BRANDS}
        keyExtractor={b => b.id}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <BrandDropCard brand={item} isDark={isDark} />}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  headerBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  avatarsRow:    { borderBottomWidth: 1, height: 100 },
  avatarsScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 14, alignItems: 'center' },
  avatarItem:    { alignItems: 'center', gap: 5, width: 62 },
  avatarRing:    { width: 62, height: 62, borderRadius: 31, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  avatarRingViewed: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarRingInner:  { width: 55, height: 55, borderRadius: 28, padding: 2, alignItems: 'center', justifyContent: 'center' },
  avatarCircle:     { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarInitials:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  avatarLabel:      { fontSize: 10, fontFamily: 'Inter_500Medium', textAlign: 'center', width: 62 },

  card:       { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar:     { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandName:  { fontSize: 15, fontFamily: 'Inter_700Bold' },
  brandHandle:{ fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  newBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  newBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  dropVisual: { height: 160, alignItems: 'center', justifyContent: 'center' },
  dropInner:  { alignItems: 'center', gap: 8, padding: 20, borderRadius: 16 },
  dropName:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center' },
  dropPrice:  { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  dropInfo:   { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  tagPill:    { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  tagText:    { fontSize: 11, fontFamily: 'Inter_700Bold' },
  dropDesc:   { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderTopWidth: 1 },
  footerBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  footerBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  shopBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  shopBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
