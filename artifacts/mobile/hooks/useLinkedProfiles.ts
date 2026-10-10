/**
 * "Start selling" / "Shop as a buyer" and switching between the buyer and
 * seller profiles of one login. See lib/linkedProfiles.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth, useClerk, useSignIn } from '@clerk/expo';
import { useApi, type LinkedProfilesResponse } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import {
  ONBOARDING_COMPLETE_KEY,
  previewLinkedProfiles,
  ONBOARDING_PENDING_FLOW_KEY,
  parseStartProfileError,
  sessionForProfile,
  type ProfileRole,
  type StartProfileOutcome,
} from '@/lib/linkedProfiles';

export function useLinkedProfiles(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const api = useApi();
  const router = useRouter();
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const { isSignedIn, userId } = useAuth();
  const [data, setData] = useState<LinkedProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const requestRef = useRef(0);

  const preview = !isSignedIn && (isBuyerDevPreview() || isSellerDevPreview());

  const refresh = useCallback(async () => {
    if (preview) {
      // Signed-out preview never calls the API (see lib/linkedProfiles.ts).
      setData(previewLinkedProfiles(isSellerDevPreview() ? 'seller' : 'buyer', isPreviewDemoMode(), PREVIEW_SELLER_IDENTITY));
      return;
    }
    if (!isSignedIn) { setData(null); return; }
    const id = ++requestRef.current;
    setLoading(true);
    try {
      const next = await api.accounts.profiles();
      if (id === requestRef.current) setData(next);
    } catch {
      // The switcher still works from this device's sessions alone.
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [api, isSignedIn, preview]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh, userId]);

  /** Makes `clerkId` the active profile, signing it in on this device first if needed. */
  const activateProfile = useCallback(async (clerkId: string, signInToken?: string) => {
    const existing = sessionForProfile(clerk.client?.sessions as never, clerkId) as { id: string } | null;
    if (existing) {
      await clerk.setActive({ session: existing.id });
      return;
    }
    const ticket = signInToken ?? (await api.accounts.signInToken(clerkId)).signInToken;
    const { error } = await signIn.ticket({ ticket });
    if (error) throw error;
    const { error: finalizeError } = await signIn.finalize();
    if (finalizeError) throw finalizeError;
  }, [api, clerk, signIn]);

  const switchTo = useCallback(async (clerkId: string) => {
    if (busy || preview) return;
    setBusy(clerkId);
    try {
      await activateProfile(clerkId);
      // AuthGate routes to the buyer or seller shell for the active profile.
      router.replace('/' as never);
    } finally {
      setBusy(null);
    }
  }, [activateProfile, busy, preview, router]);

  /**
   * Creates the other-role profile under this login, signs into it, and goes
   * straight to onboarding after the account step (no email or password step).
   */
  const startProfile = useCallback(async (role: ProfileRole): Promise<StartProfileOutcome> => {
    if (busy || preview) return { kind: 'error', message: '' };
    setBusy(`new:${role}`);
    try {
      const created = await api.accounts.createProfile(role);
      await AsyncStorage.multiSet([
        [ONBOARDING_PENDING_FLOW_KEY, role],
        [ONBOARDING_COMPLETE_KEY, 'false'],
      ]).catch(() => {});
      await activateProfile(created.profile.clerkId, created.signInToken);
      router.replace('/onboarding?postAuth=1' as never);
      return { kind: 'started' };
    } catch (err) {
      return parseStartProfileError(err, role);
    } finally {
      setBusy(null);
    }
  }, [activateProfile, api, busy, preview, router]);

  return { data, loading, busy, preview, refresh, switchTo, startProfile, activateProfile };
}
