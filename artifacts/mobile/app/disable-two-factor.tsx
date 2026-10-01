/**
 * Turn off two-factor authentication — requires a current authenticator code
 * (or a backup code) so a borrowed, unlocked phone can't quietly drop 2FA.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser, useSession, useReverification } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { SecurityBody, SecurityField, SecurityIntro, SecurityErrorBox } from '@/components/security/SecurityFormKit';
import { useColors } from '@/hooks/useColors';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { mapSecurityError } from '@/lib/accountSecurityErrors';

export default function DisableTwoFactor() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useUser();
  const { session } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const disableTotp = useReverification(() => user!.disableTOTP());

  async function confirm() {
    const value = code.trim().replace(/\s/g, '');
    if (!user || !session || !value || busy) return;
    setBusy(true);
    setError('');
    try {
      await session.startVerification({ level: 'multi_factor' });
      await session.attemptSecondFactorVerification(
        /^\d{6}$/.test(value) ? { strategy: 'totp', code: value } : { strategy: 'backup_code', code: value },
      );
      await disableTotp();
      await user.reload();
      goBackOr(router);
    } catch (e) {
      setError(mapSecurityError(e, 'twoFactor').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Turn off two-factor" />
      <SecurityBody>
        <SecurityIntro>
          Enter a code from your authenticator app, or one of your backup codes, to confirm it's you.
        </SecurityIntro>
        <SecurityField
          testID="disable-2fa-code-input"
          label="Code"
          value={code}
          onChangeText={(v) => { setCode(v); setError(''); }}
          placeholder="000000"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          returnKeyType="done"
          onSubmitEditing={confirm}
          autoFocus
        />
        <SecurityErrorBox message={error} testID="disable-2fa-error" />
        <Button
          testID="confirm-disable-2fa"
          label="Turn off two-factor"
          variant="destructive"
          onPress={confirm}
          disabled={!code.trim()}
          loading={busy}
          fullWidth
          style={{ marginTop: 16 }}
        />
      </SecurityBody>
    </View>
  );
}
