/**
 * Store setup — claim the store name and @handle. Availability is checked
 * live (debounced) against GET /api/seller/identity/check; Continue saves
 * through PUT /api/seller/identity, which re-runs every check on the server.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { HANDLE_RE, normalizeHandleInput, suggestHandle } from '@/lib/storeSetup';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StoreSetupScreen } from '@/components/store-setup/StoreSetupScreen';
import { StoreSetupField, type FieldStatus } from '@/components/store-setup/StoreSetupField';

const DEBOUNCE_MS = 400;
// Preview has no session, so the server is never called; these stand in for
// names and handles somebody else already owns.
const PREVIEW_TAKEN = new Set(['admin', 'brandthread', 'support', 'studio']);

type Availability = { available: boolean; error?: string };

export default function StoreSetupNameScreen() {
  const router = useRouter();
  const api = useApi();
  const preview = isSellerDevPreview();
  const demo = preview && isPreviewDemoMode();

  const [name, setName] = useState(demo ? 'Night Owl Studio' : '');
  const [handle, setHandle] = useState(demo ? 'night_owl' : '');
  const [handleEdited, setHandleEdited] = useState(demo);
  const [nameStatus, setNameStatus] = useState<FieldStatus>({ kind: 'idle' });
  const [handleStatus, setHandleStatus] = useState<FieldStatus>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seq = useRef(0);

  // Prefill with what the seller already has.
  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      if (profile.brandName) setName(profile.brandName);
      if (profile.username) { setHandle(profile.username); setHandleEdited(true); }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmedName = name.replace(/\s+/g, ' ').trim();
  const cleanHandle = normalizeHandleInput(handle);

  useEffect(() => {
    setSaveError(null);
    const wantName = trimmedName.length >= 2;
    const wantHandle = cleanHandle.length > 0;
    if (!wantName) setNameStatus(trimmedName ? { kind: 'error', message: 'Enter at least 2 characters.' } : { kind: 'idle' });
    if (!wantHandle) setHandleStatus({ kind: 'idle' });
    else if (!HANDLE_RE.test(cleanHandle)) {
      setHandleStatus({ kind: 'error', message: 'Use 3 to 30 letters, numbers or underscores.' });
    }
    const checkHandle = wantHandle && HANDLE_RE.test(cleanHandle);
    if (!wantName && !checkHandle) return;

    if (wantName) setNameStatus({ kind: 'checking' });
    if (checkHandle) setHandleStatus({ kind: 'checking' });
    const mySeq = ++seq.current;
    const timer = setTimeout(async () => {
      let result: { name?: Availability; handle?: Availability };
      if (preview) {
        result = {
          name: wantName ? { available: !PREVIEW_TAKEN.has(trimmedName.toLowerCase()), error: 'That name is already taken.' } : undefined,
          handle: checkHandle ? { available: !PREVIEW_TAKEN.has(cleanHandle), error: 'That handle is already taken.' } : undefined,
        };
      } else {
        try {
          result = await api.seller.checkStoreIdentity({
            ...(wantName ? { name: trimmedName } : {}),
            ...(checkHandle ? { handle: cleanHandle } : {}),
          });
        } catch {
          if (mySeq !== seq.current) return;
          if (wantName) setNameStatus({ kind: 'error', message: 'Could not check this name. Try again.' });
          if (checkHandle) setHandleStatus({ kind: 'error', message: 'Could not check this handle. Try again.' });
          return;
        }
      }
      // A newer keystroke supersedes this response.
      if (mySeq !== seq.current) return;
      if (result.name) {
        setNameStatus(result.name.available ? { kind: 'ok', message: 'Available' } : { kind: 'error', message: result.name.error ?? 'That name is not available.' });
      }
      if (result.handle) {
        setHandleStatus(result.handle.available ? { kind: 'ok', message: 'Available' } : { kind: 'error', message: result.handle.error ?? 'That handle is not available.' });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedName, cleanHandle]);

  const canContinue = nameStatus.kind === 'ok' && handleStatus.kind === 'ok' && !saving;

  async function save() {
    if (!canContinue) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (!preview) {
        await api.seller.saveStoreIdentity({ brandName: trimmedName, handle: cleanHandle });
      }
      goBackOr(router);
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Could not save your store name. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <StoreSetupScreen
      header={<ScreenHeader title="Store name" hideDivider />}
      heading="Name your store"
      ctaLabel="Continue"
      onCta={save}
      ctaDisabled={!canContinue}
      ctaLoading={saving}
    >
      <StoreSetupField
        label="Store name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          if (!handleEdited) setHandle(suggestHandle(value));
        }}
        status={nameStatus}
        placeholder="Night Owl Studio"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={50}
        returnKeyType="next"
        testID="store-setup-name-input"
      />
      <StoreSetupField
        label="Handle"
        prefix="@"
        value={handle}
        onChangeText={(value) => { setHandle(value.replace(/^@+/, '')); setHandleEdited(true); }}
        status={saveError ? { kind: 'error', message: saveError } : handleStatus}
        placeholder="night_owl"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={30}
        returnKeyType="done"
        testID="store-setup-handle-input"
      />
    </StoreSetupScreen>
  );
}
