/**
 * Countdown + "Notify me" for a product with a scheduled launch. Fetches its
 * own data from the public launch endpoint and renders nothing when the
 * product has no pending launch. Signed-out viewers see the countdown; only
 * the Notify me toggle needs an account, and it sends them to sign in rather
 * than calling a protected API.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Icon } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';

export function splitCountdown(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function launchLabel(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Launching ${date} at ${time}`;
}

export function LaunchCountdown({
  productId,
  onLaunchingChange,
}: {
  productId?: string;
  /** Lets the page disable purchase buttons while the product is waiting on launch. */
  onLaunchingChange?: (launching: boolean) => void;
}) {
  const api = useApi();
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [launchAt, setLaunchAt] = useState<string | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const onChange = useRef(onLaunchingChange);
  onChange.current = onLaunchingChange;

  const load = useCallback(() => {
    if (!productId) return;
    api.productLaunches.state(productId)
      .then((s) => {
        setSkewMs(new Date(s.serverNow).getTime() - Date.now());
        setLaunchAt(s.launching ? s.launchAt : null);
        onChange.current?.(!!s.launching);
      })
      .catch(() => { setLaunchAt(null); onChange.current?.(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => { setLaunchAt(null); load(); }, [load]);

  useEffect(() => {
    if (!productId || !isSignedIn || !launchAt) { setSubscribed(false); return; }
    let active = true;
    api.productLaunches.alertStatus(productId)
      .then((r) => { if (active) setSubscribed(!!r.subscribed); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, isSignedIn, !!launchAt]);

  const remaining = launchAt ? new Date(launchAt).getTime() - (now + skewMs) : 0;
  const expired = !!launchAt && remaining <= 0;

  useEffect(() => {
    if (!launchAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [launchAt]);

  // The moment the clock passes launch time, ask the server whether it is live.
  useEffect(() => { if (expired) load(); }, [expired, load]);

  async function toggle() {
    if (!productId || busy) return;
    if (!isSignedIn) { router.push('/sign-in' as never); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    const next = !subscribed;
    setSubscribed(next);
    try {
      if (next) await api.productLaunches.alertOn(productId);
      else await api.productLaunches.alertOff(productId);
    } catch {
      setSubscribed(!next);
    } finally {
      setBusy(false);
    }
  }

  if (!launchAt || expired) return null;
  const t = splitCountdown(remaining);
  const cells: Array<[number, string]> = [[t.days, 'days'], [t.hours, 'hrs'], [t.minutes, 'min'], [t.seconds, 'sec']];

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID="launch-countdown">
      <Text style={[s.label, { color: colors.foreground }]}>{launchLabel(launchAt)}</Text>
      <View style={s.cells} accessibilityLabel={`${t.days} days ${t.hours} hours ${t.minutes} minutes left`}>
        {cells.map(([value, unit]) => (
          <View key={unit} style={[s.cell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[s.value, { color: colors.foreground }]}>{String(value).padStart(2, '0')}</Text>
            <Text style={[s.unit, { color: colors.mutedForeground }]}>{unit}</Text>
          </View>
        ))}
      </View>
      <PressableScale
        onPress={toggle}
        style={[
          s.btn,
          subscribed
            ? { backgroundColor: 'transparent', borderColor: colors.foreground }
            : { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: subscribed }}
        accessibilityLabel={subscribed ? "You'll be notified at launch. Tap to turn off" : 'Notify me at launch'}
        testID="launch-notify-me"
      >
        {busy ? (
          <ActivityIndicator size="small" color={subscribed ? colors.foreground : colors.primaryForeground} />
        ) : (
          <>
            <Icon name={subscribed ? 'check' : 'bell'} size={ICON.sm} color={subscribed ? colors.foreground : colors.primaryForeground} />
            <Text style={[s.btnText, { color: subscribed ? colors.foreground : colors.primaryForeground }]}>
              {subscribed ? "You'll be notified" : 'Notify me'}
            </Text>
          </>
        )}
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: SP.sm, marginBottom: SP.md },
  label: { fontFamily: FONT.bold, fontSize: FS.md },
  cells: { flexDirection: 'row', gap: SP.sm },
  cell: { flex: 1, borderWidth: 1, borderRadius: RADIUS.sm, alignItems: 'center', paddingVertical: SP.sm },
  value: { fontFamily: FONT.bold, fontSize: FS.xl, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: FONT.medium, fontSize: FS.xs },
  btn: { minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  btnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
