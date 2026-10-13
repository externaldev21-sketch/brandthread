/**
 * Scheduled product launches — seller screen.
 *
 * Lists products waiting on a launch time with their Notify me signups, and
 * sets / changes / cancels a launch. `?productId=` (from the product action
 * sheet) opens the editor straight away for that product.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { Header } from '@/components/layout';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState, HapticSwitch } from '@/components/BrandthreadUI';
import { LaunchTimePicker, parseWallClock } from '@/components/products/LaunchTimePicker';
import { listSupportedTimeZones, zonedTimeToUtc } from '@/lib/dropSchedule';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { Sheet, SHEET_GUTTER } from '@/components/ui/BottomSheet';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { hapticSuccess } from '@/lib/haptics';

type Launch = {
  productId: string; name: string; imageUrl: string | null; status: string;
  launchAt: string; launchedAt: string | null; notifyFollowers: boolean; alertCount: number;
};
type SellerProduct = { id: string; name: string; images?: string[]; status?: string };

function pad(n: number) { return String(n).padStart(2, '0'); }
function localDate(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function localTime(iso: string) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function whenLabel(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
function deviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export default function ProductLaunchesScreen() {
  const api = useApi();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { productId: paramProductId } = useLocalSearchParams<{ productId?: string }>();

  const [launches, setLaunches] = useState<Launch[]>([]);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<{ productId: string; name: string; existing: Launch | null } | null>(null);
  // Each open gets a fresh editor (new key); after close it keeps rendering
  // the last target so the sheet can animate out.
  const lastEditing = React.useRef(editing);
  const editorSession = React.useRef(0);
  if (editing && editing !== lastEditing.current) {
    lastEditing.current = editing;
    editorSession.current += 1;
  }
  const editorTarget = editing ?? lastEditing.current;
  const [picking, setPicking] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [l, p] = await Promise.all([
        api.productLaunches.list(),
        (api.products.list() as Promise<any>).catch(() => []),
      ]);
      setLaunches(Array.isArray(l) ? l : []);
      setProducts(Array.isArray(p) ? p : []);
    } catch {
      setLaunches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Deep link from the product action sheet.
  React.useEffect(() => {
    if (autoOpened || loading || !paramProductId) return;
    const existing = launches.find((l) => l.productId === paramProductId) ?? null;
    const product = products.find((p) => p.id === paramProductId);
    setEditing({ productId: paramProductId, name: existing?.name ?? product?.name ?? 'Product', existing });
    setAutoOpened(true);
  }, [autoOpened, loading, paramProductId, launches, products]);

  const scheduled = launches.filter((l) => !l.launchedAt);
  const launched = launches.filter((l) => !!l.launchedAt);
  const available = products.filter((p) => p.status !== 'archived' && !launches.some((l) => l.productId === p.id));

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <Header
        title="Product launches"
        dividerVariant="none"
        onBack={() => goBackOr(router)}
        actions={[{ icon: 'plus', onPress: () => setPicking(true), accessibilityLabel: 'Schedule a launch' }]}
      />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.accentForeground} /></View>
      ) : launches.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No scheduled launches"
          description="Pick a product and a time. It stays unavailable until then, and shoppers who tap Notify me hear the moment it goes live."
          action={{ label: 'Schedule a launch', onPress: () => setPicking(true) }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.accentForeground} />}
          showsVerticalScrollIndicator={false}
        >
          {scheduled.length > 0 && <Text style={[s.section, { color: colors.mutedForeground }]}>SCHEDULED</Text>}
          {scheduled.map((l) => (
            <LaunchRow key={l.productId} launch={l} onPress={() => setEditing({ productId: l.productId, name: l.name, existing: l })} />
          ))}
          {launched.length > 0 && <Text style={[s.section, { color: colors.mutedForeground }]}>LAUNCHED</Text>}
          {launched.map((l) => (
            <LaunchRow key={l.productId} launch={l} onPress={() => {}} />
          ))}
        </ScrollView>
      )}

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Choose a product"
        testID="launch-product-picker"
        contentContainerStyle={{ gap: SP.sm }}
      >
            {available.length === 0 && (
              <Text style={[s.empty, { color: colors.mutedForeground }]}>Every product already has a launch.</Text>
            )}
            {available.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[s.row, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => { setPicking(false); setEditing({ productId: p.id, name: p.name, existing: null }); }}
              >
                <Thumb uri={p.images?.[0]} colors={colors} />
                <Text style={[s.name, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>{p.name}</Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
      </Sheet>

      {/* The editor stays mounted on its last target while the sheet slides
          out, so closing animates instead of vanishing. */}
      {editorTarget && (
        <LaunchEditor
          key={`${editorTarget.productId}-${editorSession.current}`}
          visible={!!editing}
          target={editorTarget}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(true); }}
        />
      )}
    </View>
  );
}

