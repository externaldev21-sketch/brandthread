/**
 * Sell an item / Edit listing.
 *
 * One scrolling form, laid out like Vinted's "Sell an item"
 * (mobbin.com/flows/f6d5c7c8-cc36-4fdb-9896-e6e93476f22e): photos, then
 * Title + Describe your item, then rows that push their own picker screens
 * (Category → Brand → Size → Condition → Colours → Material), Quantity,
 * Price (with the "you'll earn" note), and Shipping. Depop's photo row
 * ("Add photos (Up to 8)" + Edit photos) and its sticky "Save to drafts" /
 * primary button bar (mobbin.com/flows/9f6278f3-41a4-4e03-9e3f-0db7cc5bcac7)
 * sit at the top and bottom. The primary button opens the preview
 * (Vestiaire's "Review before submitting"), where the listing is posted.
 *
 * State lives in lib/listing/listingStore so the pushed pickers (app/listing/*)
 * edit the same listing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { ScreenHeader } from '@/components/ScreenHeader';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { FormRow, GroupNote, LabeledField, ListingBottomBar, SectionGap } from '@/components/listing/ListingRows';
import { PhotoStrip } from '@/components/listing/PhotoStrip';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { leaveSetupFlow } from '@/lib/setupNavigation';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { useFeeSchedule } from '@/hooks/useFeeSchedule';
import { quoteFromSchedule } from '@/lib/feeSchedule';
import { loadDraft, saveDraft } from '@/services/productService';
import {
  emptyListing, getListing, getListingVersion, missingForPublish, photosUploading, resetListing,
  totalQuantity, updateListing, useListing, useListingVersion,
} from '@/lib/listing/listingStore';
import { draftToListing, listingToDraft, productToListing, type ApiProduct } from '@/lib/listing/listingPersistence';
import { pickFromLibrary, removePhoto, takePhoto, uploadListingPhoto } from '@/lib/listing/listingMedia';
import { notify } from '@/lib/listing/notify';
import { conditionLabel, DESCRIPTION_MAX, parcelLabel, TITLE_MAX } from '@/lib/listing/taxonomy';

export default function AddProductScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ editId?: string; from?: string; section?: string }>();
  const api = useApi();
  const form = useListing();
  // Re-render on every edit so the dirty check and row values stay current.
  useListingVersion();
  const schedule = useFeeSchedule();

  const [loading, setLoading] = useState(!!params.editId);
  const [showErrors, setShowErrors] = useState(false);
  /** Opened from Drafts — Depop labels the button "Update draft". */
  const [fromDraft, setFromDraft] = useState(false);
  /** Store version at the last load/save — anything newer is unsaved. */
  const savedVersionRef = useRef(0);
  const exitingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const isEdit = !!form.editProductId;
  const priceCents = parseDecimalToCents(form.priceStr);
  const missing = missingForPublish(form, priceCents);

  // ── Load: fresh form, a saved draft, or a published product to edit ──────
  useEffect(() => {
    const editId = params.editId;
    if (!editId) {
      resetListing(emptyListing());
      savedVersionRef.current = 0;
      return;
    }
    let cancelled = false;
    (async () => {
      const draft = await loadDraft(editId);
      if (draft) {
        if (!cancelled) { resetListing(draftToListing(draft)); setFromDraft(true); }
      } else {
        try {
          const product = await api.products.get(editId) as ApiProduct;
          if (!cancelled) resetListing(productToListing(product));
        } catch {
          if (!cancelled) {
            resetListing(emptyListing());
            notify('Couldn’t load listing', 'Check your connection and try again.');
          }
        }
      }
      if (cancelled) return;
      savedVersionRef.current = getListingVersion();
      setLoading(false);
      if (params.section === 'variants') router.push('/listing/size' as never);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.editId]);

  // ── Leaving with unsaved changes (Depop asks to save a draft) ────────────
  const isDirty = useCallback(() => {
    const f = getListing();
    const touched = f.photos.length > 0 || !!f.title.trim() || !!f.description.trim() || !!f.priceStr;
    return touched && getListingVersion() > savedVersionRef.current;
  }, []);

  const saveToDrafts = useCallback(async () => {
    await saveDraft(listingToDraft(getListing()));
    savedVersionRef.current = getListingVersion();
  }, []);

  const confirmExit = useCallback((onExit: () => void) => {
    const editing = !!getListing().editProductId;
    showActionSheet(
      editing ? 'Discard changes?' : 'Save to drafts?',
      editing ? 'Your changes to this listing won’t be saved.' : 'You can finish this listing later from your drafts.',
      editing
        ? [
          { text: 'Discard changes', style: 'destructive', onPress: onExit },
          { text: 'Keep editing', style: 'cancel' },
        ]
        : [
          { text: 'Save to drafts', onPress: () => { void saveToDrafts().then(onExit); } },
          { text: 'Discard', style: 'destructive', onPress: onExit },
          { text: 'Cancel', style: 'cancel' },
        ],
    );
  }, [saveToDrafts]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (exitingRef.current || !isDirty()) return;
      event.preventDefault();
      confirmExit(() => {
        exitingRef.current = true;
        navigation.dispatch(event.data.action);
      });
    });
    return unsubscribe;
  }, [navigation, isDirty, confirmExit]);

  function leave() {
    exitingRef.current = true;
    leaveSetupFlow(router, params.from);
  }

  function handleClose() {
    if (isDirty()) confirmExit(leave);
    else leave();
  }

  async function handleSaveDraft() {
    await saveToDrafts();
    leave();
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  function addMedia() {
    showActionSheet('Add photos', undefined, [
      { text: 'Choose from library', onPress: () => { void pickFromLibrary(api); } },
      { text: 'Take photo', onPress: () => { void takePhoto(api); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Continue to preview ───────────────────────────────────────────────────
  function handlePreview() {
    if (missing.length) {
      setShowErrors(true);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      const list = missing.join(', ');
      notify('Almost there', `Add ${list.replace(/, ([^,]*)$/, ' and $1')} to continue.`);
      return;
    }
    if (photosUploading(form)) {
      notify('Still uploading', 'Wait for your photos to finish uploading.');
      return;
    }
    if (form.photos.some(p => p.status === 'error')) {
      notify('Photo didn’t upload', 'Tap the photo to retry, or remove it.');
      return;
    }
    router.push('/listing/preview' as never);
  }

  // ── Derived row values ────────────────────────────────────────────────────
  const earnings = schedule && priceCents && priceCents > 0 ? quoteFromSchedule(schedule, priceCents).sellerNetCents : null;
  const sizeValue = form.sizes.length > 3
    ? `${form.sizes.length} sizes`
    : form.sizes.map(sz => sz.size).join(', ');
  const shippingValue = [parcelLabel(form.parcelSize), form.shippingPayer === 'seller' ? 'Free shipping' : undefined]
    .filter(Boolean).join(' · ');
  const err = (key: string) => showErrors && missing.includes(key);
  const multiSize = form.sizes.length > 1;

  return (
    <View style={s.screen} testID="add-product-screen">
      <ScreenHeader
        title={isEdit ? 'Edit listing' : 'Sell an item'}
        onBack={handleClose}
        backAccessibilityLabel="Close"
        backTestID="add-product-close"
        rightElement={isEdit ? undefined : (
          <Pressable
            onPress={() => router.push('/drafts' as never)}
            style={s.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Drafts"
            testID="add-product-drafts"
          >
            <Feather name="folder" size={22} color={theme.text} />
          </Pressable>
        )}
      />

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={s.flex}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {loading ? <View style={s.loading} /> : (
            <>
              <PhotoStrip
                form={form}
                error={err('photos')}
                onAdd={addMedia}
                onRemove={removePhoto}
                onRetry={id => { const p = getListing().photos.find(x => x.id === id); if (p) void uploadListingPhoto(api, p); }}
                onRemoveVideo={() => updateListing({ video: null })}
                onEdit={() => router.push('/listing/photos' as never)}
              />

              <SectionGap />
              <LabeledField
                label="Title"
                error={err('title')}
                value={form.title}
                onChangeText={title => updateListing({ title })}
                placeholder="e.g. White cotton boxy tee"
                maxLength={TITLE_MAX}
                returnKeyType="next"
                testID="add-product-title"
              />
              <LabeledField
                label="Describe your item"
                value={form.description}
                onChangeText={description => updateListing({ description })}
                placeholder="e.g. only worn a few times, true to size"
                multiline
                maxLength={DESCRIPTION_MAX}
                counter={form.description.length > DESCRIPTION_MAX * 0.8 ? `${form.description.length}/${DESCRIPTION_MAX}` : undefined}
                last
                testID="add-product-description"
              />

              <SectionGap />
              <FormRow label="Category" value={form.subcategory} error={err('category')} onPress={() => router.push('/listing/category' as never)} testID="add-product-category" />
              <FormRow label="Brand" value={form.brand} onPress={() => router.push('/listing/brand' as never)} testID="add-product-brand" />
              <FormRow label="Size" value={sizeValue} onPress={() => router.push('/listing/size' as never)} testID="add-product-size" />
              {form.editProductId ? <FormRow label="Edit size chart table" onPress={() => router.push({ pathname: '/product-size-chart', params: { productId: form.editProductId! } } as never)} testID="add-product-size-chart" /> : null}
              <FormRow label="Condition" value={conditionLabel(form.condition)} error={err('condition')} onPress={() => router.push('/listing/condition' as never)} testID="add-product-condition" />
              <FormRow label="Colours" value={form.colors.join(', ')} onPress={() => router.push('/listing/colors' as never)} testID="add-product-colors" />
              <FormRow label="Material (recommended)" value={form.material} onPress={() => router.push('/listing/material' as never)} testID="add-product-material" />
              {multiSize ? (
                <FormRow label="Quantity" value={`${totalQuantity(form)} across ${form.sizes.length} sizes`} onPress={() => router.push('/listing/size' as never)} last testID="add-product-quantity" />
              ) : (
                <View style={s.qtyRow}>
                  <Text style={s.qtyLabel}>Quantity</Text>
                  <TextInput
                    value={String(form.quantity)}
                    onChangeText={t => {
                      const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                      updateListing({ quantity: Number.isFinite(n) ? Math.min(n, 9999) : 0 });
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    style={s.qtyInput}
                    selectionColor={theme.text}
                    accessibilityLabel="Quantity"
                    testID="add-product-quantity"
                  />
                </View>
              )}

              <SectionGap />
              <LabeledField label="Numbered run" value={form.editionSize == null ? '' : String(form.editionSize)} placeholder="Optional total pieces" keyboardType="number-pad" maxLength={7} onChangeText={text => updateListing({ editionSize: text.replace(/\D/g, '') ? Number(text.replace(/\D/g, '')) : null })} testID="add-product-edition-size" />
              <FormRow
                label="Price"
                value={priceCents ? formatCents(priceCents) : undefined}
                error={err('price')}
                onPress={() => router.push('/listing/price' as never)}
                last
                testID="add-product-price"
              />
              {earnings !== null ? (
                <GroupNote>{`You’ll earn ${formatCents(earnings)} after fees.`}</GroupNote>
              ) : <SectionGap />}

              <FormRow label="Shipping" value={shippingValue} placeholder="Parcel size" onPress={() => router.push('/listing/shipping' as never)} last testID="add-product-shipping" />
              <GroupNote>
                {form.shippingPayer === 'seller'
                  ? 'You’re offering free shipping. The label cost comes out of your earnings.'
                  : 'The buyer always pays for shipping.'}
              </GroupNote>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ListingBottomBar
        secondaryLabel={isEdit ? undefined : fromDraft ? 'Update draft' : 'Save to drafts'}
        onSecondary={isEdit ? undefined : () => { void handleSaveDraft(); }}
        secondaryTestID="add-product-save-draft"
        primaryLabel={isEdit ? 'Review changes' : 'Preview'}
        onPrimary={handlePreview}
        primaryTestID="add-product-preview"
      />
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    flex: { flex: 1 },
    content: { paddingBottom: SP.xl },
    loading: { height: 400 },
    headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    qtyRow: {
      minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: SP.md, backgroundColor: t.background,
    },
    qtyLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: t.text },
    qtyInput: { minWidth: 64, textAlign: 'right', fontSize: FS.base, fontFamily: FONT.regular, color: t.text, paddingVertical: SP.sm },
  });
}
