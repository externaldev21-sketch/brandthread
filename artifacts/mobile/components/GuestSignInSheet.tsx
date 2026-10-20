import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Text } from 'react-native';
import { useAuth, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import { useRouter } from 'expo-router';
import { Sheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { isOAuthCancellationError, makeBrandthreadRedirectUri, mapOAuthError, oauthProviderVisibility } from '@/lib/oauthFlow';
import { closeGuestSignIn, getGuestSignInRequest, subscribeGuestSignIn } from '@/lib/guestSignIn';

/** The same dismissible prompt for account actions across all public surfaces. */
export function GuestSignInSheet() {
  const request = useSyncExternalStore(subscribeGuestSignIn, getGuestSignInRequest, () => null);
  const { isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();
  const apple = useFeatureFlag('oauthAppleEnabled');
  const google = useFeatureFlag('oauthGoogleEnabled');
  const providers = oauthProviderVisibility(Platform.OS, { apple, google });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const colors = useColors();
  useEffect(() => { if (isSignedIn) closeGuestSignIn(false); }, [isSignedIn]);
  useEffect(() => { if (request) setError(''); }, [request]);
  async function oauth(provider: 'Apple' | 'Google') {
    if (busy || !request) return;
    const returnTo = request.returnTo;
    setBusy(provider);
    setError('');
    try {
      const result = await startSSOFlow({
        strategy: provider === 'Apple' ? 'oauth_apple' : 'oauth_google',
        redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri),
      });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        closeGuestSignIn(false); // Stay at the exact mounted screen. Never replay the action.
      } else if (result.signUp) {
        closeGuestSignIn(false);
        router.push({ pathname: '/onboarding', params: { returnTo } } as never);
      }
    } catch (cause) {
      if (!isOAuthCancellationError(cause)) setError(mapOAuthError(provider, cause));
    } finally { setBusy(null); }
  }
  return (
    <Sheet
      visible={!!request && !isSignedIn}
      title="Sign in to continue"
      onClose={() => closeGuestSignIn()}
      testID="guest-sign-in-sheet"
      primaryAction={{
        label: 'Continue with email',
        disabled: !!busy,
        testID: 'guest-continue-sign-in',
        onPress: () => {
          if (!request) return;
          const returnTo = request.returnTo;
          request.beforeEmailSignIn?.();
          closeGuestSignIn(false);
          router.push({ pathname: '/sign-in', params: { returnTo, guestPrompt: '1' } } as never);
        },
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, marginBottom: 16 }}>
        Sign in to like, follow, save or shop. You can keep browsing without an account.
      </Text>
      {providers.apple && <Button label="Continue with Apple" fullWidth variant="secondary" disabled={!!busy} loading={busy === 'Apple'} onPress={() => { void oauth('Apple'); }} />}
      {providers.google && <Button label="Continue with Google" fullWidth variant="secondary" disabled={!!busy} loading={busy === 'Google'} onPress={() => { void oauth('Google'); }} />}
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.foreground, fontFamily: FONT.regular, marginVertical: 12 }}>{error}</Text>}
      <Button label="Keep browsing" variant="tertiary" fullWidth onPress={() => closeGuestSignIn()} testID="guest-keep-browsing" />
    </Sheet>
  );
}
