/**
 * Store setup — connect Instagram and TikTok. Each field takes a handle or a
 * profile link; the server normalises it to a canonical https URL (only
 * instagram.com / tiktok.com are accepted) and saves it into
 * users.socialLinks, the same field Edit profile already reads.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { canSaveSocialLinks, handleFromStoredLink, previewSocialLink, socialFieldValue, socialHandleToSave, type SocialPlatform } from '@/lib/storeSetup';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StoreSetupScreen } from '@/components/store-setup/StoreSetupScreen';
import { StoreSetupField, type FieldStatus } from '@/components/store-setup/StoreSetupField';

function statusFor(platform: SocialPlatform, value: string, serverError: string | null): FieldStatus {
  if (serverError) return { kind: 'error', message: serverError };
  const preview = previewSocialLink(platform, value);
  if (preview.status === 'ok') return { kind: 'ok', message: preview.display };
  if (preview.status === 'invalid') return { kind: 'error', message: preview.error };
  return { kind: 'idle' };
}

export default function StoreSetupSocialsScreen() {
  const router = useRouter();
  const api = useApi();
  const preview = isSellerDevPreview();
  const demo = preview && isPreviewDemoMode();

  // Both fields hold "@handle" (links are folded to it on blur); the bare handle is what's sent.
  const [instagram, setInstagram] = useState(demo ? '@nightowlstudio' : '');
  const [tiktok, setTiktok] = useState(demo ? '@nightowlstudio' : '');
  const [saved, setSaved] = useState<Record<SocialPlatform, string>>({ instagram: '', tiktok: '' });
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      const ig = socialFieldValue('instagram', handleFromStoredLink('instagram', profile.socialLinks?.instagram));
      const tt = socialFieldValue('tiktok', handleFromStoredLink('tiktok', profile.socialLinks?.tiktok));
      setInstagram(ig);
      setTiktok(tt);
      setSaved({ instagram: ig, tiktok: tt });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const igPreview = useMemo(() => previewSocialLink('instagram', instagram), [instagram]);
  const ttPreview = useMemo(() => previewSocialLink('tiktok', tiktok), [tiktok]);
  // Clearing both links is allowed when links were saved before — the server
  // removes a platform on an empty value.
  const canContinue = canSaveSocialLinks({ instagram: igPreview, tiktok: ttPreview }, saved) && !saving;

  async function save() {
    if (!canContinue) return;
    setSaving(true);
    setServerError(null);
    try {
      if (!preview) {
        await api.seller.saveSocialLinks({
          instagram: socialHandleToSave('instagram', instagram),
          tiktok: socialHandleToSave('tiktok', tiktok),
        });
      }
      goBackOr(router);
    } catch (err) {
      setServerError(err instanceof Error && err.message ? err.message : 'Could not save your links. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <StoreSetupScreen
      header={<ScreenHeader title="Social links" hideDivider />}
      heading="Connect your socials"
      ctaLabel="Continue"
      onCta={save}
      ctaDisabled={!canContinue}
      ctaLoading={saving}
    >
      <StoreSetupField
        label="Instagram"
        value={instagram}
        onChangeText={(value) => { setInstagram(value); setServerError(null); }}
        onBlur={() => setInstagram((value) => socialFieldValue('instagram', value))}
        status={statusFor('instagram', instagram, null)}
        placeholder="@yourstore or profile link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="next"
        testID="store-setup-instagram-input"
      />
      <StoreSetupField
        label="TikTok"
        value={tiktok}
        onChangeText={(value) => { setTiktok(value); setServerError(null); }}
        onBlur={() => setTiktok((value) => socialFieldValue('tiktok', value))}
        status={statusFor('tiktok', tiktok, serverError)}
        placeholder="@yourstore or profile link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        testID="store-setup-tiktok-input"
      />
    </StoreSetupScreen>
  );
}
