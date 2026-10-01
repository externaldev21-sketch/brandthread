/**
 * Change email / change phone — add the new identifier, verify it with a
 * one-time code, make it primary, optionally remove the old one. One flow for
 * both because Clerk models them identically.
 */
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { useUser, useReverification } from '@clerk/expo';
import { Button } from '@/components/ui/Button';
import { Card, ListRow } from '@/components/ui';
import { SecurityBody, SecurityField, SecurityIntro, SecurityErrorBox, SecuritySuccess } from '@/components/security/SecurityFormKit';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { mapSecurityError, normalizePhoneForClerk } from '@/lib/accountSecurityErrors';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

type Kind = 'email' | 'phone';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The slice of Clerk's email/phone resources this flow touches.
type Pending = {
  id: string;
  prepareVerification: (params?: any) => Promise<unknown>;
  attemptVerification: (params: { code: string }) => Promise<{ verification: { status: string | null } }>;
  destroy: () => Promise<unknown>;
};

export function ChangeIdentifier({ kind }: { kind: Kind }) {
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const isEmail = kind === 'email';
  const noun = isEmail ? 'email' : 'phone number';

  const current = isEmail ? user?.primaryEmailAddress : user?.primaryPhoneNumber;
  const currentLabel = isEmail
    ? user?.primaryEmailAddress?.emailAddress
    : user?.primaryPhoneNumber?.phoneNumber;

  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [removeOld, setRemoveOld] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resent, setResent] = useState(false);

  const createIdentifier = useReverification(async (entered: string): Promise<Pending> => {
    if (!user) throw new Error('No user');
    const existing = isEmail
      ? user.emailAddresses.find((a) => a.emailAddress.toLowerCase() === entered.toLowerCase() && a.verification?.status !== 'verified')
      : user.phoneNumbers.find((p) => p.phoneNumber === entered && p.verification?.status !== 'verified');
    if (existing) return existing as unknown as Pending;
    const created = isEmail
      ? await user.createEmailAddress({ email: entered })
      : await user.createPhoneNumber({ phoneNumber: entered });
    return created as unknown as Pending;
  });
  const makePrimary = useReverification(async (id: string) => {
    if (!user) return;
    await user.update(isEmail ? { primaryEmailAddressId: id } : { primaryPhoneNumberId: id });
  });
  const removeIdentifier = useReverification(async (old: { destroy: () => Promise<unknown> }) => { await old.destroy(); });

  async function sendCode() {
    if (!user || busy) return;
    let entered = value.trim();
    if (isEmail) {
      entered = entered.toLowerCase();
      if (!EMAIL_RE.test(entered)) { setError('Enter a valid email address.'); return; }
      if (entered === currentLabel?.toLowerCase()) { setError('That is already your email address.'); return; }
    } else {
      const normalized = normalizePhoneForClerk(entered);
      if (!normalized) { setError('Enter a valid phone number with its country code, like +1 555 123 4567.'); return; }
      if (normalized === currentLabel) { setError('That is already your phone number.'); return; }
      entered = normalized;
    }
    setBusy(true);
    setError('');
    try {
      const target = await createIdentifier(entered);
      await target.prepareVerification(isEmail ? { strategy: 'email_code' } : undefined);
      setPending(target);
      setCode('');
    } catch (e) {
      setError(mapSecurityError(e, kind).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    setResent(false);
    try {
      await pending.prepareVerification(isEmail ? { strategy: 'email_code' } : undefined);
      setResent(true);
    } catch (e) {
      setError(mapSecurityError(e, 'code').message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!user || !pending || busy || code.length < 6) return;
    setBusy(true);
    setError('');
    try {
      const result = await pending.attemptVerification({ code });
      if (result.verification.status !== 'verified') {
        setError("That code isn't right. Try again.");
        return;
      }
      const old = current;
      await makePrimary(pending.id);
      if (removeOld && old && old.id !== pending.id) {
        try { await removeIdentifier(old as unknown as { destroy: () => Promise<unknown> }); } catch { /* the new one is already primary */ }
      }
      await user.reload();
      if (isEmail && !isBuyerDevPreview() && !isSellerDevPreview()) {
        // The server reads the primary email from Clerk on sync.
        try { await api.auth.sync(); } catch { /* next app launch syncs it */ }
      }
      setDone(true);
    } catch (e) {
      setError(mapSecurityError(e, 'code').message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <SecurityBody>
        <SecuritySuccess
          title={isEmail ? 'Email updated' : 'Phone number updated'}
          body={`Your ${noun} is now ${value.trim()}.`}
          onDone={() => goBackOr(router)}
        />
      </SecurityBody>
    );
  }

  if (pending) {
    return (
      <SecurityBody>
        <SecurityIntro>
          {resent ? 'New code sent. ' : ''}Enter the 6-digit code we sent to {value.trim()}.
        </SecurityIntro>
        <SecurityField
          testID="verification-code-input"
          label="Verification code"
          value={code}
          onChangeText={(v) => { setCode(v.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }}
          placeholder="000000"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={verify}
        />
        {current ? (
          <Card style={{ padding: 0, marginTop: 20, paddingHorizontal: 16 }}>
            <ListRow
              icon={isEmail ? 'mail' : 'phone'}
              title={`Remove old ${noun}`}
              subtitle={currentLabel}
              toggle={{ value: removeOld, onChange: setRemoveOld }}
            />
          </Card>
        ) : null}
        <SecurityErrorBox message={error} testID="change-identifier-error" />
        <Button label="Verify and save" onPress={verify} loading={busy} disabled={code.length < 6} fullWidth style={{ marginTop: 16 }} />
        <Button label="Send a new code" variant="tertiary" size="small" onPress={resend} disabled={busy} style={{ marginTop: 8 }} />
        <Button label={`Use a different ${noun}`} variant="tertiary" size="small" onPress={() => { setPending(null); setError(''); }} disabled={busy} />
      </SecurityBody>
    );
  }

  return (
    <SecurityBody>
      <SecurityIntro>
        {currentLabel ? `Your ${noun} is ${currentLabel}. ` : ''}We'll send a code to the new {noun} to confirm it's yours.
      </SecurityIntro>
      <SecurityField
        testID={isEmail ? 'new-email-input' : 'new-phone-input'}
        label={isEmail ? 'New email' : 'New phone number'}
        value={value}
        onChangeText={(v) => { setValue(v); setError(''); }}
        placeholder={isEmail ? 'name@example.com' : '+1 555 123 4567'}
        keyboardType={isEmail ? 'email-address' : 'phone-pad'}
        autoComplete={isEmail ? 'email' : 'tel'}
        textContentType={isEmail ? 'emailAddress' : 'telephoneNumber'}
        returnKeyType="done"
        onSubmitEditing={sendCode}
      />
      <SecurityErrorBox message={error} testID="change-identifier-error" />
      <Button label="Send code" onPress={sendCode} loading={busy} disabled={!value.trim()} fullWidth style={{ marginTop: 16 }} />
    </SecurityBody>
  );
}
