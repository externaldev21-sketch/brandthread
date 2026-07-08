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

const WISHLIST_ITEMS = [
  { id: 'w1', brand: 'Vault Studio', name: 'Canvas Cargo Jacket', price: '$189', color: '#B33F1E', initials: 'VS', available: true,  tag: 'Limited — 14 left' },
  { id: 'w2', brand: 'Meridian Co.', name: 'Essential Relaxed Tee', price: '$48', color: '#0F766E', initials: 'MC', available: true,  tag: 'Pre-order open' },
  { id: 'w3', brand: 'Atlas Goods', name: 'Utility Vest — Slate', price: '$220', color: '#1D4ED8', initials: 'AG', available: false, tag: 'Sold out' },
  { id: 'w4', brand: 'Softwear__', name: 'Micro-Fleece Jogger', price: '$92', color: '#BE185D', initials: 'SW', available: true,  tag: 'In stock' },
  { id: 'w5', brand: 'NxGen Drops', name: 'Archive Hoodie Vol. 3', price: '$135', color: '#B45309', initials: 'NX', available: true,  tag: '8 left' },
  { id: 'w6', brand: 'Coldform', name: 'Raw Denim Jacket', price: '$310', color: '#065F46', initials: 'CF', available: false, tag: 'Restocking soon' },
];

// ─── Item card ────────────────────────────────────────────────────────────────

function WishlistCard({
  item, isDark, onRemove,
}: {
  item: typeof WISHLIST_ITEMS[0];
  isDark: boolean;
  onRemove: (id: string) => void;
}) {
  const bg     = isDark ? '#1B1917' : '#FFFFFF';
  const border = isDark ? '#33302A' : '#DBD3C0';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#6E6759';

  const tagColor = item.available ? '#3F7A4F' : '#DC2626';

  return (
    <View style={[c.card, { backgroundColor: bg, borderColor: border }]}>
      {/* Visual */}
      <LinearGradient
        colors={[item.color + 'DD', item.color + '55']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={c.cardVisual}
      >
        {!item.available && (
          <View style={c.soldOutOverlay}>
            <Text style={c.soldOutText}>SOLD OUT</Text>
          </View>
        )}
        <View style={[c.productIcon, { backgroundColor: '#FFFFFF25' }]}>
          <Feather name="shopping-bag" size={22} color="#FFFFFF" />
        </View>
      </LinearGradient>

      {/* Info */}
      <View style={c.cardBody}>
        {/* Brand */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <View style={[c.brandDot, { backgroundColor: item.color }]}>
            <Text style={c.brandDotText}>{item.initials[0]}</Text>
          </View>
          <Text style={[c.brandName, { color: muted }]}>{item.brand}</Text>
        </View>

        <Text style={[c.productName, { color: fg }]} numberOfLines={2}>{item.name}</Text>
        <Text style={[c.price, { color: item.color }]}>{item.price}</Text>

        {/* Availability tag */}
        <View style={[c.availTag, { backgroundColor: tagColor + '18', borderColor: tagColor + '40' }]}>
          <View style={[c.availDot, { backgroundColor: tagColor }]} />
          <Text style={[c.availText, { color: tagColor }]}>{item.tag}</Text>
        </View>
      </View>

      {/* Footer actions */}
      <View style={[c.cardFooter, { borderTopColor: border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemove(item.id); }}
          style={c.removeBtn}
          activeOpacity={0.7}
        >
          <Feather name="trash-2" size={15} color={muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[c.shopBtn, {
            backgroundColor: item.available ? item.color : (isDark ? '#33302A' : '#E5E3F0'),
            opacity: item.available ? 1 : 0.6,
          }]}
          disabled={!item.available}
          activeOpacity={0.85}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
        >
          <Text style={[c.shopBtnText, { color: item.available ? '#FFFFFF' : muted }]}>
            {item.available ? 'Shop Now' : 'Notify Me'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const [items, setItems] = useState(WISHLIST_ITEMS);

  const bg     = isDark ? '#121110' : '#F2EEE3';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#6E6759';
  const border = isDark ? '#33302A' : '#DBD3C0';
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
  }

  const available = items.filter(i => i.available).length;

  return (
    <View style={[c.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[c.header, { paddingTop: insets.top + 16, borderBottomColor: border }]}>
        <View>
          <Text style={[c.headerTitle, { color: fg }]}>Wishlist</Text>
          <Text style={[c.headerSub, { color: muted }]}>{available} of {items.length} items available</Text>
        </View>
        <TouchableOpacity style={[c.headerBtn, { borderColor: border }]} activeOpacity={0.7}>
          <Feather name="share-2" size={18} color={muted} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={c.empty}>
          <Feather name="bookmark" size={48} color={muted} />
          <Text style={[c.emptyTitle, { color: fg }]}>Nothing saved yet</Text>
          <Text style={[c.emptySub, { color: muted }]}>Tap the bookmark icon on any drop to save it here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          numColumns={2}
          contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 120 }}
          columnWrapperStyle={{ gap: 12 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <WishlistCard item={item} isDark={isDark} onRemove={removeItem} />
            </View>
          )}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const c = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  headerBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  card:        { borderRadius: 18, borderWidth: 1, overflow: 'hidden', flex: 1 },
  cardVisual:  { height: 130, alignItems: 'center', justifyContent: 'center' },
  soldOutOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000060', alignItems: 'center', justifyContent: 'center' },
  soldOutText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 1.5 },
  productIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

  cardBody:    { padding: 12, gap: 4 },
  brandDot:    { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brandDotText:{ fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandName:   { fontSize: 11, fontFamily: 'Inter_500Medium' },
  productName: { fontSize: 13, fontFamily: 'Inter_700Bold', lineHeight: 17 },
  price:       { fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 2 },

  availTag:    { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, borderWidth: 1, marginTop: 4 },
  availDot:    { width: 5, height: 5, borderRadius: 3 },
  availText:   { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  cardFooter:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1 },
  removeBtn:   { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  shopBtn:     { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  shopBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTitle:  { fontSize: 20, fontFamily: 'Inter_700Bold' },
  emptySub:    { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
