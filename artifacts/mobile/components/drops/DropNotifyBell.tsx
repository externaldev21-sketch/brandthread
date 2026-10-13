/**
 * One-tap notify-me bell for a drop row, the same bell as DropsCalendar
 * (44pt circle, outlined off / filled on) on the existing drop alert
 * endpoints (api.publicDrops.notificationStatus / subscribe / unsubscribe,
 * all requireAuth). Signed out it never calls them: the tap opens sign-in
 * and returns here (hooks/useSignInGate.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/hooks/useApi';
import { useSignInGate } from '@/hooks/useSignInGate';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { hapticSelection } from '@/lib/haptics';

// Keeps a row's state when the list virtualises it away and back.
const statusCache = new Map<string, boolean>();

export function DropNotifyBell({ dropId, dropName }: { dropId: string; dropName: string }) {
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { isSignedIn, goToSignIn } = useSignInGate();
  const { showUndo } = useUndoToast();
  const [on, setOn] = useState<boolean>(() => statusCache.get(dropId) ?? false);
  const [pending, setPending] = useState(false);

  const set = useCallback((value: boolean) => {
    statusCache.set(dropId, value);
    setOn(value);
  }, [dropId]);

  useEffect(() => {
    if (!isSignedIn || statusCache.has(dropId)) return;
    let cancelled = false;
    api.publicDrops.notificationStatus(dropId)
      .then((r) => { if (!cancelled) set(!!r.subscribed); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, dropId, isSignedIn, set]);

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
