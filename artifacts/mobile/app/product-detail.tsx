import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { DEMO_PRODUCTS } from '@/services/data';

const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const ORANGE = '#F97316';
const RED    = '#EF4444';
const PURPLE = '#8B5CF6';

const TABS = ['Overview', 'Variants', 'Inventory', 'Orders', 'Analytics', 'Content'];

export default function ProductDetailScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { id }  = useLocalSearchParams<{ id?: string }>();
  const product = DEMO_PRODUCTS.find(p => p.id === id) ?? DEMO_PRODUCTS[0];
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [activeTab, setActiveTab] = useState(0);

  const margin = product.price - product.cost;
  const marginPct = Math.round((margin / product.price) * 100);
  const lowStk = product.variants.filter(v => v.inventory <= product.lowStockThreshold);

  function back() { router.back(); }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={back}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{product.name}</Text>
        <TouchableOpacity style={s.editBtn} onPress={() => router.push('/add-product' as never)} activeOpacity={0.85}>
          <Feather name="edit-2" size={15} color="#0A0B0A" />
          <Text style={s.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Tab navigation */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll}>
        <View style={s.tabRow}>
          {TABS.map((tab, i) => (
            <TouchableOpacity
              key={tab}
              style={[s.tab, activeTab === i && s.tabActive]}
              onPress={() => { setActiveTab(i); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.tabText, activeTab === i && s.tabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 14 }}>

        {/* ── Overview ── */}
        {activeTab === 0 && (
          <>
            <View style={s.heroCard}>
              <View style={s.heroThumb}>
                <Feather name="tag" size={32} color={MUTED} />
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <View style={s.statusRow}>
                  <View style={[s.statusBadge, {
                    backgroundColor: product.status === 'active' ? GREEN + '20' : ORANGE + '20',
                    borderColor:     product.status === 'active' ? GREEN + '44' : ORANGE + '44',
                  }]}>
                    <Text style={[s.statusText, { color: product.status === 'active' ? GREEN : ORANGE }]}>
                      {product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                    </Text>
                  </View>
                  <Text style={s.productType}>{product.category} · {product.productType}</Text>
                </View>
                <View style={s.priceRow}>
                  <Text style={s.price}>${product.price.toFixed(2)}</Text>
                  {product.compareAtPrice && (
                    <Text style={s.compareAt}>${product.compareAtPrice.toFixed(2)}</Text>
                  )}
                </View>
                <Text style={s.vendor}>Vendor: {product.vendor}</Text>
              </View>
            </View>

            <View style={s.metricsGrid}>
              {[
                { label: 'Revenue',     value: `$${(product.revenue / 1000).toFixed(1)}K`, color: GREEN  },
                { label: 'Total Sales', value: product.totalSales.toLocaleString(),          color: BLUE   },
                { label: 'Inventory',   value: product.totalInventory.toString(),            color: product.totalInventory < 20 ? ORANGE : FG },
                { label: 'Margin',      value: `${marginPct}%`,                              color: marginPct >= 50 ? GREEN : ORANGE },
                { label: 'Variants',    value: product.variants.length.toString(),           color: FG     },
                { label: 'Cost',        value: `$${product.cost.toFixed(2)}`,                color: MUTED  },
              ].map(m => (
                <View key={m.label} style={s.metricCard}>
                  <Text style={[s.metricValue, { color: m.color }]}>{m.value}</Text>
                  <Text style={s.metricLabel}>{m.label}</Text>
                </View>
              ))}
            </View>

            {lowStk.length > 0 && (
              <View style={s.alertCard}>
                <Feather name="alert-triangle" size={14} color={ORANGE} />
                <Text style={s.alertText}>{lowStk.length} variant{lowStk.length > 1 ? 's' : ''} running low or out of stock</Text>
                <TouchableOpacity onPress={() => setActiveTab(2)}><Text style={s.alertLink}>View</Text></TouchableOpacity>
              </View>
            )}

            <View style={s.descCard}>
              <Text style={s.descTitle}>Description</Text>
              <Text style={s.descText}>{product.description}</Text>
            </View>

            <View style={s.tagsCard}>
              <Text style={s.descTitle}>Tags</Text>
              <View style={s.tagRow}>
                {product.tags.map(tag => (
                  <View key={tag} style={s.tag}>
                    <Text style={s.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {/* ── Variants ── */}
        {activeTab === 1 && (
          <View style={s.listCard}>
            <View style={s.listHead}>
              <Text style={s.listTitle}>{product.variants.length} Variants</Text>
              <TouchableOpacity style={s.addBtn} onPress={() => {}}>
                <Feather name="plus" size={13} color="#0A0B0A" />
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            {product.variants.map((v, i) => (
              <View key={v.id} style={[s.variantRow, i > 0 && s.borderTop]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.variantName}>{v.color} — {v.size}</Text>
                  <Text style={s.variantSku}>{v.sku}</Text>
                </View>
                <Text style={[s.variantQty, { color: v.inventory === 0 ? RED : v.inventory <= product.lowStockThreshold ? ORANGE : GREEN }]}>
                  {v.inventory === 0 ? 'Out' : `${v.inventory}`}
                </Text>
                <Text style={s.variantPrice}>${v.price.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Inventory ── */}
        {activeTab === 2 && (
          <View style={s.listCard}>
            <Text style={s.listTitle}>Inventory by variant</Text>
            {product.variants.map((v, i) => {
              const isOut = v.inventory === 0;
              const isLow = !isOut && v.inventory <= product.lowStockThreshold;
              return (
                <View key={v.id} style={[s.invRow, i > 0 && s.borderTop]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.variantName}>{v.color} — {v.size}</Text>
                    <Text style={s.variantSku}>{v.sku}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[s.variantQty, { color: isOut ? RED : isLow ? ORANGE : FG }]}>
                      {isOut ? 'Out of stock' : `${v.inventory} units`}
                    </Text>
                    <TouchableOpacity
                      style={[s.adjustBtn, { backgroundColor: (isOut ? RED : isLow ? ORANGE : GREEN) + '20' }]}
                      onPress={() => Alert.alert('Adjust Stock', `Adjust stock for ${v.color} — ${v.size}`)}
                    >
                      <Text style={[s.adjustText, { color: isOut ? RED : isLow ? ORANGE : GREEN }]}>
                        {isOut ? 'Restock' : 'Adjust'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Orders / Analytics / Content (stubs) ── */}
        {activeTab >= 3 && (
          <View style={s.emptyCard}>
            <Feather name={activeTab === 3 ? 'shopping-bag' : activeTab === 4 ? 'bar-chart-2' : 'video'} size={32} color={MUTED} />
            <Text style={s.emptyTitle}>{TABS[activeTab]}</Text>
            <Text style={s.emptyDesc}>
              {activeTab === 3 ? `${DEMO_PRODUCTS[0].totalSales} total orders for this product.` :
               activeTab === 4 ? 'Analytics data will appear here.' :
               'Content tagged with this product.'}
            </Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  editText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  tabScroll:  { flexGrow: 0 },
  tabRow:     { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
  tab:        { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  tabActive:  { backgroundColor: GREEN + '22', borderColor: GREEN },
  tabText:    { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  tabTextActive: { color: GREEN },

  heroCard:   { flexDirection: 'row', gap: 14, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14 },
  heroThumb:  { width: 80, height: 80, borderRadius: 14, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  statusRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText: { fontSize: 9, fontFamily: 'Inter_700Bold' },
  productType:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  priceRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  price:      { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG },
  compareAt:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textDecorationLine: 'line-through' },
  vendor:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  metricsGrid:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, alignItems: 'center', width: '31%', gap: 4 },
  metricValue:{ fontSize: 18, fontFamily: 'Inter_700Bold' },
  metricLabel:{ fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },

  alertCard:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ORANGE + '15', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: ORANGE + '33' },
  alertText:  { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: ORANGE },
  alertLink:  { fontSize: 12, fontFamily: 'Inter_700Bold', color: ORANGE },

  descCard:   { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 8 },
  descTitle:  { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, letterSpacing: 0.3, textTransform: 'uppercase' },
  descText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 20 },
  tagsCard:   { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 10 },
  tagRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag:        { backgroundColor: '#1A1E1A', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  tagText:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  listCard:   { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  listHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  listTitle:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  addBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  borderTop:  { borderTopWidth: 1, borderTopColor: BORDER },
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  variantName:{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  variantSku: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  variantQty: { fontSize: 13, fontFamily: 'Inter_700Bold', width: 36, textAlign: 'right' },
  variantPrice:{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG, width: 55, textAlign: 'right' },
  invRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  adjustBtn:  { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  adjustText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  emptyCard:  { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', maxWidth: 260 },
});
