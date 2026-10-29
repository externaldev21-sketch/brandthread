/**
 * One-tap notify-me bell for a drop row, the same bell as DropsCalendar
 * (44pt circle, outlined off / filled on) on the existing drop alert
 * endpoints (api.publicDrops.notificationStatus / subscribe / unsubscribe,
 * all requireAuth). Signed out it never calls them: the tap opens sign-in
 * and returns here (hooks/useSignInGate.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/hooks/useApi';
import { useSignInGate } from '@/hooks/useSignInGate';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { hapticSelection } from '@/lib/haptics';

// Keeps a row's state when the list virtualises it away and back. Keyed by
// account + drop: a subscription belongs to one buyer, so another account
// signing in on this device must not inherit (or skip fetching) it.
const statusCache = new Map<string, boolean>();

export function DropNotifyBell({ dropId, dropName }: { dropId: string; dropName: string }) {
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { isSignedIn, goToSignIn } = useSignInGate();
  const { userId } = useAuth();
  const { showUndo } = useUndoToast();
  const cacheKey = `${isSignedIn && userId ? userId : 'signed-out'}:${dropId}`;
  const [on, setOn] = useState<boolean>(() => statusCache.get(cacheKey) ?? false);
  const [pending, setPending] = useState(false);

  const set = useCallback((value: boolean) => {
    statusCache.set(cacheKey, value);
    setOn(value);
  }, [cacheKey]);

  useEffect(() => {
    // Account changed (or signed out) while mounted: show that account's state.
    setOn(statusCache.get(cacheKey) ?? false);
    if (!isSignedIn || statusCache.has(cacheKey)) return;
    let cancelled = false;
    api.publicDrops.notificationStatus(dropId)
      .then((r) => { if (!cancelled) set(!!r.subscribed); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, cacheKey, dropId, isSignedIn, set]);

  const toggle = useCallback(async () => {
    if (pending) return;
    if (!isSignedIn) { goToSignIn(); return; }
    hapticSelection();
    const wasOn = on;
    setPending(true);
    try {
      const res = wasOn ? await api.publicDrops.unsubscribe(dropId) : await api.publicDrops.subscribe(dropId);
      set(!!res.subscribed);
      if (!wasOn) {
        showUndo({
          message: 'We’ll notify you when it drops',
          tone: 'monochrome',
          undo: async () => { await api.publicDrops.unsubscribe(dropId); set(false); },
        });
      }
    } catch {
      Alert.alert('Could not update alert', 'Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }, [api, dropId, goToSignIn, isSignedIn, on, pending, set, showUndo]);

  return (
    <PressableScale
      onPress={toggle}
      disabled={pending}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `Turn off alert for ${dropName}` : `Notify me about ${dropName}`}
      style={[styles.bell, on ? styles.bellOn : styles.bellOff]}
      testID={`drop-bell-${dropId}`}
    >
      <Feather name="bell" size={18} color={on ? theme.background : theme.text} />
    </PressableScale>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bellOn: { backgroundColor: theme.text },
  bellOff: { borderColor: theme.border, borderWidth: 1 },
});
