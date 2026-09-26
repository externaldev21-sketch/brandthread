/**
 * Brandthread — Meta Ads campaign builder
 * Route: /meta-ads-setup
 *
 * Single scrollable screen (Mobbin-inspired layout, Brandthread's own
 * monochrome components — no visual chrome copied from any other app):
 *   Source → Creative preview → Copy → CTA → Goal → Audience → Budget →
 *   Schedule → Placements → Live preview → sticky Launch button.
 *
 * Accepts optional ?promoteKind=&promoteRefId= (pre-filled from
 * design-campaign.tsx's "Run as a Meta ad" entry point) or ?id= to resume
 * editing an existing draft/rejected campaign.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  PrimaryButton, EmptyState, FormInput, HapticSwitch,
} from '@/components/BrandthreadUI';
import {
  BUDGET_STEPS, BUDGET_MIN_CENTS, BUDGET_MAX_CENTS, formatBudgetCents,
  META_OBJECTIVE_OPTIONS, META_CTA_OPTIONS, formatReachRange,
} from '@/services/metaAdsService';
import { InlineSlider } from '@/components/InlineSlider';
import { buildCanonicalProfileUrl } from '@/lib/shareProfile';
import type {
  MetaAdObjective, MetaAdPromoteKind, MetaCampaign, MetaTargetingResult,
} from '@/lib/api';

let WebViewLazy: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  WebViewLazy = require('react-native-webview').WebView;
} catch { WebViewLazy = null; }

const GENDERS = ['All', 'Men', 'Women'] as const;

export default function MetaAdsSetupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ promoteKind?: string; promoteRefId?: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { theme } = useAppTheme();
  const colors = useColors();

  const [checkingConnection, setCheckingConnection] = useState(true);
  const [connected, setConnected] = useState(true);

  const [campaignId, setCampaignId] = useState<string | null>(params.id ?? null);
  const [loadingExisting, setLoadingExisting] = useState(!!params.id);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  // Source
  const [promoteKind, setPromoteKind] = useState<MetaAdPromoteKind | null>(
    (params.promoteKind as MetaAdPromoteKind) ?? null,
  );
  const [promoteRefId, setPromoteRefId] = useState<string | null>(params.promoteRefId ?? null);
  const [products, setProducts] = useState<Array<{ id: string; name: string; images?: string[] }>>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [videos, setVideos] = useState<Array<{ id: string; mediaUrl: string | null; caption: string | null }>>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [creativeImage, setCreativeImage] = useState<string | null>(null);

  // Copy
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [ctaType, setCtaType] = useState<'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP'>('SHOP_NOW');

  // Goal
  const [objective, setObjective] = useState<MetaAdObjective>('sales');

  // Audience
  const [advantageAudience, setAdvantageAudience] = useState(true);
  const [country, setCountry] = useState('US');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<typeof GENDERS[number]>('All');
  const [interestQuery, setInterestQuery] = useState('');
  const [interestResults, setInterestResults] = useState<MetaTargetingResult[]>([]);
  const [interests, setInterests] = useState<{ id: string; name: string }[]>([]);
  const [searchingInterests, setSearchingInterests] = useState(false);

  // Budget / schedule
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily');
  const [budgetCents, setBudgetCents] = useState(2000);
  const [startNow, setStartNow] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Placements
  const [advantagePlacements, setAdvantagePlacements] = useState(true);
  const [placeFacebook, setPlaceFacebook] = useState(true);
  const [placeInstagram, setPlaceInstagram] = useState(true);

  // Reach / preview / launch
  const [estimatedReach, setEstimatedReach] = useState<{ low: number; high: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── Connection gate ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const conn = await api.metaAds.connection();
        setConnected(!!conn.connected && conn.status === 'connected');
      } catch {
        setConnected(false);
      } finally {
        setCheckingConnection(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resume an existing draft/rejected campaign ──────────────────────────
  useEffect(() => {
    if (!params.id) return;
    (async () => {
      try {
        const { campaign } = await api.metaAds.get(params.id!);
        applyCampaignToState(campaign);
      } catch {
        Alert.alert('Could not load campaign', 'This campaign could not be found.');
      } finally {
        setLoadingExisting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function applyCampaignToState(c: MetaCampaign) {
    setCampaignId(c.id);
    setPromoteKind(c.promoteKind);
    setPromoteRefId(c.promoteRefId);
    setPrimaryText(c.primaryText ?? '');
    setHeadline(c.headline ?? '');
    if (c.ctaType) setCtaType(c.ctaType as any);
    setObjective(c.objective);
    setBudgetType(c.budgetType);
    setBudgetCents(c.budgetCents);
    setAdvantagePlacements(c.advantagePlus);
    if (c.targetingSpec) {
      setAdvantageAudience(false);
      setCountry(c.targetingSpec.countries?.[0] ?? 'US');
      setAgeMin(c.targetingSpec.ageMin ?? 18);
      setAgeMax(c.targetingSpec.ageMax ?? 65);
      setInterests(c.targetingSpec.interests ?? []);
    }
    setRejectionReason(c.rejectionReason);
  }

  // ── Store URL (destination fallback for both product and store) ────────
  useEffect(() => {
    (async () => {
      try {
        const profile = await api.seller.getProfile();
        setStoreUrl(buildCanonicalProfileUrl(profile.username));
        if (promoteKind === 'store' || !creativeImage) {
          setCreativeImage((prev) => prev ?? profile.bannerUrl ?? profile.logoUrl ?? null);
        }
      } catch { /* leave storeUrl null — destinationUrl guard below handles it */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Products (for the "A product" source) ───────────────────────────────
  useEffect(() => {
    if (promoteKind !== 'product' || products.length > 0) return;
    setLoadingProducts(true);
    api.products.list()
      .then((rows: unknown) => setProducts((rows as any[]).map((p: any) => ({ id: p.id, name: p.name, images: p.images }))))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoteKind]);

  // ── Feed videos (for the "A feed video" source) — reuses boosts.targets(),
  // the only existing endpoint that lists a seller's own posted media. ─────
  useEffect(() => {
    if (promoteKind !== 'video' || videos.length > 0) return;
    setLoadingVideos(true);
    api.boosts.targets()
      .then((rows) => setVideos(rows.filter((r) => r.mediaKind === 'video').map((r) => ({ id: r.id, mediaUrl: r.mediaUrl, caption: r.caption }))))
      .catch(() => {})
      .finally(() => setLoadingVideos(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoteKind]);

  // Creative image derives from the selected product/video.
  useEffect(() => {
    if (promoteKind === 'product' && promoteRefId) {
      const p = products.find((x) => x.id === promoteRefId);
      if (p?.images?.[0]) setCreativeImage(p.images[0]);
    } else if (promoteKind === 'video' && promoteRefId) {
      const v = videos.find((x) => x.id === promoteRefId);
      if (v?.mediaUrl) setCreativeImage(v.mediaUrl);
    }
  }, [promoteKind, promoteRefId, products, videos]);

  // ── Destination URL — NOTE: Brandthread has no dedicated public product
  // page route (no app/p/[id] or similar), so every kind falls back to the
  // seller's own store URL. This is a known gap, not an invented route. ────
  const destinationUrl = storeUrl;

  const mediaKind: 'video' | 'photos' = promoteKind === 'video' ? 'video' : 'photos';
  const mediaObjectPaths = useMemo(() => (creativeImage ? [creativeImage] : []), [creativeImage]);

  const requiredValid =
    !!promoteKind && !!destinationUrl && mediaObjectPaths.length > 0 &&
    budgetCents >= BUDGET_MIN_CENTS && !!headline.trim();

  // ── Interest search (debounced) ─────────────────────────────────────────
  const interestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (advantageAudience || interestQuery.trim().length < 2) { setInterestResults([]); return; }
    if (interestDebounce.current) clearTimeout(interestDebounce.current);
    interestDebounce.current = setTimeout(() => {
      setSearchingInterests(true);
      api.metaAds.targetingSearch(interestQuery.trim())
        .then((r) => setInterestResults(r.results))
        .catch(() => setInterestResults([]))
        .finally(() => setSearchingInterests(false));
    }, 400);
    return () => { if (interestDebounce.current) clearTimeout(interestDebounce.current); };
  }, [interestQuery, advantageAudience, api]);

  function buildBody() {
    return {
      promoteKind: promoteKind!,
      promoteRefId: promoteRefId ?? undefined,
      objective,
      primaryText: primaryText || undefined,
      headline: headline || undefined,
      ctaType,
      destinationUrl: destinationUrl!,
      mediaKind,
      mediaObjectPaths,
      budgetType,
      budgetCents,
      startTime: startNow ? undefined : (startDate || undefined),
      endTime: endDate || undefined,
      advantagePlus: advantagePlacements,
      placements: advantagePlacements ? undefined : { facebook: placeFacebook, instagram: placeInstagram },
      targetingSpec: advantageAudience ? undefined : {
        countries: [country || 'US'],
        ageMin, ageMax,
        genders: gender === 'All' ? undefined : [gender],
        interests: interests.length ? interests : undefined,
      },
    };
  }

  // ── Debounced draft save — keeps a live estimated-reach line and a live
  // preview without saving on every keystroke. ────────────────────────────
  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!requiredValid || loadingExisting) return;
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => { void saveDraft(); }, 700);
    return () => { if (saveDebounce.current) clearTimeout(saveDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requiredValid, promoteKind, promoteRefId, objective, primaryText, headline, ctaType,
    destinationUrl, mediaObjectPaths.join('|'), budgetType, budgetCents, startNow, startDate, endDate,
    advantagePlacements, placeFacebook, placeInstagram, advantageAudience, country, ageMin, ageMax, gender,
    interests.map((i) => i.id).join('|'),
  ]);

  async function saveDraft(): Promise<string | null> {
    if (!requiredValid) return null;
    setSaving(true);
    try {
      const body = buildBody();
      if (!campaignId) {
        const res = await api.metaAds.createCampaign(body);
        setCampaignId(res.campaign.id);
        setEstimatedReach(res.estimatedReach);
        void refreshPreview(res.campaign.id);
        return res.campaign.id;
      }
      await api.metaAds.updateCampaign(campaignId, body);
      void refreshPreview(campaignId);
      return campaignId;
    } catch {
      // Silent — this is a background autosave; the Launch button surfaces
      // any real failure with a retry when the seller actually acts.
      return campaignId;
    } finally {
      setSaving(false);
    }
  }

  async function refreshPreview(id: string) {
    try {
      const { previews } = await api.metaAds.preview(id);
      setPreviewHtml(previews[0]?.html ?? null);
    } catch { /* preview is a nice-to-have — never block on it */ }
  }

  async function handleLaunch() {
    setLaunchError(null);
    const id = campaignId ?? await saveDraft();
    if (!id) {
      Alert.alert('Incomplete', 'Fill in a headline, budget, and creative before launching.');
      return;
    }
    setLaunching(true);
    try {
      await api.metaAds.launch(id);
      router.replace('/meta-ads-manage');
    } catch (e: any) {
      const msg = String(e?.message ?? '').replace(/^\d+:\s*/, '') || 'Could not launch this campaign. Please try again.';
      setLaunchError(msg);
      Alert.alert('Launch failed', msg);
    } finally {
      setLaunching(false);
    }
  }

  // ── Gates ─────────────────────────────────────────────────────────────
  if (checkingConnection || loadingExisting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accentLight} size="large" />
      </View>
    );
  }
  if (!connected) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Run a Meta ad" onBack={() => goBackOr(router)} />
        <EmptyState
          icon="link"
          title="Connect Meta first"
          description="Connect your Facebook & Instagram account to build and run a campaign."
          action={{ label: 'Connect Meta', onPress: () => router.replace('/meta-ads-connect') }}
          style={{ marginTop: SP.xl }}
        />
      </BrandthreadScreen>
    );
  }
  if (launching) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: SP.md, padding: SP.xl }}>
        <ActivityIndicator color={theme.accentLight} size="large" />
        <Text style={[s.sectionTitle, { color: colors.foreground, textAlign: 'center' }]}>Creating your campaign on Meta…</Text>
        <Text style={[s.helper, { color: colors.mutedForeground, textAlign: 'center' }]}>This can take a few seconds — don't close this screen.</Text>
      </View>
    );
  }

  const budgetDollars = budgetCents / 100;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <BrandthreadHeader title="Run a Meta ad" onBack={() => goBackOr(router)} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 110, gap: SP.xl }}
      >
        {rejectionReason && (
          <View style={[s.rejectBanner, { backgroundColor: colors.destructive + '14', borderColor: colors.destructive }]}>
            <Feather name="alert-triangle" size={16} color={colors.destructive} />
            <View style={{ flex: 1 }}>
              <Text style={[s.rejectTitle, { color: colors.destructive }]}>Meta rejected this campaign</Text>
              <Text style={[s.helper, { color: colors.mutedForeground }]}>{rejectionReason}</Text>
            </View>
          </View>
        )}

        {/* Source */}
        <Section title="What are you promoting?" colors={colors}>
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            <SourceChip label="A product" active={promoteKind === 'product'} onPress={() => { setPromoteKind('product'); setPromoteRefId(null); }} colors={colors} theme={theme} />
            <SourceChip label="My store" active={promoteKind === 'store'} onPress={() => { setPromoteKind('store'); setPromoteRefId(null); }} colors={colors} theme={theme} />
            <SourceChip label="A feed video" active={promoteKind === 'video'} onPress={() => { setPromoteKind('video'); setPromoteRefId(null); }} colors={colors} theme={theme} />
          </View>

          {promoteKind === 'product' && (
            <View style={{ gap: SP.sm, marginTop: SP.sm }}>
              {loadingProducts ? <ActivityIndicator color={theme.accentLight} /> : products.map((p) => (
                <PickRow key={p.id} label={p.name} selected={promoteRefId === p.id} onPress={() => setPromoteRefId(p.id)} colors={colors} theme={theme} />
              ))}
              {!loadingProducts && products.length === 0 && (
                <Text style={[s.helper, { color: colors.mutedForeground }]}>No products found. Add a product to your store first.</Text>
              )}
            </View>
          )}

          {promoteKind === 'video' && (
            <View style={{ gap: SP.sm, marginTop: SP.sm }}>
              {loadingVideos ? <ActivityIndicator color={theme.accentLight} /> : videos.map((v) => (
                <PickRow key={v.id} label={v.caption || 'Untitled post'} selected={promoteRefId === v.id} onPress={() => setPromoteRefId(v.id)} colors={colors} theme={theme} />
              ))}
              {!loadingVideos && videos.length === 0 && (
                <Text style={[s.helper, { color: colors.mutedForeground }]}>No feed videos found yet. Post a video first.</Text>
              )}
            </View>
          )}
        </Section>

        {/* Creative preview */}
        <Section title="Creative" colors={colors}>
          <View style={[s.creativeBox, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
            {creativeImage ? (
              <Image source={{ uri: creativeImage }} style={s.creativeImg} contentFit="cover" />
            ) : (
              <View style={s.creativeEmpty}>
                <Feather name="image" size={ICON.lg} color={colors.mutedForeground} />
                <Text style={[s.helper, { color: colors.mutedForeground, marginTop: SP.xs }]}>Pick a source above to see your creative</Text>
              </View>
            )}
          </View>
          <FormInput label="Primary text" value={primaryText} onChange={setPrimaryText} placeholder="What do you want people to know?" multiline />
          <FormInput label="Headline" value={headline} onChange={setHeadline} placeholder="Short, punchy headline…" />
        </Section>

        {/* CTA */}
        <Section title="Call to action" colors={colors}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
            {META_CTA_OPTIONS.map((opt) => (
              <Chip key={opt.value} label={opt.label} active={ctaType === opt.value} onPress={() => setCtaType(opt.value)} colors={colors} theme={theme} />
            ))}
          </View>
        </Section>

        {/* Goal */}
        <Section title="Goal" colors={colors}>
          <View style={{ gap: SP.sm }}>
            {META_OBJECTIVE_OPTIONS.map((opt) => (
              <PickRow key={opt.objective} label={opt.label} sub={opt.description} icon={opt.icon} selected={objective === opt.objective} onPress={() => setObjective(opt.objective)} colors={colors} theme={theme} />
            ))}
          </View>
        </Section>

        {/* Audience */}
        <Section title="Audience" colors={colors}>
          <ToggleRow label="Advantage+ Audience (recommended)" value={advantageAudience} onChange={setAdvantageAudience} colors={colors} />
          {!advantageAudience && (
            <View style={{ gap: SP.md, marginTop: SP.sm }}>
              <FormInput label="Country" value={country} onChange={setCountry} placeholder="US" />
              <View style={{ flexDirection: 'row', gap: SP.md }}>
                <Stepper label="Min age" value={ageMin} min={13} max={ageMax} onChange={setAgeMin} colors={colors} theme={theme} />
                <Stepper label="Max age" value={ageMax} min={ageMin} max={65} onChange={setAgeMax} colors={colors} theme={theme} />
              </View>
              <View style={{ flexDirection: 'row', gap: SP.sm }}>
                {GENDERS.map((g) => <Chip key={g} label={g} active={gender === g} onPress={() => setGender(g)} colors={colors} theme={theme} />)}
              </View>
              <FormInput label="Interests" value={interestQuery} onChange={setInterestQuery} placeholder="Search interests…" />
              {searchingInterests && <ActivityIndicator color={theme.accentLight} />}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
                {interestResults.filter((r) => !interests.some((i) => i.id === r.id)).map((r) => (
                  <Chip key={r.id} label={r.name} active={false} onPress={() => { setInterests((prev) => [...prev, { id: r.id, name: r.name }]); setInterestQuery(''); setInterestResults([]); }} colors={colors} theme={theme} />
                ))}
              </View>
              {interests.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
                  {interests.map((i) => (
                    <Chip key={i.id} label={`${i.name} ✕`} active onPress={() => setInterests((prev) => prev.filter((x) => x.id !== i.id))} colors={colors} theme={theme} />
                  ))}
                </View>
              )}
            </View>
          )}
        </Section>

        {/* Budget */}
        <Section title="Budget & duration" colors={colors}>
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            <Chip label="Daily" active={budgetType === 'daily'} onPress={() => setBudgetType('daily')} colors={colors} theme={theme} />
            <Chip label="Lifetime" active={budgetType === 'lifetime'} onPress={() => setBudgetType('lifetime')} colors={colors} theme={theme} />
          </View>
          <View style={{ marginTop: SP.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
              <Text style={[s.helper, { color: colors.subtle }]}>${BUDGET_MIN_CENTS / 100}</Text>
              <Text style={[s.budgetValue, { color: colors.foreground }]}>{formatBudgetCents(budgetCents)}{budgetType === 'daily' ? '/day' : ' total'}</Text>
              <Text style={[s.helper, { color: colors.subtle }]}>${BUDGET_MAX_CENTS / 100}</Text>
            </View>
            <InlineSlider value={budgetCents} min={BUDGET_MIN_CENTS} max={BUDGET_MAX_CENTS} steps={BUDGET_STEPS} onChange={setBudgetCents} accessibilityLabel="Budget" accentColor={theme.accentLight} trackColor={colors.border} />
          </View>
          {estimatedReach && (
            <View style={[s.reachCard, { backgroundColor: colors.success + '14', borderColor: colors.success }]}>
              <Feather name="trending-up" size={16} color={colors.success} />
              <Text style={[s.helper, { color: colors.foreground }]}>Estimated reach: {formatReachRange(estimatedReach.low, estimatedReach.high)}</Text>
            </View>
          )}
        </Section>

        {/* Schedule */}
        <Section title="Schedule" colors={colors}>
          <ToggleRow label="Start now" value={startNow} onChange={setStartNow} colors={colors} />
          {!startNow && <FormInput label="Start date (YYYY-MM-DD)" value={startDate} onChange={setStartDate} placeholder="2026-10-01" />}
          <FormInput label="End date (optional)" value={endDate} onChange={setEndDate} placeholder="YYYY-MM-DD" />
        </Section>

        {/* Placements */}
        <Section title="Placements" colors={colors}>
          <ToggleRow label="Advantage+ Placements (recommended)" value={advantagePlacements} onChange={setAdvantagePlacements} colors={colors} />
          {!advantagePlacements && (
            <View style={{ gap: SP.sm, marginTop: SP.sm }}>
              <ToggleRow label="Facebook" value={placeFacebook} onChange={setPlaceFacebook} colors={colors} />
              <ToggleRow label="Instagram" value={placeInstagram} onChange={setPlaceInstagram} colors={colors} />
            </View>
          )}
        </Section>

        {/* Live preview */}
        <Section title="Preview" colors={colors}>
          {WebViewLazy && previewHtml ? (
            <View style={[s.previewBox, { borderColor: colors.border }]}>
              <WebViewLazy source={{ html: previewHtml }} style={{ flex: 1 }} scalesPageToFit={false} />
            </View>
          ) : (
            <BrandthreadCard>
              <View style={{ flexDirection: 'row', gap: SP.sm, alignItems: 'center' }}>
                <Feather name="eye" size={16} color={colors.mutedForeground} />
                <Text style={[s.helper, { color: colors.mutedForeground, flex: 1 }]}>
                  {saving ? 'Building your preview…' : 'Fill in the sections above to see a live preview here.'}
                </Text>
              </View>
            </BrandthreadCard>
          )}
        </Section>

        {launchError && (
          <View style={[s.rejectBanner, { backgroundColor: colors.destructive + '14', borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[s.helper, { color: colors.destructive, flex: 1 }]}>{launchError}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[s.stickyBottom, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + SP.md }]}>
        <PrimaryButton
          label={`Launch · ${formatBudgetCents(budgetCents)}${budgetType === 'daily' ? '/day' : ''}`}
          icon="zap"
          onPress={handleLaunch}
          disabled={!requiredValid || launching}
          loading={launching}
        />
      </View>
    </View>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <View>
      <Text style={[s.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={[s.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

function SourceChip({ label, active, onPress, colors, theme }: any) {
  return (
    <TouchableOpacity
      style={[s.sourceChip, { backgroundColor: colors.elevated, borderColor: colors.border }, active && { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
    >
      <Text style={[s.sourceChipText, { color: active ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Chip({ label, active, onPress, colors, theme }: any) {
  return (
    <TouchableOpacity
      style={[s.chip, { backgroundColor: colors.elevated, borderColor: colors.border }, active && { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
    >
      <Text style={[s.chipText, { color: active ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PickRow({ label, sub, icon, selected, onPress, colors, theme }: any) {
  return (
    <BrandthreadCard onPress={onPress} style={selected ? { borderColor: theme.accent } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
        {icon && <Feather name={icon} size={ICON.md} color={selected ? theme.accentLight : colors.mutedForeground} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: colors.foreground }]}>{label}</Text>
          {!!sub && <Text style={[s.helper, { color: colors.mutedForeground }]}>{sub}</Text>}
        </View>
        {selected && <Feather name="check" size={16} color={theme.accentLight} />}
      </View>
    </BrandthreadCard>
  );
}

function ToggleRow({ label, value, onChange, colors }: { label: string; value: boolean; onChange: (v: boolean) => void; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={[s.rowLabel, { color: colors.foreground, flex: 1 }]}>{label}</Text>
      <HapticSwitch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function Stepper({ label, value, min, max, onChange, colors, theme }: any) {
  return (
    <View style={{ flex: 1, gap: SP.xs }}>
      <Text style={[s.helper, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[s.stepperRow, { borderColor: colors.border, backgroundColor: colors.elevated }]}>
        <TouchableOpacity onPress={() => onChange(Math.max(min, value - 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="minus" size={14} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.rowLabel, { color: colors.foreground }]}>{value >= 65 ? '65+' : value}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(max, value + 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="plus" size={14} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.bold, marginBottom: SP.sm, letterSpacing: -0.1 },
  sectionCard:  { borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, gap: SP.md },
  helper:       { fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 17 },
  sourceChip:   { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: SP.sm, paddingHorizontal: SP.xs },
  sourceChipText: { fontSize: FS.xs, fontFamily: FONT.semibold, textAlign: 'center' },
  chip:         { borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  chipText:     { fontSize: FS.sm, fontFamily: FONT.semibold },
  rowLabel:     { fontSize: FS.base, fontFamily: FONT.semibold },
  creativeBox:  { width: '100%', aspectRatio: 4 / 5, borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  creativeImg:  { width: '100%', height: '100%' },
  creativeEmpty:{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  reachCard:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.sm, marginTop: SP.sm },
  budgetValue:  { fontSize: FS.base, fontFamily: FONT.bold },
  stepperRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  previewBox:   { width: '100%', height: 420, borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  rejectBanner: { flexDirection: 'row', gap: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, alignItems: 'flex-start' },
  rejectTitle:  { fontSize: FS.sm, fontFamily: FONT.bold, marginBottom: 2 },
  stickyBottom: { borderTopWidth: 1, paddingHorizontal: SP.md, paddingTop: SP.sm },
});
