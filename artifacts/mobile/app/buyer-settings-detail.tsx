import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { ErrorState } from '@/components/ui/ErrorState';
import { type IconName } from '@/components/ui/Icon';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { BuyerSettingsState, loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { reportNetworkError } from '@/lib/networkNotice';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow, OptionSheet } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { collectAppDiagnostics, formatAppVersion } from '@/lib/appDiagnostics';
import { useInternalDevMenuGesture } from '@/lib/internalDevMenu';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { useDisplayPrefs } from '@/contexts/DisplayPrefsContext';
import { DisplayPrefs, TEXT_SIZE_OPTIONS, TextSize, textSizeLabel } from '@/lib/displayPrefs';

const APP_VERSION_LABEL = formatAppVersion(collectAppDiagnostics());

type ToggleKey = keyof { [K in keyof BuyerSettingsState as BuyerSettingsState[K] extends boolean ? K : never]: true };
type Item = {
  label: string; sub?: string; icon?: IconName; toggle?: ToggleKey; value?: string; action?: () => void;
  /** A switch backed by the server (account display preferences), not the local buyer settings. */
  remoteToggle?: { value: boolean; onChange: (value: boolean) => void };
  secretTap?: () => void;
};

/** Account display preferences (GET/PATCH /api/display-preferences; local only in the signed-out preview). */
type Display = {
  prefs: DisplayPrefs;
  set: (patch: Partial<DisplayPrefs>) => void;
  pickTextSize: () => void;
};

type Config = { title: string; items: (s: BuyerSettingsState, router: ReturnType<typeof useRouter>, display: Display, extra: { onVersionTap?: () => void }) => Item[] };

/**
 * The settings pages Settings and activity / Accounts Center link to. Every
 * row is a control that really works, or opens the screen that does it.
 * Read receipts, activity status and message requests live on Privacy (the
 * server-backed switches), so Messages only links there.
 */
const CONFIG: Record<string, Config> = {
  messages: { title: 'Messages', items: (_s, router) => [
    { label: 'Who can message you', icon: 'message-circle', action: () => router.push('/buyer-privacy-settings' as never) },
    { label: 'Blocked accounts', icon: 'slash', action: () => router.push('/buyer-blocked' as never) },
  ] },
  content: { title: 'Content preferences', items: (_s, router) => [
    { label: 'Hidden words', sub: 'Hide posts and comments with words you choose', icon: 'filter', action: () => router.push('/muted-words' as never) },
    { label: 'Muted accounts', icon: 'volume-x', action: () => router.push('/buyer-muted' as never) },
  ] },
  accessibility: { title: 'Accessibility', items: (_s, _router, d) => [
    { label: 'Reduce motion', toggle: 'reduceMotion' },
    { label: 'Always show captions', toggle: 'captions' },
    { label: 'Text size', value: textSizeLabel(d.prefs.textSize), action: d.pickTextSize },
    { label: 'High contrast icons', remoteToggle: { value: d.prefs.highContrastIcons, onChange: (v: boolean) => d.set({ highContrastIcons: v }) } },
  ] },
  about: { title: 'About Brandthread', items: (_s, router, _d, extra) => [
    { label: 'App version', value: APP_VERSION_LABEL, secretTap: extra.onVersionTap },
    { label: 'Terms of service', icon: 'file-text', action: () => router.push('/terms' as never) },
    { label: 'Community guidelines', icon: 'users', action: () => router.push('/community-guidelines' as never) },
    { label: 'Privacy policy', icon: 'shield', action: () => router.push('/privacy' as never) },
  ] },
};

export default function BuyerSettingsDetail() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { section = 'content' } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [textSizeSheet, setTextSizeSheet] = useState(false);
  const displayPrefs = useDisplayPrefs();
  const updateDisplayPrefs = displayPrefs.update;
  const display = useMemo<Display>(() => ({
    prefs: displayPrefs.prefs,
    set: (patch) => { updateDisplayPrefs(patch).catch((err) => showAlert('Couldn’t update setting', friendlyError(err, 'Try again.'))); },
    pickTextSize: () => setTextSizeSheet(true),
  }), [displayPrefs.prefs, updateDisplayPrefs]);
  const cfg: Config | undefined = Object.prototype.hasOwnProperty.call(CONFIG, section) ? CONFIG[section] : undefined;
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setSettings(await loadBuyerSettings());
    } catch (error) {
      setLoadError(true);
      reportNetworkError(error, () => load());
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const toggle = useCallback(async (key: ToggleKey, value: boolean) => {
    const prior = settings;
    if (prior) setSettings({ ...prior, [key]: value });
    try {
      const next = await patchBuyerSettings({ [key]: value } as Partial<BuyerSettingsState>);
      setSettings(next);
    } catch (err) {
      setSettings(prior);
      showAlert('Couldn’t update setting', friendlyError(err, 'Try again.'));
    }
  }, [settings]);
  const onVersionTap = useInternalDevMenuGesture();
  const items = useMemo(() => settings && cfg ? cfg.items(settings, router, display, { onVersionTap }) : [], [cfg, settings, router, display, onVersionTap]);

  if (!cfg) {
    // Unknown ?section= (old or mistyped deep link): say so instead of showing another page.
    return <View style={styles.page}>
      <ScreenHeader title="Settings" variant="push" onBack={() => goBackOr(router, '/buyer-settings')} />
      <ErrorState message="This settings page doesn’t exist." retryLabel="Back to settings" onRetry={() => goBackOr(router, '/buyer-settings')} />
    </View>;
  }

  return <View style={styles.page}>
    <ScreenHeader title={cfg.title} variant="push" onBack={() => goBackOr(router, '/buyer-settings')} />
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
      {!loading && loadError && !settings ? <ErrorState message="Couldn’t load your settings." onRetry={() => { setLoading(true); load(); }} /> : null}
      {loading ? <Text style={styles.intro}>Loading settings…</Text> : settings && items.length > 0 ? <Card style={styles.card}>{items.map((item, i) => {
        // Value-only rows (App version) are read-only: plain text, no press state, no dimming.
        const row = <ListRow
            icon={item.icon}
            title={item.label}
            subtitle={item.sub}
            value={!item.toggle && !item.remoteToggle ? item.value : undefined}
            chevron={!item.toggle && !item.remoteToggle && !!item.action}
            toggle={item.toggle ? { value: Boolean(settings[item.toggle]), onChange: (v) => toggle(item.toggle!, v) } : item.remoteToggle}
            onPress={item.action}
          />;
        return <React.Fragment key={`${item.label}-${i}`}>
          {item.secretTap ? <Pressable onPress={item.secretTap} accessible={false}>{row}</Pressable> : row}
          {i < items.length - 1 && <View style={styles.divider} />}
        </React.Fragment>;
      })}</Card> : null}
    </ScrollView>
    <OptionSheet
      visible={textSizeSheet}
      onClose={() => setTextSizeSheet(false)}
      title="Text size"
      options={TEXT_SIZE_OPTIONS}
      selectedId={display.prefs.textSize}
      onSelect={(id) => { setTextSizeSheet(false); display.set({ textSize: id as TextSize }); }}
    />
  </View>;
}
const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginBottom: SP.md },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
