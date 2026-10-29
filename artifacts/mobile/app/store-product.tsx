/**
 * Store product editor — Stan Store's product editor, three steps:
 *   1. Thumbnail: style (Callout card or Button), image, title, subtitle,
 *      button text, price — how the card looks on the store.
 *   2. Checkout page: image, description, price / discount, what the buyer
 *      fills in; a pre-order's ship-by date and optional cap.
 *   3. Publish.
 * The live preview on top follows every keystroke.
 *
 * Opened with ?id=<block> (edit), or ?new=premade|preorder (a product made
 * right here: it's created on Publish, so leaving early leaves nothing behind).
 * Reference: help.stan.store "Sell a digital download product" (Thumbnail /
 * Checkout Page tabs) and "How to collect information from customers at
 * checkout", reskinned black / white / silver.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ListRow } from '@/components/ui/ListRow';
import { ErrorState } from '@/components/ui/ErrorState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  CHECKOUT_FIELDS, SITE_WIDTH, ScaledPage, StoreBlockCard, StoreCheckoutPreview, StoreSitePreview,
} from '@/components/store/StoreSitePreview';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { ShipDateSheet } from '@/components/store/ShipDateSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreSite, storeSiteViewFromBio } from '@/hooks/useStoreSite';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { pickFromLibrary } from '@/lib/pickProfileImage';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { storeSiteTheme } from '@/lib/storeSiteDesign';
import { FILL_ELEVATED, FONT } from '@/lib/theme';
import {
  BLOCK_LIMITS, KIND_LABEL, blockCard, defaultButtonText, draftCard, draftFromBlock, draftPatch, draftPricing, draftProblems,
  emptyDraft, liveBlocks, priceLabel, shipByLabel, type BlockDraft, type BlockKind, type DraftStep, type StoreBlock,
} from '@/lib/storeBlocks';
import {
  createProductBlock, listBlocks, patchBlock, publishBlock, removeBlock, uploadBlockImage,
} from '@/services/storeBlocksService';

const STEPS: { id: DraftStep; label: string }[] = [
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'checkout', label: 'Checkout page' },
  { id: 'publish', label: 'Publish' },
];
const PREVIEW_H = 232;

export default function StoreProductScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const api = useApi();
  useHideTabBar();
  const insets = useSafeAreaInsets();
  const bottomInset = useScreenBottomInset();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string; new?: string }>();
  const isNew = !params.id;
  const newKind: BlockKind = params.new === 'preorder' ? 'preorder' : 'premade';
  const { page } = useStoreSite();
  const [blocks, setBlocks] = useState<StoreBlock[] | null>(null);
  const [saved, setSaved] = useState<StoreBlock | null>(null);
  const [draft, setDraft] = useState<BlockDraft | null>(isNew ? emptyDraft(newKind) : null);
  const [dirty, setDirty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<DraftStep>('thumbnail');
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [toast, flash] = useToast();

  const load = useCallback(async () => {
    try {
      const all = await listBlocks();
      setBlocks(all);
      if (params.id) {
        const b = all.find((x) => x.id === params.id);
        if (!b) { setFailed(true); return; }
        setSaved(b);
        setDraft((d) => d ?? draftFromBlock(b));
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [params.id]);
  useEffect(() => { void load(); }, [load]);

  const update = useCallback((patch: Partial<BlockDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  }, []);

  // Leaving with unsaved edits asks first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty || busy) return;
    e.preventDefault();
    Alert.alert('Discard changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [busy, dirty, navigation]);

  const problems = useMemo(() => (draft ? draftProblems(draft, { isNew }) : []), [draft, isNew]);
  const errorOf = (field: keyof BlockDraft) => (showErrors ? problems.find((p) => p.field === field)?.message ?? null : null);
  const themeKey = storeSiteTheme(page?.siteTheme ?? page?.theme).key;
  const kind = draft?.kind ?? saved?.kind ?? newKind;
  const soldOut = !!saved && saved.status === 'published' && saved.stock <= 0;

  const pick = useCallback(async (which: 'thumb' | 'checkout') => {
    const asset = await pickFromLibrary([1, 1]);
    if (!asset) return;
    update(which === 'thumb' ? { thumbImage: asset.uri, thumbLocal: true } : { checkoutImage: asset.uri, checkoutLocal: true });
  }, [update]);

  const publish = useCallback(async () => {
    if (!draft || busy) return;
    if (problems.length) {
      setShowErrors(true);
      setStep(problems[0].step);
      return;
    }
    setBusy(true);
    try {
      const thumbRef = draft.thumbLocal && draft.thumbImage ? await uploadBlockImage(api, draft.thumbImage) : undefined;
      const checkoutRef = draft.checkoutLocal && draft.checkoutImage ? await uploadBlockImage(api, draft.checkoutImage) : undefined;
      const { priceCents, compareAtPriceCents } = draftPricing(draft);
      let block = saved;
      if (!block) {
        block = await createProductBlock(api, {
          kind: draft.kind, title: draft.title.trim(), description: draft.description.trim(),
          imagePath: thumbRef ?? null, priceCents: priceCents!, compareAtPriceCents,
          stock: Number(draft.stock) || 0, shipBy: draft.shipBy,
        });
      }
      const patch = draftPatch(draft, block, {
        ...(thumbRef !== undefined ? { thumbImage: thumbRef } : {}),
        ...(checkoutRef !== undefined ? { checkoutImage: checkoutRef } : {}),
      });
      if (Object.keys(patch).length) block = await patchBlock(block.id, patch);
      if (block.status !== 'published') block = await publishBlock(block.id);
      void completeSetupTaskWhen('customize_store', true);
      setDirty(false);
      setSaved(block);
      router.back();
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message.slice(0, 140) : "Couldn't publish. Try again.");
    } finally {
      setBusy(false);
    }
  }, [api, busy, draft, flash, problems, router, saved]);

  const remove = useCallback(() => {
    if (!saved) return;
    Alert.alert('Remove from your store?', 'The product stays in your products.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          void (async () => {
            try { await removeBlock(saved.id); setDirty(false); router.back(); } catch { flash("Couldn't remove it. Try again."); }
          })();
        },
      },
    ]);
  }, [flash, router, saved]);

  const toggleVisible = useCallback(async (visible: boolean) => {
    if (!saved) return;
    try { setSaved(await patchBlock(saved.id, { visible })); } catch { flash("Couldn't save. Try again."); }
  }, [flash, saved]);

  const header = <ScreenHeader title={KIND_LABEL[kind]} backAccessibilityLabel="Back" />;
  if (failed) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={load} /></View>;
  if (!draft) return <View style={[s.root, { backgroundColor: theme.background }]}>{header}</View>;

  const card = draftCard(draft, { soldOut });
  const previewW = width - 32;
  const pageView = page ? storeSiteViewFromBio(page, [
    ...liveBlocks(blocks ?? []).filter((b) => b.id !== saved?.id).map((b) => ({ id: b.id, ...blockCard(b) })),
  ]) : null;
  const pos = saved ? (blocks ?? []).filter((b) => b.status === 'published' && b.visible && b.id !== saved.id && b.position < saved.position).length : null;
  if (pageView) pageView.blocks.splice(pos ?? pageView.blocks.length, 0, { id: 'editing', ...card });
  const pricing = draftPricing(draft);

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.root} testID="store-product-screen">
        {header}
        <View style={s.previewWrap} testID="store-product-preview">
          {step === 'thumbnail' ? (
            <View style={[s.cardStage, { width: previewW, height: PREVIEW_H, backgroundColor: storeSiteTheme(themeKey).bg }]}>
              <View style={{ width: SITE_WIDTH, transform: [{ scale: Math.min(1, (previewW - 24) / (SITE_WIDTH - 32)) }] }}>
                <View style={{ paddingHorizontal: 16 }}><StoreBlockCard card={card} themeKey={themeKey} testID="store-product-card" /></View>
              </View>
            </View>
          ) : (
            <View style={[s.phoneRow, { width: previewW, height: PREVIEW_H }]}>
              <ScaledPage width={Math.round(PREVIEW_H * 0.5)} height={PREVIEW_H} radius={16} themeKey={themeKey}>
                {step === 'checkout' ? (
                  <StoreCheckoutPreview view={{
                    themeKey, kind: draft.kind, title: card.title, image: draft.checkoutImage ?? draft.thumbImage,
                    description: draft.description.trim(), priceLabel: card.priceLabel, compareAtLabel: card.compareAtLabel, shipByLabel: card.shipByLabel,
                  }} />
                ) : pageView ? <StoreSitePreview site={{ ...pageView, themeKey }} /> : null}
              </ScaledPage>
            </View>
          )}
        </View>
        <View style={s.tabs}>
          <SegmentedControl options={STEPS} selectedId={step} onChange={(id) => setStep(id as DraftStep)} variant="underline" testID="store-product-steps" />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.form, { paddingBottom: 96 + bottomInset }]} showsVerticalScrollIndicator={false}>
          {step === 'thumbnail' ? (
            <>
              <SegmentedControl
                options={[{ id: 'callout', label: 'Callout' }, { id: 'button', label: 'Button' }]}
                selectedId={draft.style}
                onChange={(id) => update({ style: id as BlockDraft['style'] })}
                testID="store-product-style"
              />
              <ImageRow label="Image" uri={draft.thumbImage} onPick={() => { void pick('thumb'); }} onClear={draft.thumbImage ? () => update({ thumbImage: null, thumbLocal: true }) : undefined} testID="store-product-thumb" />
              <Input label="Title" value={draft.title} onChangeText={(v) => update({ title: v })} maxLength={BLOCK_LIMITS.title} error={errorOf('title')} testID="store-product-title" />
              {draft.style === 'callout' ? (
                <>
                  <Input label="Subtitle" value={draft.subtitle} onChangeText={(v) => update({ subtitle: v })} maxLength={BLOCK_LIMITS.subtitle} testID="store-product-subtitle" />
                  <Input label={`Button text (${defaultButtonText(draft.kind)})`} value={draft.buttonText} onChangeText={(v) => update({ buttonText: v })} maxLength={BLOCK_LIMITS.buttonText} testID="store-product-button-text" />
                </>
              ) : null}
              <Input label="Price ($)" value={draft.price} onChangeText={(v) => update({ price: v })} keyboardType="decimal-pad" error={errorOf('price')} testID="store-product-price" />
            </>
          ) : step === 'checkout' ? (
            <>
              <ImageRow
                label="Image"
                uri={draft.checkoutImage}
                fallback={draft.thumbImage}
                onPick={() => { void pick('checkout'); }}
                onClear={draft.checkoutImage ? () => update({ checkoutImage: null, checkoutLocal: false }) : undefined}
                testID="store-product-checkout-image"
              />
              <Input label="Description" value={draft.description} onChangeText={(v) => update({ description: v })} multiline maxLength={BLOCK_LIMITS.description} testID="store-product-description" />
              <Input label="Price ($)" value={draft.price} onChangeText={(v) => update({ price: v })} keyboardType="decimal-pad" error={errorOf('price')} testID="store-product-checkout-price" />
              <View style={s.group}>
                <ListRow title="Discount" toggle={{ value: draft.discountOn, onChange: (v) => update({ discountOn: v }) }} testID="store-product-discount" />
              </View>
              {draft.discountOn ? (
                <Input label="Discount price ($)" value={draft.discountPrice} onChangeText={(v) => update({ discountPrice: v })} keyboardType="decimal-pad" error={errorOf('discountPrice')} testID="store-product-discount-price" />
              ) : null}
              {isNew && draft.kind === 'premade' ? (
                <Input label="In stock" value={draft.stock} onChangeText={(v) => update({ stock: v.replace(/\D/g, '') })} keyboardType="number-pad" error={errorOf('stock')} testID="store-product-stock" />
              ) : null}

              {draft.kind === 'preorder' ? (
                <>
                  <Text style={[s.section, { color: theme.text }]}>Pre-order</Text>
                  <View style={s.group}>
                    <ListRow
                      icon="calendar"
                      title="Ships by"
                      value={draft.shipBy ? shipByLabel(draft.shipBy).replace(/^Ships by /, '') : 'Pick a date'}
                      chevron
                      divider
                      onPress={() => setDateOpen(true)}
                      testID="store-product-ship-by"
                    />
                    <ListRow title="Limit pre-orders" toggle={{ value: draft.capOn, onChange: (v) => update({ capOn: v }) }} testID="store-product-cap-toggle" />
                  </View>
                  {errorOf('shipBy') ? <Text style={[s.error, { color: theme.text }]}>{errorOf('shipBy')}</Text> : null}
                  {draft.capOn ? (
                    <Input label="Pre-orders available" value={draft.cap} onChangeText={(v) => update({ cap: v.replace(/\D/g, '') })} keyboardType="number-pad" error={errorOf('cap')} testID="store-product-cap" />
                  ) : null}
                  {saved?.preorderSold != null ? (
                    <Text style={[s.note, { color: theme.muted }]}>
                      {saved.preorderCap != null ? `${saved.preorderSold} of ${saved.preorderCap} pre-ordered` : `${saved.preorderSold} pre-ordered`}
                    </Text>
                  ) : null}
                </>
              ) : null}

              <Text style={[s.section, { color: theme.text }]}>Buyer details</Text>
              <View style={s.group}>
                {CHECKOUT_FIELDS.map((f, i) => (
                  <ListRow key={f} title={f} right={<Icon name="check" size={18} color={theme.text} />} divider={i < CHECKOUT_FIELDS.length - 1} testID={`store-product-field-${i}`} />
                ))}
              </View>
            </>
          ) : (
            <>
              <View style={[s.summary, { backgroundColor: FILL_ELEVATED }]}>
                <SummaryRow label="Type" value={KIND_LABEL[draft.kind]} />
                <SummaryRow label="Price" value={[priceLabel(pricing.priceCents), pricing.compareAtPriceCents ? `was ${priceLabel(pricing.compareAtPriceCents)}` : ''].filter(Boolean).join(' · ') || '—'} />
                {draft.kind === 'preorder' ? <SummaryRow label="Ships by" value={draft.shipBy ? shipByLabel(draft.shipBy).replace(/^Ships by /, '') : '—'} /> : null}
                {draft.kind === 'preorder' && draft.capOn ? <SummaryRow label="Pre-orders available" value={draft.cap || '—'} /> : null}
                {saved && draft.kind === 'premade' ? <SummaryRow label="In stock" value={String(saved.stock)} /> : null}
              </View>
              {showErrors && problems.length ? (
                <View style={s.problems}>
                  {problems.map((p) => (
                    <Pressable key={`${p.step}-${p.field}`} onPress={() => setStep(p.step)} style={s.problem} accessibilityRole="button">
                      <Icon name="alert-circle" size={16} color={theme.text} />
                      <Text style={[s.problemText, { color: theme.text }]}>{p.message}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {saved?.status === 'published' ? (
                <View style={s.group}>
                  <ListRow title="Show on store" toggle={{ value: saved.visible, onChange: (v) => { void toggleVisible(v); } }} divider testID="store-product-visible" />
                  <ListRow title="Remove from store" onPress={remove} testID="store-product-remove" />
                </View>
              ) : saved ? (
                <View style={s.group}>
                  <ListRow title="Remove from store" onPress={remove} testID="store-product-remove" />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.background }]}>
          {step === 'publish' ? (
            <Button
              label={saved?.status === 'published' ? 'Save changes' : 'Publish'}
              onPress={() => { void publish(); }}
              loading={busy}
              fullWidth
              testID="store-product-publish"
            />
          ) : (
            <Button label="Next" onPress={() => setStep(step === 'thumbnail' ? 'checkout' : 'publish')} fullWidth testID="store-product-next" />
          )}
        </View>

        <ShipDateSheet visible={dateOpen} value={draft.shipBy} onPick={(day) => update({ shipBy: day })} onClose={() => setDateOpen(false)} />
        <ShareStoreToast message={toast} top={insets.top + 8} />
      </View>
    </KeyboardAvoidingView>
  );
}

function ImageRow({ label, uri, fallback, onPick, onClear, testID }: {
  label: string;
  uri: string | null;
  fallback?: string | null;
  onPick: () => void;
  onClear?: () => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const shown = uri ?? fallback ?? null;
  return (
    <View style={s.imageRow} testID={testID}>
      {shown
        ? <Image source={{ uri: shown }} style={[s.image, { backgroundColor: FILL_ELEVATED }, !uri && s.faded]} />
        : <View style={[s.image, s.center, { backgroundColor: FILL_ELEVATED }]}><Icon name="image" size={22} color={theme.muted} /></View>}
      <View style={s.imageText}>
        <Text style={[s.imageLabel, { color: theme.text }]}>{label}</Text>
        {!uri && fallback ? <Text style={[s.note, { color: theme.muted }]}>Same as thumbnail</Text> : null}
      </View>
      {onClear ? <Button label="Remove" variant="tertiary" size="small" onPress={onClear} /> : null}
      <Button label={uri ? 'Change' : 'Add'} variant="secondary" size="small" onPress={onPick} testID={testID ? `${testID}-pick` : undefined} />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={s.summaryRow}>
      <Text style={[s.summaryLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[s.summaryValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  previewWrap: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 4 },
  cardStage: { borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  phoneRow: { alignItems: 'center', justifyContent: 'center' },
  tabs: { paddingHorizontal: 16, marginTop: 8 },
  form: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  group: {},
  section: { fontSize: 17, fontFamily: FONT.semibold, marginTop: 12 },
  note: { fontSize: 13 },
  error: { fontSize: 13 },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  image: { width: 56, height: 56, borderRadius: 12 },
  faded: { opacity: 0.6 },
  imageText: { flex: 1, minWidth: 0, gap: 2 },
  imageLabel: { fontSize: 16, fontFamily: FONT.semibold },
  summary: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, gap: 12 },
  summaryLabel: { fontSize: 15 },
  summaryValue: { fontSize: 15, fontFamily: FONT.semibold, flexShrink: 1, textAlign: 'right' },
  problems: { gap: 8 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  problemText: { fontSize: 15 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12 },
});