function Thumb({ uri, colors }: { uri?: string | null; colors: ReturnType<typeof useColors> }) {
  return uri
    ? <Image source={{ uri }} style={s.thumb} />
    : <View style={[s.thumb, s.thumbEmpty, { backgroundColor: colors.surface, borderColor: colors.border }]}><Feather name="image" size={16} color={colors.mutedForeground} /></View>;
}

function LaunchRow({ launch, onPress }: { launch: Launch; onPress: () => void }) {
  const colors = useColors();
  const done = !!launch.launchedAt;
  return (
    <TouchableOpacity
      style={[s.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={done ? 1 : 0.7}
      accessibilityLabel={`${launch.name}, ${done ? 'launched' : 'launching'} ${whenLabel(launch.launchAt)}`}
    >
      <Thumb uri={launch.imageUrl} colors={colors} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.name, { color: colors.foreground }]} numberOfLines={2}>{launch.name}</Text>
        <Text style={[s.meta, { color: colors.mutedForeground }]}>{done ? 'Launched' : 'Launches'} {whenLabel(launch.launchAt)}</Text>
        <View style={s.metaRow}>
          <Feather name="bell" size={12} color={colors.mutedForeground} />
          <Text style={[s.meta, { color: colors.mutedForeground }]}>
            {launch.alertCount} {launch.alertCount === 1 ? 'person' : 'people'} waiting{launch.notifyFollowers ? ' · followers notified' : ''}
          </Text>
        </View>
      </View>
      {!done && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
    </TouchableOpacity>
  );
}

function LaunchEditor({
  target, visible, onClose, onSaved,
}: {
  target: { productId: string; name: string; existing: Launch | null };
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const colors = useColors();
  const existing = target.existing;
  const tomorrow = useMemo(() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);
  const [date, setDate] = useState(existing ? localDate(existing.launchAt) : tomorrow);
  const [time, setTime] = useState(existing ? localTime(existing.launchAt) : '09:00');
  const [zone, setZone] = useState(deviceZone());
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('');
  const [notifyFollowers, setNotifyFollowers] = useState(existing?.notifyFollowers ?? false);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => listSupportedTimeZones(), []);
  const filtered = useMemo(() => {
    const f = zoneFilter.trim().toLowerCase();
    return f ? zones.filter((z) => z.toLowerCase().includes(f)) : zones;
  }, [zones, zoneFilter]);

  // An existing launch is shown in the device zone; pick another zone to re-enter in that zone's wall clock.
  async function save() {
    const parts = parseWallClock(date, time);
    if (!parts) { Alert.alert('Check the launch time', 'Enter the date as YYYY-MM-DD and the time as HH:MM.'); return; }
    const launchAt = zonedTimeToUtc(parts, zone);
    if (launchAt.getTime() <= Date.now()) { Alert.alert('Launch time has passed', 'Choose a time in the future.'); return; }
    setSaving(true);
    try {
      await api.productLaunches.schedule(target.productId, { launchAt: launchAt.toISOString(), notifyFollowers });
      hapticSuccess();
      onSaved();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  function cancelLaunch() {
    showActionSheet('Cancel this launch?', 'The product becomes available right away and nobody is notified.', [
      { text: 'Keep launch', style: 'cancel' },
      {
        text: 'Cancel launch', style: 'destructive',
        onPress: async () => {
          try { await api.productLaunches.cancel(target.productId); onSaved(); }
          catch { Alert.alert("Couldn't cancel", 'Try again.'); }
        },
      },
    ]);
  }

  // The timezone list is a second step inside the same sheet: a back chevron
  // in the title row returns to the form.
  const zoneBack = zoneOpen ? (
    <TouchableOpacity
      onPress={() => setZoneOpen(false)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Feather name="chevron-left" size={ICON.md} color={colors.foreground} />
    </TouchableOpacity>
  ) : undefined;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={zoneOpen ? 'Timezone' : existing ? 'Edit launch' : 'Schedule launch'}
      headerLeft={zoneBack}
      padded={!zoneOpen}
      testID="launch-editor-sheet"
      contentContainerStyle={zoneOpen ? undefined : s.form}
      primaryAction={zoneOpen ? undefined : {
        label: existing ? 'Save launch' : 'Schedule launch',
        onPress: () => { void save(); },
        loading: saving,
        disabled: saving,
      }}
      secondaryAction={!zoneOpen && existing ? { label: 'Cancel launch', onPress: cancelLaunch, variant: 'destructive' } : undefined}
    >
      {zoneOpen ? (
        <>
          <TextInput
            style={[s.filter, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }, WEB_INPUT_RESET]}
            value={zoneFilter}
            onChangeText={setZoneFilter}
            placeholder="Search timezones"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Search timezones"
          />
          {filtered.map((z) => (
            <TouchableOpacity key={z} style={[s.zoneRow, { borderColor: colors.border }]} onPress={() => { setZone(z); setZoneOpen(false); setZoneFilter(''); }}>
              <Text style={[s.name, { color: colors.foreground }]}>{z}</Text>
              {z === zone && <Feather name="check" size={16} color={colors.foreground} />}
            </TouchableOpacity>
          ))}
        </>
      ) : (
        <>
          <Text style={[s.productName, { color: colors.foreground }]} numberOfLines={2}>{target.name}</Text>

          <Text style={[s.label, { color: colors.mutedForeground }]}>LAUNCH DATE AND TIME</Text>
          <LaunchTimePicker dateValue={date} timeValue={time} onDateChange={setDate} onTimeChange={setTime} />
          <TouchableOpacity
            style={[s.zoneBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setZoneOpen(true)}
            accessibilityLabel={`Timezone ${zone}`}
          >
            <Feather name="globe" size={14} color={colors.mutedForeground} />
            <Text style={[s.name, { color: colors.foreground, flex: 1 }]}>{zone}</Text>
            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>

          <View style={[s.switchRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: colors.foreground }]}>Notify my followers</Text>
              <Text style={[s.meta, { color: colors.mutedForeground }]}>Everyone who follows you, plus anyone who tapped Notify me.</Text>
            </View>
            <HapticSwitch value={notifyFollowers} onValueChange={setNotifyFollowers} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: SP.md, gap: SP.sm },
  section: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1, marginTop: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md },
  thumb: { width: 52, height: 52, borderRadius: RADIUS.sm },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  meta: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: SP.lg },
  form: { gap: SP.md },
  productName: { fontFamily: FONT.bold, fontSize: FS.lg },
  label: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1 },
  zoneBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, minHeight: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: SP.md },
  filter: { marginHorizontal: SHEET_GUTTER, marginBottom: SP.sm, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: FS.sm, fontFamily: FONT.medium },
  zoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SHEET_GUTTER, paddingVertical: 14, borderBottomWidth: 1 },
});
