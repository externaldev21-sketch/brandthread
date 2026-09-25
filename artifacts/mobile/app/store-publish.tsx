import React, { useState, useEffect, useMemo } from 'react';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import {
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { getStorefront, validateStore, publishStore, unpublishStore, StoreValidationResult } from '@/services/storeService';
import { Storefront } from '@/services/storeTypes';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';

const ERROR_ROUTES: Record<string, string> = {
  'Store name is required.': '/store-settings',
  'Homepage has no sections.': '/store-editor',
  'No store URL configured.': '/store-domain',
  'No logo uploaded.': '/store-editor',
};

export default function StorePublishScreen() {
  const { theme } = useAppTheme();
  const {
    primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN,
    foreground: FG, mutedForeground: MUTED, subtle: SUBTLE,
    success: SUCCESS, destructive: RED, warning: ORANGE, info: BLUE,
  } = useColors();
  const SUCCESS_DIM = `${SUCCESS}20`;
  const RED_DIM = `${RED}20`;
  const pub = useMemo(() => makePubStyles({ FG, MUTED, SUCCESS, RED }), [FG, MUTED, SUCCESS, RED]);
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{ from?: string }>();
  const [store, setStore] = useState<Storefront | null>(null);
  const [validation, setValidation] = useState<StoreValidationResult | null>(null);
  const [validating, setValidating] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [sharingPreview, setSharingPreview] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [revokingPreview, setRevokingPreview] = useState(false);
  const [previewRevoked, setPreviewRevoked] = useState(false);

  const leaveSetupDestination = () => {
    if (isSellerSetupOrigin(params.from)) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  };

  const handleSharePreview = async () => {
    if (sharingPreview) return;
    setSharingPreview(true);
    try {
      const result = await (api as any).store.sharePreview() as { url: string; expiresAt: string };
      await Clipboard.setStringAsync(result.url);
      setPreviewRevoked(false);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 3000);
    } catch {
      Alert.alert('Could not generate link', 'Check your connection and try again.');
    } finally {
      setSharingPreview(false);
    }
  };

  const handleRevokePreview = () => {
    Alert.alert(
      "Revoke preview link?",
      "Anyone with the current link won't be able to view your store. You can share a fresh link any time.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke', style: 'destructive', onPress: async () => {
            setRevokingPreview(true);
            try {
              await (api as any).store.revokePreview();
              setPreviewRevoked(true);
              setShareCopied(false);
            } catch {
              Alert.alert('Could not revoke link', 'Check your connection and try again.');
            } finally {
              setRevokingPreview(false);
            }
          },
        },
      ],
    );
  };

  const doValidate = async () => {
    setValidating(true);
    try {
      const s = await getStorefront();
      setStore(s);
      setPublished(s.publishStatus === 'published');
      await completeSetupTaskWhen('publish_store', s.publishStatus === 'published');
      const v = await validateStore();
      setValidation(v);
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => { doValidate(); }, []);

  const handlePublish = () => {
    if (!store) return;
    const storeUrl = store.settings.storeUrl || 'yourstore';
    Alert.alert(
      'Publish your store?',
      `Your store will be live at https://${storeUrl}.brandthread.app`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish', onPress: async () => {
            setPublishing(true);
            try {
              const result = await publishStore();
              if (result.success) {
                await completeSetupTaskWhen('publish_store', result.success);
                setPublished(true);
                await doValidate();
              } else {
                Alert.alert('Cannot publish', result.message);
              }
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
    );
  };

  const handleUnpublish = () => {
    Alert.alert(
      'Unpublish store?',
      'Your store will no longer be visible to buyers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpublish', style: 'destructive', onPress: async () => {
            await unpublishStore();
            setPublished(false);
            await doValidate();
          },
        },
      ],
    );
  };

  const storeUrl = store?.settings.storeUrl || 'yourstore';

  return (
    <View style={pub.root}>
      <Header title="Publish Store" onBack={leaveSetupDestination} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pub.scroll}>

        {/* Validation Card */}
        <BrandthreadCard style={pub.card}>
          {validating ? (
            <View style={pub.loadingRow}>
              <ActivityIndicator color={PURPLE} />
              <Text style={pub.loadingText}>Checking your store...</Text>
            </View>
          ) : validation ? (
            <>
              <View style={[pub.validHeader, {
                backgroundColor: validation.errors.length > 0 ? RED_DIM : SUCCESS_DIM,
                borderColor: validation.errors.length > 0 ? RED : SUCCESS,
              }]}>
                <Feather
                  name={validation.errors.length > 0 ? 'x-circle' : 'check-circle'}
                  size={ICON.md}
                  color={validation.errors.length > 0 ? RED : SUCCESS}
                />
                <Text style={[pub.validHeaderText, { color: validation.errors.length > 0 ? RED : SUCCESS }]}>
                  {validation.errors.length > 0
                    ? `${validation.errors.length} issue${validation.errors.length > 1 ? 's' : ''} must be fixed before publishing`
                    : 'Your store is ready to publish'}
                </Text>
              </View>

              {validation.errors.length > 0 && (
                <View style={pub.issueSection}>
                  <Text style={pub.issueTitle}>Errors</Text>
                  {validation.errors.map((err, i) => (
                    <TouchableOpacity
                      key={i}
                      style={pub.issueRow}
                      onPress={() => {
                        const route = Object.keys(ERROR_ROUTES).find(k => err.startsWith(k.slice(0, 10)));
                        if (route) router.push(ERROR_ROUTES[route] as never);
                      }}
                    >
                      <Feather name="x-circle" size={ICON.sm} color={RED} />
                      <Text style={[pub.issueText, { color: RED }]} numberOfLines={2}>{err}</Text>
                      <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {validation.warnings.length > 0 && (
                <View style={pub.issueSection}>
                  <Text style={pub.issueTitle}>Warnings</Text>
                  {validation.warnings.map((w, i) => (
                    <View key={i} style={pub.issueRow}>
                      <Feather name="alert-triangle" size={ICON.sm} color={ORANGE} />
                      <Text style={[pub.issueText, { color: ORANGE }]}>{w}</Text>
                    </View>
                  ))}
                </View>
              )}

              {validation.recommendations.length > 0 && (
                <View style={pub.issueSection}>
                  <Text style={pub.issueTitle}>Recommendations</Text>
                  {validation.recommendations.map((r, i) => (
                    <View key={i} style={pub.issueRow}>
                      <Feather name="info" size={ICON.sm} color={BLUE} />
                      <Text style={[pub.issueText, { color: BLUE }]}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </BrandthreadCard>

        <TouchableOpacity style={pub.revalidateBtn} onPress={doValidate}>
          <Feather name="refresh-cw" size={ICON.xs} color={MUTED} />
          <Text style={pub.revalidateText}>Validate Again</Text>
        </TouchableOpacity>

        {/* Share a private preview link before going live */}
        {!published && (
          <BrandthreadCard style={pub.card}>
            <Text style={pub.shareTitle}>Share a preview link</Text>
            <Text style={pub.shareDesc}>
              Generate a private link to your unpublished store — good for showing a partner or manufacturer before you publish. Valid for 24 hours.
            </Text>
            <View style={pub.shareActions}>
              <SecondaryButton
                label={sharingPreview ? 'Generating…' : shareCopied ? 'Link copied!' : 'Copy preview link'}
                onPress={handleSharePreview}
                disabled={sharingPreview}
                icon={shareCopied ? 'check' : 'link'}
                style={{ flex: 1 }}
              />
              {!previewRevoked && (
                <TouchableOpacity onPress={handleRevokePreview} disabled={revokingPreview} style={pub.revokeBtn}>
                  <Text style={pub.revokeText}>{revokingPreview ? 'Revoking…' : 'Revoke'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </BrandthreadCard>
        )}

        {/* Publish / Published */}
        {published ? (
          <BrandthreadCard style={pub.card}>
            <View style={pub.successBlock}>
              <View style={[pub.successIcon, { backgroundColor: SUCCESS_DIM }]}>
                <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
              </View>
              <Text style={pub.successTitle}>Your store is live!</Text>
              <Text style={pub.successUrl}>https://{storeUrl}.brandthread.app</Text>
              <View style={pub.successActions}>
                <SecondaryButton label="View store" onPress={() => Linking.openURL(`https://${storeUrl}.brandthread.app`).catch(() => Alert.alert("Couldn't open your store", 'Try again.'))} icon="external-link" style={{ flex: 1 }} />
                <PrimaryButton
                  label={isSellerSetupOrigin(params.from) ? 'Done' : 'Continue Editing'}
                  onPress={leaveSetupDestination}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </BrandthreadCard>
        ) : validation?.canPublish ? (
          <GradientCard colors={theme.primaryGradient} style={pub.card} glow>
            <Text style={[pub.publishReadyTitle, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Ready to go live.</Text>
            <Text style={[pub.publishStoreName, { color: `${theme.onAccent}CC` }]}>{store?.settings.storeName || 'Your Store'}</Text>
              <Text style={[pub.publishUrl, { color: `${theme.onAccent}B3` }]}>https://{storeUrl}.brandthread.app</Text>
            <PrimaryButton
              label={publishing ? 'Publishing...' : 'Publish Store →'}
              onPress={handlePublish}
              loading={publishing}
              disabled={publishing}
              colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.3)']}
              style={{ marginTop: SP.md }}
            />
          </GradientCard>
        ) : null}

        {/* Unpublish danger zone */}
        {published && (
          <>
            <View style={[pub.divider, { backgroundColor: theme.border }]} />
            <BrandthreadCard style={pub.card}>
              <Text style={pub.dangerTitle}>Unpublish Store</Text>
              <Text style={pub.dangerDesc}>Your store will no longer be visible to buyers.</Text>
              <SecondaryButton label="Unpublish" onPress={handleUnpublish} accent={RED} style={{ marginTop: SP.sm }} />
            </BrandthreadCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makePubStyles(c: { FG: string; MUTED: string; SUCCESS: string; RED: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingBottom: 60, paddingTop: SP.md },
    card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.sm },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
    loadingText: { fontSize: FS.base, fontFamily: FONT.medium, color: c.MUTED },
    validHeader: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm,
      borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.md,
    },
    validHeaderText: { fontSize: FS.base, fontFamily: FONT.semibold, flex: 1 },
    issueSection: { gap: SP.sm, marginTop: SP.sm },
    issueTitle: { fontSize: FS.sm, fontFamily: FONT.bold, color: c.MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
    issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
    issueText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
    revalidateBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', paddingVertical: SP.sm },
    revalidateText: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.MUTED },
    successBlock: { alignItems: 'center', gap: SP.md, padding: SP.md },
    successIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
    successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: c.FG },
    successUrl: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.SUCCESS },
    successActions: { flexDirection: 'row', gap: SP.sm, width: '100%' },
    publishReadyTitle: { fontSize: FS.xl, fontFamily: FONT.bold },
    publishStoreName: { fontSize: FS.base, fontFamily: FONT.semibold, marginTop: 4 },
    publishUrl: { fontSize: FS.sm, fontFamily: FONT.regular },
    divider: { height: 1, marginVertical: SP.md, marginHorizontal: SP.md },
    dangerTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: c.RED },
    dangerDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: c.MUTED },
    shareTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: c.FG },
    shareDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: c.MUTED, lineHeight: 19 },
    shareActions: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.xs },
    revokeBtn: { paddingHorizontal: SP.sm, paddingVertical: SP.sm },
    revokeText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.RED },
  });
}
