/**
 * Seller Vacation Mode
 * Route: /vacation-mode
 */
import React, { useState, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, SUCCESS, SUCCESS_DIM,
  ORANGE, RED, FONT, FS, SP, RADIUS, COMP,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@clerk/expo';
import { isSellerDevPreview } from '@/lib/devPreview';

export default function VacationModeScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api    = useApi();
  const { isLoaded: isAuthLoaded, isSignedIn, userId } = useAuth();
  // ?bt_preview=seller with no signed-in account: no token for the protected
  // vacation endpoints — never call them (same guard as app/finance.tsx).
  const isPreviewMode = isSellerDevPreview();
  const skipProtectedReads = (isPreviewMode && !userId) || (isPreviewMode && (!isAuthLoaded || !isSignedIn));

  const [loading,         setLoading]         = useState(!skipProtectedReads);
  // True when the current vacation state failed to load. Save stays blocked
  // until the real state is known, so it can never PUT the defaults
  // (vacationMode:false, message:null) over a seller's live away settings.
  const [loadError,       setLoadError]       = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [vacationMode,    setVacationMode]    = useState(false);
  const [message,         setMessage]         = useState('');
  const [returnDate,      setReturnDate]      = useState('');

  const load = useCallback(() => {
    if (skipProtectedReads) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    Promise.resolve()
      .then(() => (api as any).seller.vacation.get())
      .then((d: any) => {
        setVacationMode(d?.vacationMode ?? false);
        setMessage(d?.vacationMessage ?? '');
        if (d?.vacationUntil) {
          setReturnDate(new Date(d.vacationUntil).toISOString().split('T')[0]);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [api, skipProtectedReads]);

  useFocusEffect(load);

  async function handleSave() {
    if (loading || loadError || skipProtectedReads) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      await (api as any).seller?.vacation?.update?.({
        vacationMode,
        vacationMessage: message.trim() || null,
        vacationUntil:   returnDate ? returnDate : null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        vacationMode ? '🏖 Vacation Mode Active' : '✅ Store Reopened',
        vacationMode
          ? 'Buyers will see an away banner on your storefront. New orders are paused.'
          : 'Your store is open again. Buyers can place new orders.',
        [{ text: 'Done', onPress: () => goBackOr(router) }],
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center', paddingTop: headerTopInset }]}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={s.root}>
        <ScreenHeader title="Vacation Mode" />
        <ErrorState message="Couldn't load your vacation settings." onRetry={load} />
      </View>
    );
  }

  const saveDisabled = saving || loading || loadError || skipProtectedReads;

  return (
    <View style={s.root}>
      <ScreenHeader title="Vacation Mode" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }}>

        {/* Status hero card */}
        <View style={[s.statusCard, { borderColor: vacationMode ? ORANGE : SUCCESS }]}>
          <View style={[s.statusIndicator, { backgroundColor: vacationMode ? ORANGE : SUCCESS }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>
              {vacationMode ? '🏖  Currently Away' : '🟢  Store Open'}
            </Text>
            <Text style={s.statusSub}>
              {vacationMode
                ? 'Your storefront shows an away banner. New orders are paused.'
                : 'Your storefront is live and accepting orders.'}
            </Text>
          </View>
        </View>

        {/* Toggle */}
        <View style={s.toggleCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>Enable Vacation Mode</Text>
            <Text style={s.toggleSub}>Pause new orders without hiding your listings</Text>
          </View>
          <HapticSwitch
            value={vacationMode}
            onValueChange={setVacationMode}
            trackColor={{ false: BORDER, true: ORANGE }}
            thumbColor="#fff"
          />
        </View>

        {/* Away message (shown when toggled on) */}
        {vacationMode && (
          <View style={s.card}>
            <Text style={s.label}>Away Message <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              style={s.input}
              value={message}
              onChangeText={setMessage}
              placeholder="We're away until [date]. Thank you for your patience!"
              placeholderTextColor={MUTED}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Text style={[s.label, { marginTop: SP.md }]}>Return Date <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              style={s.input}
              value={returnDate}
              onChangeText={setReturnDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={MUTED}
              keyboardType="default"
              autoCorrect={false}
            />
            <Text style={s.fieldHint}>Vacation mode auto-clears when this date passes.</Text>
          </View>
        )}

        {/* Info bullets */}
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>What Vacation Mode Does</Text>
          {[
            { icon: 'alert-triangle', text: 'Buyers see an "Away" banner on your storefront', color: ORANGE },
            { icon: 'x-circle',       text: 'New orders cannot be placed while active',       color: RED },
            { icon: 'check-circle',   text: 'Your products and listings stay visible',        color: SUCCESS },
            { icon: 'package',        text: 'Existing orders are completely unaffected',      color: PURPLE_LIGHT },
            { icon: 'bell-off',       text: 'Drop announcements are paused automatically',    color: MUTED },
          ].map((item, i) => (
            <View key={i} style={s.infoBullet}>
              <Feather name={item.icon as any} size={14} color={item.color} />
              <Text style={s.infoBulletText}>{item.text}</Text>
            </View>
          ))}
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[s.saveBtn, saveDisabled && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saveDisabled}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color={theme.onAccent} />
            : <Text style={s.saveBtnText}>Save Changes</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const createStyles = (theme: { accent: string; onAccent: string }) => {
  const { accent: PURPLE } = theme;
  return StyleSheet.create({
  root:       { flex: 1, backgroundColor: 'transparent' },

  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, borderWidth: 1.5, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  statusIndicator: { width: 10, height: 10, borderRadius: 5 },
  statusTitle:{ fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: 2 },
  statusSub:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  toggleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  toggleLabel:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  toggleSub:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  card:       { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  label:      { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  optional:   { fontFamily: FONT.regular, textTransform: 'none', letterSpacing: 0 },
  input:      { backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, minHeight: 44 },
  fieldHint:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 6 },

  infoCard:     { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.xl },
  infoTitle:    { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: SP.sm },
  infoBullet:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  infoBulletText:{ flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },

  saveBtn:    { backgroundColor: PURPLE, borderRadius: RADIUS.md, alignItems: 'center', paddingVertical: 16 },
  // onAccent, not '#fff': the accent is white in the black/white/silver
  // theme, so a hardcoded white label rendered invisible (QA-0172).
  saveBtnText:{ fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
  });
};
