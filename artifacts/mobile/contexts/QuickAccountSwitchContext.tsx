/**
 * Quick account switch — what happens when the hold ring on the tab bar's
 * Profile button closes (see components/tab-bar/HoldRing.tsx).
 *
 * Instagram-style: it switches straight to the person's most recently used
 * other signed-in account (lib/holdToSwitch.ts `pickNextAccount`, from Clerk's
 * own per-session `lastActiveAt`), so with two accounts each hold toggles and
 * with three or more it goes back to the last one used. Only one account on
 * the device: it opens the existing Switch account sheet (with Add account)
 * instead.
 *
 * The switch itself is the same Clerk multi-session `setActive` the sheet
 * uses. Around it, the app content fades through the background colour
 * (so the buyer -> seller shell swap, or one account's data replacing
 * another's, never shows as a flash), the app lands on the new account's
 * home — the seller Dashboard for a seller account, Threads for a buyer —
 * and a small toast shows the new account's avatar and @handle.
 *
 * Preview mode (`?bt_preview=…`, no real Clerk session) mirrors the sheet's
 * own two demo accounts (@ava, buyer; @atelier.noire, seller) and switches by
 * flipping the preview role.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth, useSessionList } from '@clerk/expo';

import { AccountSwitcherSheet } from '@/components/AccountSwitcherSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { getHandle } from '@/lib/accountSwitcherHelpers';
import { isBuyerDevPreview, isSellerDevPreview, setDevWebPreviewRole } from '@/lib/devPreview';
import { pickNextAccount } from '@/lib/holdToSwitch';
import { FONT } from '@/lib/theme';

type QuickSwitchContextValue = {
  /** Run on a completed hold: switch to the next account, or open the sheet. */
  quickSwitch: () => void;
};

const QuickSwitchContext = createContext<QuickSwitchContextValue>({ quickSwitch: () => {} });

export function useQuickAccountSwitch() {
  return useContext(QuickSwitchContext);
}

type AccountInfo = { accountType: 'buyer' | 'seller' | null; username: string | null; avatarUrl: string | null };

const PREVIEW_ACCOUNTS = {
  buyer: { handle: '@ava', avatarUri: null as string | null },
  seller: { handle: '@atelier.noire', avatarUri: null as string | null },
};

const VEIL_IN_MS = 110;
const VEIL_OUT_MS = 220;
const TOAST_MS = 1800;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function QuickAccountSwitchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { sessionId } = useAuth();
  const { sessions, setActive } = useSessionList();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ handle: string; avatarUri: string | null; key: number } | null>(null);
  const [info, setInfo] = useState<Record<string, AccountInfo>>({});
  const busy = useRef(false);
  const veil = useSharedValue(0);
  const toastShown = useSharedValue(0);

  const activeSessions = useMemo(
    () => (sessions ?? []).filter((session) => session.status === 'active' && session.user),
    [sessions],
  );
  const sessionKey = activeSessions.map((session) => session.id).join(',');

  // Know every other account's type/handle/avatar *before* a hold completes,
  // so the switch never waits on the network to decide where to land.
  useEffect(() => {
    if (activeSessions.length < 2) return;
    let cancelled = false;
    api.auth.accountTypes(activeSessions.map((session) => session.user!.id))
      .then((res) => { if (!cancelled) setInfo(res.accountTypes); })
      .catch(() => { /* fall back to Clerk's own user data below */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const showToast = useCallback((handle: string, avatarUri: string | null) => {
    setToast({ handle, avatarUri, key: Date.now() });
    toastShown.set(withSequence(
      withTiming(1, { duration: 180 }),
      withDelay(TOAST_MS, withTiming(0, { duration: 240 })),
    ));
  }, [toastShown]);

  const quickSwitch = useCallback(async () => {
    if (busy.current) return;
    const isPreview = isBuyerDevPreview() || isSellerDevPreview();

    if (isPreview) {
      busy.current = true;
      const next = isSellerDevPreview() ? 'buyer' : 'seller';
      veil.set(withTiming(1, { duration: VEIL_IN_MS }));
      await wait(VEIL_IN_MS);
      setDevWebPreviewRole(next);
      try { localStorage.setItem('user_role', next); } catch { /* storage off */ }
      router.replace((next === 'seller' ? '/(tabs)/?bt_preview=seller' : '/(buyer)/?bt_preview=buyer') as never);
      showToast(PREVIEW_ACCOUNTS[next].handle, PREVIEW_ACCOUNTS[next].avatarUri);
      veil.set(withDelay(60, withTiming(0, { duration: VEIL_OUT_MS })));
      busy.current = false;
      return;
    }

    const next = pickNextAccount(activeSessions, sessionId);
    if (!next || !setActive) {
      setSheetOpen(true);
      return;
    }
    busy.current = true;
    const nextUser = next.user!;
    const nextInfo = info[nextUser.id];
    veil.set(withTiming(1, { duration: VEIL_IN_MS }));
    await wait(VEIL_IN_MS);
    try {
      await setActive({ session: next.id });
    } catch {
      veil.set(withTiming(0, { duration: VEIL_OUT_MS }));
      busy.current = false;
      return;
    }
    // Land on the new account's home. Unknown type (the lookup failed):
    // "/" lets AuthGate route by the account's own stored role.
    const home = nextInfo?.accountType === 'seller' ? '/(tabs)/' : nextInfo?.accountType === 'buyer' ? '/(buyer)/' : '/';
    router.replace(home as never);
    showToast(getHandle(nextUser, nextInfo?.username), nextInfo?.avatarUrl ?? nextUser.imageUrl ?? null);
    // One frame for the new shell to paint under the veil, then fade it out.
    requestAnimationFrame(() => veil.set(withDelay(60, withTiming(0, { duration: VEIL_OUT_MS }))));
    busy.current = false;
  }, [activeSessions, info, router, sessionId, setActive, showToast, veil]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastShown.value,
    transform: [{ translateY: (1 - toastShown.value) * -8 }],
  }));

  const value = useMemo(() => ({ quickSwitch: () => { void quickSwitch(); } }), [quickSwitch]);

  return (
    <QuickSwitchContext.Provider value={value}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, veilStyle]}
      />
      {toast && (
        <Animated.View
          key={toast.key}
          pointerEvents="none"
          testID="quick-switch-toast"
          style={[styles.toastWrap, { top: insets.top + 10 }, toastStyle]}
        >
          <View style={[styles.toast, { backgroundColor: 'rgba(20, 20, 20, 0.94)' }]}>
            {toast.avatarUri
              ? <Image source={{ uri: toast.avatarUri }} style={styles.avatar} />
              : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{toast.handle.replace(/^@/, '').charAt(0).toUpperCase()}</Text>
                </View>
              )}
            <Text style={styles.handle} numberOfLines={1}>{toast.handle}</Text>
          </View>
        </Animated.View>
      )}
      <AccountSwitcherSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </QuickSwitchContext.Provider>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    maxWidth: 280,
  },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  avatarFallback: { backgroundColor: 'rgba(255, 255, 255, 0.16)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 12 },
  handle: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 14 },
});
