/**
 * Store setup — logo (1:1), banner (3:1) and a monochrome accent. Each image
 * is picked, framed in the shared MediaCropper (same pan/zoom crop used by
 * create post and products, with the zoom slider and wheel on web), then
 * uploaded through the existing /api/seller/profile/{logo,banner}/upload
 * endpoints. The accent is saved on Done via PUT /api/seller/profile/accent.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/hooks/useApi';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { uploadImageWithProgress } from '@/lib/uploadWithProgress';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { cropToRect } from '@/lib/storeBrandImage';
import { greyHex, STORE_ACCENT_COLORS } from '@/lib/storeSetup';
import { hapticSelection } from '@/lib/haptics';
import { FONT, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TYPE_SCALE } from '@/constants/typography';
import { MediaCropper } from '@/components/media/MediaCropper';
import { useImageSourceSheet } from '@/components/profile/ImageSourceSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StoreSetupScreen } from '@/components/store-setup/StoreSetupScreen';

type Slot = 'logo' | 'banner';

const SLOT_CONFIG: Record<Slot, { aspect: [number, number]; ratio: number; maxWidth: number; path: string; key: 'logoUrl' | 'bannerUrl'; cropTitle: string }> = {
  logo:   { aspect: [1, 1], ratio: 1, maxWidth: 800,  path: '/api/seller/profile/logo/upload',   key: 'logoUrl',   cropTitle: 'Crop logo' },
  banner: { aspect: [3, 1], ratio: 3, maxWidth: 1800, path: '/api/seller/profile/banner/upload', key: 'bannerUrl', cropTitle: 'Crop banner' },
};

export default function StoreSetupBrandScreen() {
  const router = useRouter();
  const api = useApi();
  const { getToken } = useAuth();
  const { theme } = useAppTheme();
  const topInset = useHeaderTopInset();
  const preview = isSellerDevPreview();
  const demo = preview && isPreviewDemoMode();
  const { open: openImageSheet, sheet: imageSourceSheet } = useImageSourceSheet();

  const [uris, setUris] = useState<Record<Slot, string | null>>({ logo: null, banner: null });
  const [progress, setProgress] = useState<Record<Slot, number | null>>({ logo: null, banner: null });
  const [errors, setErrors] = useState<Record<Slot, string | null>>({ logo: null, banner: null });
  const [accent, setAccent] = useState<string | null>(demo ? '#C0C0C0' : null);
  const [savedAccent, setSavedAccent] = useState<string | null>(demo ? '#C0C0C0' : null);
  const [crop, setCrop] = useState<{ slot: Slot; uri: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    api.seller.getProfile().then((profile) => {
      if (cancelled) return;
      setUris((prev) => ({ logo: prev.logo ?? profile.logoUrl ?? null, banner: prev.banner ?? profile.bannerUrl ?? null }));
      setAccent(profile.storeAccentColor ?? null);
      setSavedAccent(profile.storeAccentColor ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(slot: Slot) {
    const asset = await openImageSheet({ aspect: SLOT_CONFIG[slot].aspect, skipNativeEdit: true });
    if (asset) setCrop({ slot, uri: asset.uri });
  }

  async function onCropSaved(slot: Slot, rect: Parameters<typeof cropToRect>[1]) {
    const source = crop?.uri;
    setCrop(null);
    if (!source) return;
    const config = SLOT_CONFIG[slot];
    const previous = uris[slot];
    setErrors((prev) => ({ ...prev, [slot]: null }));
    setProgress((prev) => ({ ...prev, [slot]: 0 }));
    try {
      const cropped = await cropToRect(source, rect, config.maxWidth);
      setUris((prev) => ({ ...prev, [slot]: cropped.uri }));
      if (!preview) {
        const token = await getToken();
        const result = await uploadImageWithProgress<Record<string, string>>(
          config.path,
          cropped,
          token,
          (pct) => setProgress((prev) => ({ ...prev, [slot]: pct })),
        );
        setUris((prev) => ({ ...prev, [slot]: result[config.key] }));
      }
    } catch {
      setUris((prev) => ({ ...prev, [slot]: previous }));
      setErrors((prev) => ({ ...prev, [slot]: 'Upload failed. Check your connection and try again.' }));
    } finally {
      setProgress((prev) => ({ ...prev, [slot]: null }));
    }
  }

  const uploading = progress.logo !== null || progress.banner !== null;
  const canFinish = !!uris.logo && !uploading && !saving;

  async function finish() {
    if (!canFinish) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (!preview) {
        if (accent !== savedAccent) await api.seller.setStoreAccent(accent);
        void completeSetupTaskWhen('customize_store', true);
      }
      goBackOr(router);
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Could not save your accent color. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderSlot(slot: Slot, label: string, emptyLabel: string, tileStyle: object) {
    const uri = uris[slot];
    const busy = progress[slot] !== null;
    return (
      <View style={styles.group}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
          {busy ? <Text style={[styles.meta, { color: theme.muted }]}>{`Uploading ${progress[slot]}%`}</Text> : null}
        </View>
        <Pressable
          onPress={() => { hapticSelection(); void pick(slot); }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={uri ? `Change ${label.toLowerCase()}` : emptyLabel}
          testID={`store-setup-${slot}`}
          style={[styles.tile, tileStyle, { borderColor: theme.border, backgroundColor: theme.background }]}
        >
          {uri ? (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.empty}>
              <Icon name="image" size={22} color={theme.muted} />
              <Text style={[styles.meta, { color: theme.muted }]}>{emptyLabel}</Text>
            </View>
          )}
          {busy ? (
            <View style={[StyleSheet.absoluteFill, styles.busy, { backgroundColor: theme.background }]}>
              <ActivityIndicator color={theme.text} />
            </View>
          ) : null}
        </Pressable>
        {errors[slot] ? (
          <View style={styles.errorRow}>
            <Icon name="x-circle" size={15} color={theme.text} />
            <Text style={[styles.meta, { color: theme.text, flexShrink: 1 }]}>{errors[slot]}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <>
      <StoreSetupScreen
        header={<ScreenHeader title="Logo and banner" hideDivider />}
        heading="Brand your store"
        ctaLabel="Done"
        onCta={finish}
        ctaDisabled={!canFinish}
        ctaLoading={saving}
      >
        {renderSlot('banner', 'Banner', 'Add banner', styles.bannerTile)}
        {renderSlot('logo', 'Logo', 'Add logo', styles.logoTile)}

        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.text }]}>Accent color</Text>
          <View style={styles.swatches} accessibilityRole="radiogroup" testID="store-setup-swatches">
            {STORE_ACCENT_COLORS.map((color, index) => {
              const selected = accent === color;
              const dark = index < 2;
              return (
                <Pressable
                  key={color}
                  onPress={() => { hapticSelection(); setAccent(selected ? null : color); setSaveError(null); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Accent ${color}`}
                  testID={`store-setup-accent-${color.slice(1)}`}
                  style={[
                    styles.swatch,
                    { backgroundColor: color, borderColor: selected ? theme.text : theme.border, borderWidth: selected ? 2 : 1 },
                  ]}
                >
                  {selected ? <Icon name="check" size={18} color={greyHex(dark ? 255 : 0)} /> : null}
                </Pressable>
              );
            })}
          </View>
          {saveError ? (
            <View style={styles.errorRow}>
              <Icon name="x-circle" size={15} color={theme.text} />
              <Text style={[styles.meta, { color: theme.text, flexShrink: 1 }]}>{saveError}</Text>
            </View>
          ) : null}
        </View>
      </StoreSetupScreen>
      {imageSourceSheet}
      {crop ? (
        <MediaCropper
          visible
          uri={crop.uri}
          targetRatio={SLOT_CONFIG[crop.slot].ratio}
          title={SLOT_CONFIG[crop.slot].cropTitle}
          topInset={topInset}
          showFrame
          centerHeaderActions
          onCancel={() => setCrop(null)}
          onSave={({ rect }) => { void onCropSaved(crop.slot, rect); }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: SP.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...TYPE_SCALE.callout, fontFamily: FONT.semibold },
  meta: { ...TYPE_SCALE.footnote },
  tile: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  bannerTile: { width: '100%', aspectRatio: 3, borderRadius: RADII.card },
  logoTile: { width: 112, aspectRatio: 1, borderRadius: RADII.card },
  empty: { alignItems: 'center', gap: SP.xs },
  busy: { alignItems: 'center', justifyContent: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  swatches: { flexDirection: 'row', gap: SP.sm + 4, flexWrap: 'wrap' },
  swatch: { width: 44, height: 44, borderRadius: RADII.full, alignItems: 'center', justifyContent: 'center' },
});
