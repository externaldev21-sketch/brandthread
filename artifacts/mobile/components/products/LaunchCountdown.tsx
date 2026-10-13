/**
 * Drop lobby for a product with a scheduled launch (Nike SNKRS upcoming
 * product page, 1:1): "Available 10/16 at 10:00 AM", a quiet countdown, how
 * many people have notifications on, and Notify me.
 *
 * Fetches its own data from the public launch endpoint and renders nothing
 * when the product has no pending launch. The clock is the server's (skew
 * corrected), and the last tick is scheduled for the launch instant itself,
 * so the page's Buy button switches on at that exact second without a
 * reload. The server still enforces the launch time at checkout.
 *
 * Signed-out viewers see the lobby; only Notify me needs an account, and it
 * sends them to sign in rather than calling a protected API.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { countdownText, lobbyDateLabel, msUntilNextTick, notifyCountLabel } from '@/lib/dropLobby';

/** How often the notifications-on count refreshes while the lobby is on screen. */
const COUNT_REFRESH_MS = 30_000;

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
  const [notifyCount, setNotifyCount] = useState(0);
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
        setNow(Date.now());
        setLaunchAt(s.launching ? s.launchAt : null);
        setNotifyCount(s.launching ? Math.max(0, s.notifyCount ?? 0) : 0);
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

  const launchMs = launchAt ? new Date(launchAt).getTime() : 0;
  const remaining = launchAt ? launchMs - (now + skewMs) : 0;
  const opened = !!launchAt && remaining <= 0;

  // One tick per second, aligned to the server's second boundary, with the
  // final tick landing on the launch instant rather than up to 1s after it.
  useEffect(() => {
    if (!launchAt || opened) return;
    const id = setTimeout(() => setNow(Date.now()), msUntilNextTick(Date.now() + skewMs, launchMs));
    return () => clearTimeout(id);
  }, [launchAt, launchMs, now, opened, skewMs]);

  // The second the clock reaches launch time, switch Buy on here, then ask
  // the server to confirm (it re-arms the lobby if this device was early).
  useEffect(() => {
    if (!opened) return;
    onChange.current?.(false);
    load();
  }, [opened, load]);

  // Real count, refreshed while visible. Returning to the app re-syncs the
  // clock too, since timers don't run in the background.
  useEffect(() => {
    if (!launchAt || opened) return;
    const id = setInterval(load, COUNT_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [launchAt, opened, load]);

  async function toggle() {
    if (!productId || busy) return;
    if (!isSignedIn) { router.push('/sign-in' as never); return; }
    hapticToggle();
    setBusy(true);
    const next = !subscribed;
    setSubscribed(next);
    setNotifyCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) await api.productLaunches.alertOn(productId);
      else await api.productLaunches.alertOff(productId);
    } catch {
      setSubscribed(!next);
      setNotifyCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  if (!launchAt || opened) return null;
  const countLabel = notifyCountLabel(notifyCount);

  return (
    <View style={s.wrap} testID="launch-countdown">
      <Text style={[s.date, { color: colors.foreground }]}>{lobbyDateLabel(launchAt)}</Text>
      <Text
        style={[s.countdown, { color: colors.mutedForeground }]}
        accessibilityLabel={countdownText(remaining, true)}
        testID="launch-countdown-clock"
      >
        {countdownText(remaining)}
      </Text>
      {countLabel ? (
        <Text style={[s.count, { color: colors.mutedForeground }]} testID="launch-notify-count">{countLabel}</Text>
      ) : null}
      <PressableScale
        onPress={toggle}
        style={[
          s.btn,
          subscribed
            ? { backgroundColor: 'transparent', borderColor: colors.border }
            : { backgroundColor: colors.foreground, borderColor: colors.foreground },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: subscribed }}
        accessibilityLabel={subscribed ? "Notifications on. Tap to turn off" : 'Notify me'}
        testID="launch-notify-me"
      >
        {busy ? (
          <ActivityIndicator size="small" color={subscribed ? colors.foreground : colors.background} />
        ) : (
          <Text style={[s.btnText, { color: subscribed ? colors.foreground : colors.background }]}>
            {subscribed ? 'Notifications on' : 'Notify me'}
          </Text>
        )}
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: SP.xs, marginBottom: SP.md },
  date: { fontFamily: FONT.semibold, fontSize: FS.md },
  countdown: { fontFamily: FONT.medium, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  count: { fontFamily: FONT.regular, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  btn: { marginTop: SP.sm, minHeight: 48, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
