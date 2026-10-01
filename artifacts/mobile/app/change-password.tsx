/**
 * Change password — current + new + confirm, via Clerk's user.updatePassword.
 * Reached from Password and security (buyer), Security (seller) and Login methods.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useUser, useReverification } from '@clerk/expo';
import { Button } from '@/components/ui/Button';
import { Card, ListRow } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SecurityBody, SecurityField, SecurityIntro, SecurityErrorBox, SecuritySuccess } from '@/components/security/SecurityFormKit';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { mapSecurityError, validatePasswordChange } from '@/lib/accountSecurityErrors';

export default function ChangePassword() {
  const router = useRouter();
  const colors = useColors();
  const { user } = useUser();
  const hasPassword = user?.passwordEnabled ?? true;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Clerk may demand a fresh verification before a credential change; this
  // wrapper runs that prompt and retries the call once it is satisfied.
  const updatePassword = useReverification(
    (params: { newPassword: string; currentPassword?: string; signOutOfOtherSessions?: boolean }) =>
      user!.updatePassword(params),
  );

  async function save() {
    if (!user || saving) return;
    const invalid = validatePasswordChange({ current, next, confirm, requireCurrent: hasPassword });
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    setError('');
    try {
      await updatePassword({
        newPassword: next,
        ...(hasPassword ? { currentPassword: current } : {}),
        signOutOfOtherSessions: signOutOthers,
      });
      await user.reload();
      setDone(true);
    } catch (e) {
      setError(mapSecurityError(e, 'password').message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={hasPassword ? 'Change password' : 'Add password'} />
      <SecurityBody>
        {done ? (
          <SecuritySuccess
            title="Password changed"
            body={signOutOthers ? 'You were signed out of your other devices.' : undefined}
            onDone={() => goBackOr(router)}
          />
        ) : (<>
        <SecurityIntro>
        Use at least 8 characters. Pick something you don't use on other sites.
      </SecurityIntro>

      {hasPassword ? (
        <SecurityField
          testID="current-password-input"
          label="Current password"
          value={current}
          onChangeText={(v) => { setCurrent(v); setError(''); }}
          secure
          autoComplete="current-password"
          textContentType="password"
        />
      ) : null}
      <SecurityField
        testID="new-password-input"
        label="New password"
        value={next}
        onChangeText={(v) => { setNext(v); setError(''); }}
        placeholder="Minimum 8 characters"
        secure
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <SecurityField
        testID="confirm-password-input"
        label="Confirm new password"
        value={confirm}
        onChangeText={(v) => { setConfirm(v); setError(''); }}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={save}
      />

      <Card style={{ padding: 0, marginTop: 20, paddingHorizontal: 16 }}>
        <ListRow
          icon="smartphone"
          title="Sign out other devices"
          subtitle="Everywhere except this device"
          toggle={{ value: signOutOthers, onChange: setSignOutOthers }}
        />
      </Card>

      <SecurityErrorBox message={error} testID="change-password-error" />

      <Button
        testID="save-password-button"
        label={hasPassword ? 'Change password' : 'Add password'}
        onPress={save}
        loading={saving}
        fullWidth
        style={{ marginTop: 16 }}
      />
      {hasPassword ? (
        <Button
          label="Forgot your password?"
          variant="tertiary"
          size="small"
          onPress={() => router.push('/forgot-password' as never)}
          style={{ marginTop: 8 }}
        />
      ) : null}
        </>)}
      </SecurityBody>
    </View>
  );
}
