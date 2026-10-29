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
 * uses, and the sheet's own row taps run through `switchAccount` here too,
 * so both get the same transition (lib/accountSwitchTransition.ts): the app
 * content is covered by the background colour, which stays up until the new
 * account's caches are scoped and its home — the seller Dashboard for a
 * seller account, Threads for a buyer — has painted, so a half-mounted
 * shell or the old account's screens with the new account's (still empty)
 * data never show. A small toast then shows the new account's avatar and
 * @handle.
 *
 * Only accounts actually signed in on this device are ever switched to.
 * Preview mode (`?bt_preview=…`) has no real Clerk session, so a hold there
 * opens the sheet, which leads straight to Add account.
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
import { getAccountScope, subscribeAccountScope } from '@/lib/accountScope';
import {
  SWITCH_COVER_IN_MS,
  SWITCH_COVER_OUT_MS,
  runAccountSwitch,
  type AccountKind,
  type AccountSwitchResult,
} from '@/lib/accountSwitchTransition';
import { pickNextAccount } from '@/lib/holdToSwitch';
import { prefetchRouteCode } from '@/lib/navigation/routeWarmup';
import { subscribeScreenInteractive } from '@/lib/perf';
import { FONT, MEDIA } from '@/lib/theme';

export type SwitchAccountRequest = {
  /** Makes the account active (Clerk setActive, or a same-login sign-in). */
  activate: () => Promise<void>;
  /** Clerk user id being switched to, when known. */
  userId: string | null;
  kind: AccountKind;
  handle: string;
  avatarUri: string | null;
};

type QuickSwitchContextValue = {
  /** Run on a completed hold: switch to the next account, or open the sheet. */
  quickSwitch: () => void;
  /** Switch accounts behind the cover; resolves when the new account shows. */
  switchAccount: (request: SwitchAccountRequest) => Promise<AccountSwitchResult>;
};

const QuickSwitchContext = createContext<QuickSwitchContextValue>({
  quickSwitch: () => {},
  switchAccount: async (request) => {
    try { await request.activate(); return 'switched'; } catch { return 'failed'; }
  },
});

export function useQuickAccountSwitch() {
  return useContext(QuickSwitchContext);
}

type AccountInfo = { accountType: 'buyer' | 'seller' | null; username: string | null; avatarUrl: string | null };

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

  const switchAccount = useCallback(async (request: SwitchAccountRequest): Promise<AccountSwitchResult> => {
    if (busy.current) return 'failed';
    busy.current = true;
    try {
      const result = await runAccountSwitch({ userId: request.userId, kind: request.kind }, {
        cover: () => {
          veil.set(withTiming(1, { duration: SWITCH_COVER_IN_MS }));
          return wait(SWITCH_COVER_IN_MS);
        },
        uncover: () => veil.set(withDelay(60, withTiming(0, { duration: SWITCH_COVER_OUT_MS }))),
        activate: request.activate,
        navigate: (route) => router.replace(route as never),
        warmRoute: prefetchRouteCode,
        getScope: getAccountScope,
        subscribeScope: subscribeAccountScope,
        subscribeScreenReady: subscribeScreenInteractive,
      });
      if (result !== 'failed') showToast(request.handle, request.avatarUri);
      return result;
    } finally {
      busy.current = false;
    }
  }, [router, showToast, veil]);

  const quickSwitch = useCallback(async () => {
    if (busy.current) return;
    // Only real sessions on this device: none other (including preview,
    // which has no Clerk session at all) opens the sheet, which then leads
    // straight to Add account.
    const next = pickNextAccount(activeSessions, sessionId);
    if (!next || !setActive) {
      setSheetOpen(true);
      return;
    }
    const nextUser = next.user!;
    const nextInfo = info[nextUser.id];
    await switchAccount({
      activate: () => setActive({ session: next.id }),
      userId: nextUser.id,
      kind: nextInfo?.accountType ?? null,
      handle: getHandle(nextUser, nextInfo?.username),
      avatarUri: nextInfo?.avatarUrl ?? nextUser.imageUrl ?? null,
    });
  }, [activeSessions, info, sessionId, setActive, switchAccount]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastShown.value,
    transform: [{ translateY: (1 - toastShown.value) * -8 }],
  }));

  const value = useMemo(() => ({
    quickSwitch: () => { void quickSwitch(); },
    switchAccount,
  }), [quickSwitch, switchAccount]);

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
    borderColor: MEDIA.softWhite,
    maxWidth: 280,
  },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  avatarFallback: { backgroundColor: MEDIA.softWhite, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: MEDIA.foreground, fontFamily: FONT.bold, fontSize: 12 },
  handle: { color: MEDIA.foreground, fontFamily: FONT.semibold, fontSize: 14 },
});
