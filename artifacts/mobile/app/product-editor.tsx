import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Badge } from '@/components/Badge';
import { useApi } from '@/hooks/useApi';

const CHANNELS = 'Online Store, Point of Sale, Shop, Faire: Sell Wholesale';

function Row({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      activeOpacity={0.6}
      onPress={onPress}
      disabled={!onPress}
    >
      {icon && <Feather name={icon} size={17} color={colors.mutedForeground} style={styles.rowIcon} />}
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {value && <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text>}
      </View>
      {showChevron && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </TouchableOpacity>
  );
}

function PlusRow({ label, onPress }: { label: string; onPress?: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      activeOpacity={0.6}
      onPress={onPress}
    >
      <View style={[styles.plusCircle, { borderColor: colors.mutedForeground }]}>
        <Feather name="plus" size={13} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.rowLabel, { flex: 1, color: colors.foreground }]}>{label}</Text>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

export default function ProductEditorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [available, setAvailable] = useState(0);
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleSave() {
    haptic();
    if (!title.trim()) {
      Alert.alert('Add a product title', 'Give your product a name before saving.');
      return;
    }
    setSaving(true);
    const priceDollars = parseFloat(price);
    try {
      await api.products.create({
        name:     title.trim(),
        status:   'active',
        ...(priceDollars > 0 ? {
          variants: [{
            sku:        title.trim().replace(/\s+/g, '-').toUpperCase() + '-DEFAULT',
            priceCents: Math.round(priceDollars * 100),
            stock:      available,
          }],
        } : {}),
      });
      Alert.alert('Product saved', `"${title}" has been added to your store.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save product. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    haptic();
    router.back();
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.pillBtn, { backgroundColor: colors.secondary }]}
          activeOpacity={0.7}
          onPress={handleCancel}
        >
          <Text style={[styles.pillBtnText, { color: colors.foreground }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pillBtn, { backgroundColor: title.trim() ? colors.primary : colors.secondary }]}
          activeOpacity={0.7}
          onPress={handleSave}
        >
          <Text style={[styles.pillBtnText, { color: title.trim() ? colors.primaryForeground : colors.mutedForeground }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
      >
        {/* Product status */}
        <TouchableOpacity
          style={[styles.statusRow, { borderBottomColor: colors.border }]}
          activeOpacity={0.7}
          onPress={haptic}
        >
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>Product status</Text>
          <View style={styles.statusRight}>
            <Badge label="Active" variant="success" />
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>

        {/* Media */}
        <View style={styles.sectionPad}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Media</Text>
          <TouchableOpacity
            style={[styles.mediaBox, { borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={haptic}
          >
            <Feather name="image" size={26} color={colors.primary} />
            <Text style={[styles.mediaText, { color: colors.primary }]}>Add images, videos, or 3D models</Text>
          </TouchableOpacity>
        </View>

        {/* Title */}
        <View style={[styles.titleWrap, { borderBottomColor: colors.border }]}>
          <TextInput
            style={[styles.titleInput, { color: colors.foreground }]}
            placeholder="Product title"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <PlusRow label="Add description" onPress={haptic} />
        <PlusRow label="Select category" onPress={haptic} />
        <View style={[styles.priceRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.priceDollar, { color: colors.foreground }]}>$</Text>
          <TextInput
            style={[styles.priceInput, { color: colors.foreground }]}
            placeholder="0.00"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            value={price}
            onChangeText={setPrice}
          />
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </View>

        {/* Publishing */}
        <View style={styles.sectionPad}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Publishing</Text>
              <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>4 channels</Text>
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
              <Text style={[styles.editLink, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.publishLine}>
            <Feather name="share-2" size={15} color={colors.mutedForeground} />
            <Text style={[styles.publishText, { color: colors.foreground }]}>{CHANNELS}</Text>
          </View>
          <View style={styles.publishLine}>
            <Feather name="inbox" size={15} color={colors.mutedForeground} />
            <Text style={[styles.publishText, { color: colors.mutedForeground }]}>No catalogs</Text>
          </View>
        </View>

        {/* Variants */}
        <View style={styles.sectionPad}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Variants</Text>
        </View>
        <PlusRow label="Add options (color, size, etc.)" onPress={haptic} />

        {/* Inventory */}
        <View style={styles.sectionPad}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Inventory</Text>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
              <Text style={[styles.editLink, { color: colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.inventoryRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>Available</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: colors.secondary }]}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { haptic(); setAvailable((v) => Math.max(0, v - 1)); }}
            >
              <Feather name="minus" size={16} color={colors.foreground} />
            </TouchableOpacity>
            <View style={[styles.stepperValue, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.stepperValueText, { color: colors.foreground }]}>{available}</Text>
            </View>
            <TouchableOpacity
              style={[styles.stepperBtn, { backgroundColor: colors.secondary }]}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { haptic(); setAvailable((v) => v + 1); }}
            >
              <Feather name="plus" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Detail rows */}
        <Row icon="truck" label="Shipping" onPress={haptic} />
        <Row icon="tag" label="Type" onPress={haptic} />
        <Row icon="home" label="Vendor" value="Brandthread" onPress={haptic} />
        <Row icon="folder" label="Collections" onPress={haptic} />
        <Row icon="hash" label="Tags" onPress={haptic} />
        <Row icon="search" label="SEO" onPress={haptic} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  pillBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  pillBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionPad: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  sectionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  editLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  mediaBox: {
    marginTop: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  mediaText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  titleWrap: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  titleInput: { fontSize: 22, fontFamily: 'Inter_400Regular' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  priceDollar: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  priceInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', paddingVertical: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowIcon: { width: 20 },
  rowTextBlock: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowValue: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  plusCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  publishLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  publishText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 48, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  stepperValueText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
