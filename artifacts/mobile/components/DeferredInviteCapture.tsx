import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import {
  DEFERRED_INVITE_CHECKED_KEY, deferredInviteEnabled, inviteCodeFromHandoff, shouldCheckDeferredInvite,
} from '@/lib/deferredInvite';

/**
 * Renders nothing. On the first signed-out launch after install, picks up an
 * invite link the web invite page copied before sending the person to the
 * store, and opens it (BT-312). See lib/deferredInvite.ts.
 */
export function DeferredInviteCapture() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !isLoaded) return;
    ran.current = true;
    void (async () => {
      let alreadyChecked = true;
      try { alreadyChecked = (await AsyncStorage.getItem(DEFERRED_INVITE_CHECKED_KEY)) === '1'; } catch { /* treat as checked */ }
      if (alreadyChecked) return;
      // One look per install, at the first launch only — an existing member
      // signing out later never gets a paste prompt.
      try { await AsyncStorage.setItem(DEFERRED_INVITE_CHECKED_KEY, '1'); } catch { /* best effort */ }
      if (!shouldCheckDeferredInvite({
        platform: Platform.OS, isLoaded, isSignedIn: !!isSignedIn, alreadyChecked, enabled: deferredInviteEnabled(),
      })) return;
      try {
        const hasCandidate = Platform.OS === 'ios' ? await Clipboard.hasUrlAsync() : await Clipboard.hasStringAsync();
        if (!hasCandidate) return;
        const code = inviteCodeFromHandoff(await Clipboard.getStringAsync());
        if (code) router.push(`/invite/${code}` as never);
      } catch { /* clipboard unavailable or paste declined */ }
    })();
  }, [isLoaded, isSignedIn, router]);

  return null;
}
