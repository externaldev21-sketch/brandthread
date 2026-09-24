/**
 * Seller drop create/edit form.
 *
 * No `dropId` param = create mode. `?dropId=...` = edit mode (prefilled via
 * api.drops.get). Handles the new schedule/hero/early-access fields plus
 * assigning the seller's own products into the drop (via the existing
 * per-product `dropId` field on PATCH /api/products/:id — confirmed already
 * updatable server-side, no new backend needed).
 *
 * Date/time entry is a simple YYYY-MM-DD + HH:MM (24h) pair rather than a
 * native date-time picker — this repo has no date-time-picker dependency
 * installed, and adding one was out of scope for this pass. The wall-clock
 * value is converted to the correct UTC instant via lib/dropSchedule's
 * zonedTimeToUtc, which is unit-tested for DST + non-whole-hour offsets.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { zonedTimeToUtc, listSupportedTimeZones } from '@/lib/dropSchedule';

interface SellerProductRow {
  id: string;
  name: string;
  images?: string[];
  dropId?: string | null;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function isoToDateStr(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToTimeStr(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDateAndTime(dateStr: string, timeStr: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]), month = Number(dm[2]), day = Number(dm[3]);
  const hour = Number(tm[1]), minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export default function SellerDropCreate() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { dropId } = useLocalSearchParams<{ dropId?: string }>();
  const isEdit = !!dropId;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<'pre-order' | 'pre-made'>('pre-order');
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [heroVideoUrl, setHeroVideoUrl] = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);

  const [releaseDate, setReleaseDate] = useState('');
  const [releaseTime, setReleaseTime] = useState('');
  const [timezone, setTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  });
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const [tzFilter, setTzFilter] = useState('');

  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  const [earlyAccessEnabled, setEarlyAccessEnabled] = useState(false);
  const [earlyAccessMinutes, setEarlyAccessMinutes] = useState('30');

  const [allProducts, setAllProducts] = useState<SellerProductRow[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [originalProductIds, setOriginalProductIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    api.products.list().then((rows: any) => {
      if (!active) return;
      setAllProducts(Array.isArray(rows) ? rows : []);
    }).catch(() => {});

    if (isEdit && dropId) {
      api.drops.get(dropId).then((data: any) => {
        if (!active || !data) return;
        setName(data.name ?? '');
        setType(data.type === 'pre-made' ? 'pre-made' : 'pre-order');
        setHeroImageUrl(data.heroImageUrl ?? null);
        setHeroVideoUrl(data.heroVideoUrl ?? null);
        setReleaseDate(isoToDateStr(data.releaseAt));
        setReleaseTime(isoToTimeStr(data.releaseAt));
        if (data.launchTimezone) setTimezone(data.launchTimezone);
        if (data.endsAt) {
          setHasEndDate(true);
          setEndDate(isoToDateStr(data.endsAt));
          setEndTime(isoToTimeStr(data.endsAt));
        }
        if (data.earlyAccessMinutes) {
          setEarlyAccessEnabled(true);
          setEarlyAccessMinutes(String(data.earlyAccessMinutes));
        }
        const assigned = new Set<string>((data.products ?? []).map((p: any) => p.id));
        setSelectedProductIds(assigned);
        setOriginalProductIds(assigned);
      }).catch(() => {
        Alert.alert("Couldn't load drop", 'Try again from the drops list.');
      }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropId]);

  const timeZones = useMemo(() => listSupportedTimeZones(), []);
  const filteredZones = useMemo(() => {
    const f = tzFilter.trim().toLowerCase();
    if (!f) return timeZones;
    return timeZones.filter(z => z.toLowerCase().includes(f));
  }, [timeZones, tzFilter]);

  async function pickHero(kind: 'image' | 'video') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow access to your photo library in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setHeroUploading(true);
    try {
      if (kind === 'image') {
        const uploaded: any = await api.products.uploadImage({ uri: asset.uri });
        const url = uploaded?.objectPath || uploaded?.url || asset.uri;
        setHeroImageUrl(url);
        setHeroVideoUrl(null);
      } else {
        // Reuses the existing generic video-upload pipeline (posts/video-clips) —
        // there is no drops-specific upload endpoint, and this avoids inventing
        // new backend surface for a client-side task.
        const uploaded: any = await (api as any).posts?.uploadVideoClip?.(asset.uri, asset.mimeType ?? null);
        const url = uploaded?.objectPath || uploaded?.url || asset.uri;
        setHeroVideoUrl(url);
        setHeroImageUrl(null);
      }
    } catch {
      Alert.alert('Upload failed', 'Could not upload that file. Please try again.');
    } finally {
      setHeroUploading(false);
    }
  }

  function toggleProduct(id: string) {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give this drop a name.');
      return;
    }
    const releaseParts = parseDateAndTime(releaseDate, releaseTime);
    if (!releaseParts) {
      Alert.alert('Launch date required', 'Enter the launch date as YYYY-MM-DD and time as HH:MM (24h).');
      return;
    }
    let endsAtIso: string | undefined;
    if (hasEndDate) {
      const endParts = parseDateAndTime(endDate, endTime);
      if (!endParts) {
        Alert.alert('End date invalid', 'Enter the end date as YYYY-MM-DD and time as HH:MM (24h), or turn off "Set an end time".');
        return;
      }
      endsAtIso = zonedTimeToUtc(endParts, timezone).toISOString();
    }
    const releaseAtIso = zonedTimeToUtc(releaseParts, timezone).toISOString();
    const earlyMinutes = earlyAccessEnabled ? Math.max(0, parseInt(earlyAccessMinutes, 10) || 0) : 0;

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        releaseAt: releaseAtIso,
        endsAt: endsAtIso ?? null,
        heroImageUrl,
        heroVideoUrl,
        launchTimezone: timezone,
        earlyAccessMinutes: earlyMinutes,
      };

      let effectiveDropId = dropId as string | undefined;
      if (isEdit && effectiveDropId) {
        await api.drops.update(effectiveDropId, body);
      } else {
        const created: any = await api.drops.create({ ...body, type });
        effectiveDropId = created?.id;
      }

      if (effectiveDropId) {
        const toAssign = [...selectedProductIds].filter(id => !originalProductIds.has(id));
        const toUnassign = [...originalProductIds].filter(id => !selectedProductIds.has(id));
        await Promise.all([
          ...toAssign.map(id => api.products.update(id, { dropId: effectiveDropId })),
          ...toUnassign.map(id => api.products.update(id, { dropId: null })),
        ]);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (effectiveDropId) {
        router.replace((`/seller-drop-preview?dropId=${encodeURIComponent(effectiveDropId)}`) as never);
      } else {
        router.back();
      }
    } catch {
      Alert.alert('Could not save', 'Please check the fields and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelDrop() {
    if (!dropId) return;
    Alert.alert('Cancel this drop?', 'This stops the drop from being shown to buyers.', [
      { text: 'Keep drop', style: 'cancel' },
      {
        text: 'Cancel drop',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await api.drops.cancel(dropId);
            Alert.alert('Drop cancelled');
            router.back();
          } catch (err: any) {
            if (err?.code === 'CONFIRM_REQUIRED' || err?.body?.code === 'CONFIRM_REQUIRED') {
              const n = err?.body?.orderCount ?? err?.orderCount;
              Alert.alert(
                'Refund held orders?',
                `This drop has${n != null ? ` ${n}` : ''} orders with held funds — cancelling will refund every unshipped order. This can't be undone.`,
                [
                  { text: 'Back out', style: 'cancel' },
                  {
                    text: 'Refund & cancel',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await api.drops.cancel(dropId, true);
                        Alert.alert('Drop cancelled', 'Unshipped orders have been refunded.');
                        router.back();
                      } catch {
                        Alert.alert("Couldn't cancel", 'Please try again.');
                      }
                    },
                  },
                ],
              );
            } else {
              Alert.alert("Couldn't cancel", 'Please try again.');
            }
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScreenHeader title={isEdit ? 'Edit drop' : 'New drop'} />
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.lg }}>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.muted }]}>DROP NAME</Text>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Midnight Capsule"
              placeholderTextColor={theme.muted}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.muted }]}>TYPE</Text>
            <View style={styles.segmented}>
              {(['pre-order', 'pre-made'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  disabled={isEdit}
                  style={[
                    styles.segmentItem,
                    { borderColor: theme.border },
                    type === t && { backgroundColor: theme.accent, borderColor: theme.accent },
                    isEdit && { opacity: 0.6 },
                  ]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.segmentText, { color: type === t ? theme.onAccent : theme.text }]}>
                    {t === 'pre-order' ? 'Pre-order' : 'Pre-made'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {isEdit && <Text style={[styles.hint, { color: theme.muted }]}>Type can’t change after a drop is created.</Text>}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.muted }]}>HERO MEDIA</Text>
            {(heroImageUrl || heroVideoUrl) ? (
              <View style={styles.heroPreviewWrap}>
                {heroImageUrl ? (
                  <Image source={{ uri: heroImageUrl }} style={styles.heroPreview} resizeMode="cover" />
                ) : (
                  <View style={[styles.heroPreview, styles.heroVideoPlaceholder, { backgroundColor: theme.cardElevated }]}>
                    <Feather name="film" size={22} color={theme.muted} />
                    <Text style={{ color: theme.muted, fontSize: FS.xs, marginTop: 6 }}>Video selected</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.heroRemoveBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => { setHeroImageUrl(null); setHeroVideoUrl(null); }}
                >
                  <Feather name="x" size={14} color={theme.text} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: SP.sm }}>
                <TouchableOpacity
                  style={[styles.heroPickBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
                  onPress={() => pickHero('image')}
                  disabled={heroUploading}
                >
                  <Feather name="image" size={18} color={theme.text} />
                  <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }}>Add photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.heroPickBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
                  onPress={() => pickHero('video')}
                  disabled={heroUploading}
                >
                  <Feather name="film" size={18} color={theme.text} />
                  <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }}>Add video</Text>
                </TouchableOpacity>
              </View>
            )}
            {heroUploading && <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.muted }]}>LAUNCH DATE & TIME</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              <TextInput
                style={[styles.input, { flex: 1.4, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                value={releaseDate}
                onChangeText={setReleaseDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.muted}
              />
              <TextInput
                style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                value={releaseTime}
                onChangeText={setReleaseTime}
                placeholder="HH:MM"
                placeholderTextColor={theme.muted}
              />
            </View>
            <TouchableOpacity
              style={[styles.tzButton, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => setTzPickerOpen(true)}
            >
              <Feather name="globe" size={14} color={theme.muted} />
              <Text style={{ color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm }} numberOfLines={1}>{timezone}</Text>
              <Feather name="chevron-down" size={14} color={theme.muted} />
            </TouchableOpacity>
            <Text style={[styles.hint, { color: theme.muted }]}>
              This is the wall-clock time in the timezone above — buyers see it converted to their own countdown.
            </Text>
          </View>

          <View style={styles.field}>
            <View style={styles.rowBetween}>
              <Text style={[styles.label, { color: theme.muted }]}>SET AN END TIME</Text>
              <Switch value={hasEndDate} onValueChange={setHasEndDate} trackColor={{ true: theme.accent }} />
            </View>
            {hasEndDate && (
              <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1.4, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.muted}
                />
                <TextInput
                  style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.muted}
                />
              </View>
            )}
          </View>

          <View style={styles.field}>
            <View style={styles.rowBetween}>
              <Text style={[styles.label, { color: theme.muted }]}>EARLY ACCESS FOR FOLLOWERS</Text>
              <Switch value={earlyAccessEnabled} onValueChange={setEarlyAccessEnabled} trackColor={{ true: theme.accent }} />
            </View>
            {earlyAccessEnabled && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <TextInput
                  style={[styles.input, { width: 90, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  value={earlyAccessMinutes}
                  onChangeText={setEarlyAccessMinutes}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={theme.muted}
                />
                <Text style={{ color: theme.muted, fontSize: FS.sm }}>minutes before everyone else</Text>
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.muted }]}>PRODUCTS IN THIS DROP</Text>
            {allProducts.length === 0 ? (
              <Text style={{ color: theme.muted, fontSize: FS.sm }}>Add a product first, then come back to include it.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {allProducts.map(product => {
                  const checked = selectedProductIds.has(product.id);
                  return (
                    <TouchableOpacity
                      key={product.id}
                      style={[styles.productRow, { borderColor: theme.border, backgroundColor: theme.card }]}
                      onPress={() => toggleProduct(product.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                    >
                      {product.images?.[0] ? (
                        <Image source={{ uri: product.images[0] }} style={styles.productThumb} />
                      ) : (
                        <View style={[styles.productThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated }]}>
                          <Feather name="package" size={16} color={theme.muted} />
                        </View>
                      )}
                      <Text style={{ flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm }} numberOfLines={1}>
                        {product.name}
                      </Text>
                      <View style={[styles.checkbox, { borderColor: checked ? theme.accent : theme.border, backgroundColor: checked ? theme.accent : 'transparent' }]}>
                        {checked && <Feather name="check" size={12} color={theme.onAccent} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={[styles.hint, { color: theme.muted }]}>
              Limited quantity per product is set via each product's variant stock in Inventory, not here.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: theme.accent }, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving || heroUploading}
          >
            {saving ? <ActivityIndicator color={theme.onAccent} /> : (
              <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.base }}>
                {isEdit ? 'Save changes' : 'Create drop'}
              </Text>
            )}
          </TouchableOpacity>

          {isEdit && dropId && (
            <>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: theme.border }]}
                onPress={() => router.push((`/seller-drop-preview?dropId=${encodeURIComponent(dropId)}`) as never)}
              >
                <Feather name="eye" size={16} color={theme.text} />
                <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }}>Preview</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: '#FF3B30' }]}
                onPress={handleCancelDrop}
                disabled={cancelling}
              >
                {cancelling ? <ActivityIndicator color="#FF3B30" /> : (
                  <>
                    <Feather name="x-circle" size={16} color="#FF3B30" />
                    <Text style={{ color: '#FF3B30', fontFamily: FONT.semibold, fontSize: FS.sm }}>Cancel drop</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>

      <Modal visible={tzPickerOpen} animationType="slide" onRequestClose={() => setTzPickerOpen(false)}>
        <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top }]}>
          <View style={styles.tzHeader}>
            <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg }}>Choose timezone</Text>
            <TouchableOpacity onPress={() => setTzPickerOpen(false)}>
              <Feather name="x" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, { margin: SP.md, color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
            value={tzFilter}
            onChangeText={setTzFilter}
            placeholder="Search timezones…"
            placeholderTextColor={theme.muted}
          />
          <ScrollView>
            {filteredZones.map(z => (
              <TouchableOpacity
                key={z}
                style={[styles.tzRow, { borderColor: theme.border }]}
                onPress={() => { setTimezone(z); setTzPickerOpen(false); setTzFilter(''); }}
              >
                <Text style={{ color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm }}>{z}</Text>
                {z === timezone && <Feather name="check" size={16} color={theme.accent} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 8 },
  label: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1 },
  hint: { fontSize: FS.xs, marginTop: 2 },
  input: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: FS.sm, fontFamily: FONT.medium },
  segmented: { flexDirection: 'row', gap: 8 },
  segmentItem: { flex: 1, borderWidth: 1, borderRadius: RADIUS.sm, paddingVertical: 10, alignItems: 'center' },
  segmentText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  heroPickBtn: { flex: 1, borderWidth: 1, borderStyle: 'dashed', borderRadius: RADIUS.md, paddingVertical: 20, alignItems: 'center', gap: 6 },
  heroPreviewWrap: { position: 'relative' },
  heroPreview: { width: '100%', height: 160, borderRadius: RADIUS.md },
  heroVideoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroRemoveBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tzButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.sm, padding: 8 },
  productThumb: { width: 36, height: 36, borderRadius: RADIUS.xs },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { minHeight: 52, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SP.sm },
  secondaryBtn: { flexDirection: 'row', minHeight: 46, borderWidth: 1, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', gap: 8 },
  tzHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  tzRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: 14, borderBottomWidth: 1 },
});
