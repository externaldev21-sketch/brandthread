import React, { useState, useEffect } from 'react';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import {
  BG, CARD, SURFACE, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { getStorefront, validateStore, publishStore, unpublishStore, StoreValidationResult } from '@/services/storeService';
import { Storefront } from '@/services/storeTypes';

const ERROR_ROUTES: Record<string, string> = {
  'Store name is required.': '/store-settings',
  'Homepage has no sections.': '/store-editor',
  'No store URL configured.': '/store-domain',
  'No logo uploaded.': '/store-editor',
};

export default function StorePublishScreen() {
  const { theme } = useAppTheme();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const headerTopInset = useHeaderTopInset();
  const [store, setStore] = useState<Storefront | null>(null);
  const [validation, setValidation] = useState<StoreValidationResult | null>(null);
  const [validating, setValidating] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const doValidate = async () => {
    setValidating(true);
    try {
      const s = await getStorefront();
      setStore(s);
      setPublished(s.publishStatus === 'published');
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
      <View style={[pub.header, { paddingTop: headerTopInset + SP.sm }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={pub.backBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={pub.headerTitle}>Publish Store</Text>
      </View>

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
                <SecondaryButton label="View Store" onPress={() => Alert.alert('View Store', `Open https://${storeUrl}.brandthread.app in browser.`)} icon="external-link" style={{ flex: 1 }} />
                <PrimaryButton label="Continue Editing" onPress={() => router.back()} style={{ flex: 1 }} />
              </View>
            </View>
          </BrandthreadCard>
        ) : validation?.canPublish ? (
          <GradientCard colors={theme.primaryGradient} style={pub.card} glow>
            <Text style={[pub.publishReadyTitle, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Ready to go live.</Text>
            <Text style={pub.publishStoreName}>{store?.settings.storeName || 'Your Store'}</Text>
              <Text style={pub.publishUrl}>https://{storeUrl}.brandthread.app</Text>
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
            <View style={pub.divider} />
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

const pub = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.sm },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
  loadingText: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  validHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.md,
  },
  validHeaderText: { fontSize: FS.base, fontFamily: FONT.semibold, flex: 1 },
  issueSection: { gap: SP.sm, marginTop: SP.sm },
  issueTitle: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  issueText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  revalidateBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', paddingVertical: SP.sm },
  revalidateText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  successBlock: { alignItems: 'center', gap: SP.md, padding: SP.md },
  successIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  successUrl: { fontSize: FS.sm, fontFamily: FONT.medium, color: SUCCESS },
  successActions: { flexDirection: 'row', gap: SP.sm, width: '100%' },
  publishReadyTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#fff' },
  publishStoreName: { fontSize: FS.base, fontFamily: FONT.semibold, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  publishUrl: { fontSize: FS.sm, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.7)' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: SP.md, marginHorizontal: SP.md },
  dangerTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: RED },
  dangerDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
});
