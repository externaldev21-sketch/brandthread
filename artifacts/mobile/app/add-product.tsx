/**
 * Add Product — single-scroll product creation
 *
 * Essential sections (always open): Photos, Basic Information, Pricing, Inventory
 * Advanced sections (collapsible):  Variants, Sales Model
 *
 * Seller can fill photo + title + price + stock and publish without clicking
 * through wizard steps.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, TextInput, KeyboardAvoidingView, Platform, Switch, Image, LayoutAnimation, UIManager, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';

import { FONT, FS, SP, RADIUS, COMP, ICON, ANIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { RADII } from '@/constants/radii';
import { TYPE_SCALE } from '@/constants/typography';
import { hapticPrimaryAction, hapticToggle, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';

import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, FilterChip, StatusBadge, SectionHeader, FormInput, ProgressCard, EmptyState } from '@/components/BrandthreadUI';

import { getProduct, saveDraft, loadDraft, deleteDraft, getCollections } from '@/services/productService';
import { useApi } from '@/hooks/useApi';

import { Product, ProductDraft, ProductCategory, PRODUCT_CATEGORIES, SIZE_PRESETS, COLOR_PRESETS, SalesModel, OptionType, ProductOption, OptionValue, ProductVariant, ProductMedia, ProductCollection } from '@/services/productTypes';

import { calcPricing, generateVariantCombinations, buildVariantTitle, validateForPublish, applyBulkEditToVariants } from '@/lib/productUtils';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { validatePhotosStep, validateDetailsStep, validatePricingStep, validateVariantsStep, validateListingForPublish } from '@/lib/listingValidation';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Section titles (kept for reference / draft compatibility) ────────────────

const STEP_TITLES = [
  'Basic Information',
  'Media',
  'Pricing',
  'Variants',
  'Inventory',
  'Sales Model',
  'Fulfillment',
  'Manufacturing',
  'Storefront',
  'Review & Publish',
];

// ─── Stepper (the flow sellers actually navigate) ──────────────────────────
// Six steps per the fast-listing flow spec. Advanced fields (manufacturing,
// storefront/SEO) live as collapsible "Advanced" blocks inside the closest
// relevant step so nothing from the original single-scroll form is lost.

type FlowStep = 'photos' | 'details' | 'variants' | 'pricing' | 'shipping' | 'review';

const FLOW_STEPS: { key: FlowStep; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'photos',   label: 'Photos',   icon: 'camera' },
  { key: 'details',  label: 'Details',  icon: 'file-text' },
  { key: 'variants', label: 'Variants', icon: 'layers' },
  { key: 'pricing',  label: 'Pricing',  icon: 'dollar-sign' },
  { key: 'shipping', label: 'Shipping', icon: 'truck' },
  { key: 'review',   label: 'Review',   icon: 'check-circle' },
];

// ─── Collapsible section component ──────────────────────────────────────────

interface CollapsibleSectionProps {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  hint?: string;   // shown in the header when collapsed
}

function CollapsibleSection({ title, icon, expanded, onToggle, children, hint }: CollapsibleSectionProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const MUTED = theme.muted;
  return (
    <View style={s.collapsibleBlock}>
      <TouchableOpacity style={s.collapsibleHeader} onPress={onToggle} activeOpacity={0.75}>
        <View style={s.collapsibleHeaderLeft}>
          <View style={[s.collapsibleIconWrap, { backgroundColor: theme.accentDim }]}>
            <Feather name={icon} size={15} color={theme.accentLight} />
          </View>
          <View style={{ gap: 1 }}>
            <Text style={s.collapsibleTitle}>{title}</Text>
            {!expanded && hint ? <Text style={s.collapsibleHint}>{hint}</Text> : null}
          </View>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
      </TouchableOpacity>
      {expanded && (
        <View style={s.collapsibleBody}>
          {children}
        </View>
      )}
    </View>
  );
}

// ─── Local state interfaces ───────────────────────────────────────────────

interface LocalOption {
  id: string;
  type: OptionType;
  name: string;
  values: { id: string; value: string; colorHex?: string }[];
  customInput: string;
}

interface LocalVariant {
  id: string;
  title: string;
  optionValues: { optionId: string; valueId: string }[];
  sku: string;
  price: string;
  qty: string;
}

function uid() { return Math.random().toString(36).slice(2, 11); }
function centsToInput(cents: number | undefined): string {
  if (cents === undefined) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// ─── Screen ─────────────────────────────────────────────────────────

export default function AddProductScreen() {
  const { theme } = useAppTheme();
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
    onAccent: ON_DARK,
  } = theme;
  const BORDER_ACTIVE = theme.accentLight;
  const BLUE = theme.accentLight;
  const GOLD = theme.accent;
  const GRAD_CARD_GLOW = theme.glowGradient;
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [draftData, setDraftData] = useState<Partial<Product>>({
    name: '',
    description: '',
    tags: [],
    styleTags: [],
    media: [],
    pricing: { priceCents: 0, currency: 'USD' },
    options: [],
    variants: [],
    inventory: {
      productId: '',
      trackQuantity: true,
      allowOverselling: false,
      policy: 'deny',
      lowStockThreshold: 5,
      totalStock: 0,
      availableStock: 0,
      reservedStock: 0,
      incomingStock: 0,
      locationStock: [],
      variantStock: [],
    },
    salesModel: params.intent === 'drop' ? 'pre-order' : 'pre-made',
    preorderSettings: {
      unitsOrdered: 0,
      isFunded: false,
    },
    fulfillment: { type: 'seller' },
    manufacturing: { stage: 'none' },
    storeSettings: {
      status: 'draft',
      collectionIds: [],
      featuredOnHomepage: false,
      relatedProductIds: [],
      seo: { searchVisible: true },
    },
  });

  // ── Field state ──
  const [tagsInput, setTagsInput] = useState('');
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [compareAtStr, setCompareAtStr] = useState('');
  const [costStr, setCostStr] = useState('');
  const [shippingStr, setShippingStr] = useState('');
  const [feesStr, setFeesStr] = useState('');
  const [localOptions, setLocalOptions] = useState<LocalOption[]>([]);
  const [localVariants, setLocalVariants] = useState<LocalVariant[]>([]);
  const [trackInventory, setTrackInventory] = useState(true);
  const [allowOversell, setAllowOversell] = useState(false);
  const [stockStr, setStockStr] = useState('');
  const [lowStockStr, setLowStockStr] = useState('5');
  const [variantQtys, setVariantQtys] = useState<Record<string, string>>({});
  const [mfgMode, setMfgMode] = useState<'none' | 'existing' | 'quote'>('none');
  const [mfgName, setMfgName] = useState('');
  const [targetCost, setTargetCost] = useState('');
  const [reqQty, setReqQty] = useState('');
  const [prodDeadline, setProdDeadline] = useState('');
  const [featuredHome, setFeaturedHome] = useState(false);
  const [dismissedTips, setDismissedTips] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [mediaUpload, setMediaUpload] = useState<Record<string, { status: 'uploading' | 'done' | 'error'; remoteUri?: string }>>({});
  const photosUploading = Object.values(mediaUpload).some(u => u.status === 'uploading');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [collections, setCollections] = useState<ProductCollection[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // ── Stepper state ──
  const [stepIndex, setStepIndex] = useState(0);
  const currentStepKey = FLOW_STEPS[stepIndex].key;
  const [stepAttempted, setStepAttempted] = useState<Record<FlowStep, boolean>>({
    photos: false, details: false, variants: false, pricing: false, shipping: false, review: false,
  });

  // ── Pre-order (Pricing & Stock step) ──
  const [isPreOrder, setIsPreOrder] = useState(false);

  // ── Variants: bulk-edit selection ──
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkQty, setBulkQty] = useState('');

  // ── Photos: background removal per image ──
  const [bgRemovalState, setBgRemovalState] = useState<Record<string, 'processing' | 'done' | 'failed'>>({});

  // ── Collapsible section state — advanced sections start closed ──
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    variants:      false,
    salesModel:    false,
    fulfillment:   false,
    manufacturing: false,
    storefront:    false,
  });

  const draftId = useRef('draft_' + uid());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const changeVersionRef = useRef(0);
  const latestDraftSnapshotRef = useRef<ProductDraft | null>(null);
  const isExitingRef = useRef(false);

  function markUnsavedChanges() {
    changeVersionRef.current += 1;
    hasUnsavedChangesRef.current = true;
    setHasUnsavedChanges(true);
  }

  function updateUnsavedState<T>(
    setter: React.Dispatch<React.SetStateAction<T>>,
    value: React.SetStateAction<T>,
  ) {
    markUnsavedChanges();
    setter(value);
  }

  function toggleSection(key: string) {
    hapticToggle();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ── Restore helper ──
  function restoreFormState(source: Partial<Product>) {
    if (source.pricing) {
      setPriceStr(centsToInput(source.pricing.priceCents));
      setCompareAtStr(centsToInput(source.pricing.compareAtPriceCents));
      setCostStr(centsToInput(source.pricing.costCents));
      setShippingStr(centsToInput(source.pricing.estimatedShippingCostCents));
      setFeesStr(centsToInput(source.pricing.estimatedFeesCents));
    }
    if (source.tags) setTagsInput(source.tags.join(', '));
    if (source.storeSettings?.featuredOnHomepage) setFeaturedHome(source.storeSettings.featuredOnHomepage);
    if (source.inventory) {
      setTrackInventory(source.inventory.trackQuantity ?? true);
      setAllowOversell(source.inventory.allowOverselling ?? false);
      setStockStr(source.inventory.totalStock?.toString() ?? '');
      setLowStockStr(source.inventory.lowStockThreshold?.toString() ?? '5');
    }
    if (source.options?.length) {
      setLocalOptions(source.options.map(o => ({
        id: o.id,
        type: o.type,
        name: o.name,
        values: o.values.map(v => ({ id: v.id, value: v.value, colorHex: v.colorHex })),
        customInput: '',
      })));
    }
    if (source.variants?.length) {
      setLocalVariants(source.variants.map(v => ({
        id: v.id,
        title: v.title,
        optionValues: v.optionValues,
        sku: v.sku ?? '',
        price: centsToInput(v.priceCents),
        qty: v.inventoryQuantity.toString(),
      })));
      const qtys: Record<string, string> = {};
      source.variants.forEach(v => { qtys[v.id] = v.inventoryQuantity.toString(); });
      setVariantQtys(qtys);
    }
    if (source.salesModel) {
      setIsPreOrder(source.salesModel === 'pre-order' || source.salesModel === 'both');
    }
    if (source.manufacturing) {
      if (source.manufacturing.manufacturerName) {
        setMfgMode('existing');
        setMfgName(source.manufacturing.manufacturerName);
      }
      setTargetCost(centsToInput(source.manufacturing.targetCostPerUnitCents));
      setReqQty(source.manufacturing.requiredQuantity?.toString() ?? '');
      setProdDeadline(source.manufacturing.productionDeadline ?? '');
    }
  }

  // ── Draft / edit load on mount ──
  useEffect(() => {
    const editId = params.editId as string | undefined;
    if (!editId) return;

    async function loadForEdit() {
      const draft = await loadDraft(editId!);
      if (draft) {
        setDraftData(draft as Partial<Product>);
        restoreFormState(draft);
        draftId.current = editId!;
        return;
      }
      const product = await getProduct(editId!);
      if (product) {
        setIsEditMode(true);
        setEditProductId(editId!);
        setDraftData(product as Partial<Product>);
        restoreFormState(product);
        draftId.current = 'edit_' + editId!;
      }
    }
    loadForEdit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load collections ──
  useEffect(() => {
    getCollections().then(cols => setCollections(cols)).catch(() => {});
  }, []);

  // ── Auto-save draft ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const saveVersion = changeVersionRef.current;
      saveDraft(buildDraftSnapshot()).then(() => {
        if (changeVersionRef.current === saveVersion) {
          hasUnsavedChangesRef.current = false;
          setHasUnsavedChanges(false);
        }
      });
    }, 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [
    draftData, localOptions, localVariants, variantQtys,
    priceStr, compareAtStr, costStr, shippingStr, feesStr,
    trackInventory, allowOversell, stockStr, lowStockStr,
    mfgMode, mfgName, targetCost, reqQty, prodDeadline, isPreOrder,
  ]);

  // Intercept native back gestures/buttons so the same protection applies
  // when the seller leaves without tapping the header close button.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (!hasUnsavedChangesRef.current || isExitingRef.current) return;

      event.preventDefault();
      showExitAlert(() => {
        isExitingRef.current = true;
        navigation.dispatch(event.data.action);
      });
    });
    return unsubscribe;
    // The refs keep the listener current without re-registering on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // ── Helpers ──
  function patchDraft(patch: Partial<Product>) {
    markUnsavedChanges();
    setDraftData(prev => ({ ...prev, ...patch }));
  }

  function buildDraftSnapshot(): ProductDraft {
    const productOptions: ProductOption[] = localOptions.map((o, i) => ({
      id: o.id, type: o.type, name: o.name, values: o.values, sortOrder: i,
    }));
    const productVariants: ProductVariant[] = localVariants.map(v => ({
      id: v.id, productId: '',
      title: v.title, optionValues: v.optionValues,
       sku: v.sku, priceCents: parseDecimalToCents(v.price) ?? undefined,
      inventoryQuantity: parseInt(variantQtys[v.id] ?? v.qty) || 0,
      reservedQuantity: 0, incomingQuantity: 0,
      status: 'active' as const,
      requiresShipping: true, taxable: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    return {
      ...draftData,
      options: productOptions,
      variants: productVariants,
      pricing: {
        ...(draftData.pricing ?? { currency: 'USD' }),
        priceCents: parseDecimalToCents(priceStr) ?? 0,
        compareAtPriceCents: parseDecimalToCents(compareAtStr) ?? undefined,
        costCents: parseDecimalToCents(costStr) ?? undefined,
        estimatedShippingCostCents: parseDecimalToCents(shippingStr) ?? 0,
        estimatedFeesCents: parseDecimalToCents(feesStr) ?? 0,
        currency: 'USD',
      },
      inventory: {
        ...(draftData.inventory ?? {
          productId: '', policy: 'deny', reservedStock: 0, incomingStock: 0,
          locationStock: [], variantStock: [],
        }),
        trackQuantity: trackInventory,
        allowOverselling: allowOversell,
        policy: allowOversell ? 'continue' : 'deny',
        lowStockThreshold: parseInt(lowStockStr) || 5,
        totalStock: parseInt(stockStr) || 0,
        availableStock: parseInt(stockStr) || 0,
      },
      manufacturing: {
        ...(draftData.manufacturing ?? {}),
        stage: mfgMode === 'quote' ? 'quote_requested' : 'none',
        manufacturerName: mfgName || undefined,
        targetCostPerUnitCents: parseDecimalToCents(targetCost) ?? undefined,
        requiredQuantity: parseInt(reqQty) || undefined,
        productionDeadline: prodDeadline || undefined,
      },
      id: draftId.current,
      isDraft: true,
      currentStep: 1,
      lastSavedAt: new Date().toISOString(),
    };
  }

  latestDraftSnapshotRef.current = buildDraftSnapshot();

  async function saveDraftAndClear(snapshot: ProductDraft) {
    const saveVersion = changeVersionRef.current;
    await saveDraft(snapshot);
    if (changeVersionRef.current === saveVersion) {
      hasUnsavedChangesRef.current = false;
      setHasUnsavedChanges(false);
    }
  }

  function showExitAlert(onExit: () => void) {
    Alert.alert(
      'Exit product creation?',
      'You have unsaved changes — save as draft?',
      [
        {
          text: 'Save draft',
          onPress: async () => {
            await saveDraftAndClear(latestDraftSnapshotRef.current ?? buildDraftSnapshot());
            onExit();
          },
        },
        { text: 'Discard', style: 'destructive', onPress: onExit },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  function leaveProductFlow() {
    isExitingRef.current = true;
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  function handleExit() {
    if (!hasUnsavedChanges) {
      leaveProductFlow();
      return;
    }
    showExitAlert(leaveProductFlow);
  }

  async function handleSaveDraftAndExit() {
    await saveDraftAndClear(buildDraftSnapshot());
    Alert.alert('Draft saved', 'You can continue editing later.');
    leaveProductFlow();
  }

  async function handleSaveDraftInPlace() {
    await saveDraftAndClear(buildDraftSnapshot());
    Alert.alert('Draft saved', 'Your progress has been saved.');
  }

  // ── Pricing helpers ──
  function getPricing() {
    return calcPricing({
       priceCents: parseDecimalToCents(priceStr) ?? 0,
       compareAtPriceCents: parseDecimalToCents(compareAtStr) ?? undefined,
       costCents: parseDecimalToCents(costStr) ?? undefined,
       estimatedShippingCostCents: parseDecimalToCents(shippingStr) ?? 0,
       estimatedFeesCents: parseDecimalToCents(feesStr) ?? 0,
      currency: 'USD',
    });
  }

  // ── Variant generation ──
  function generateVariants() {
    if (localOptions.length === 0) {
      Alert.alert('No options', 'Add at least one option with values first.');
      return;
    }
    const opts = localOptions.map(o => ({ id: o.id, name: o.name, values: o.values }));
    const combos = generateVariantCombinations(opts);
    const variants: LocalVariant[] = combos.map(combo => ({
      id: uid(),
      title: buildVariantTitle(combo.map(c => c.value)),
      optionValues: combo.map(c => ({ optionId: c.optionId, valueId: c.valueId })),
      sku: '', price: '', qty: '',
    }));
    updateUnsavedState(setLocalVariants, variants);
    hapticSuccessAction();
  }

  // ── Publish ──
  async function handlePublish() {
    if (photosUploading) {
      Alert.alert('Still uploading', 'Wait for your photos to finish uploading before publishing.');
      return;
    }
    const decimalFields: Array<[string, string]> = [
      ['Price', priceStr],
      ['Compare-at price', compareAtStr],
      ['Cost', costStr],
      ['Shipping cost', shippingStr],
      ['Fees', feesStr],
      ['Target unit cost', targetCost],
      ...localVariants.map((variant) => [`Price for ${variant.title || 'variant'}`, variant.price] as [string, string]),
    ];
    const invalidField = decimalFields.find(([, value]) => value.trim() !== '' && parseDecimalToCents(value) === null);
    if (invalidField) {
      Alert.alert('Invalid price', `${invalidField[0]} must be a non-negative amount with up to two decimal places.`);
      return;
    }

    const pricing = {
      priceCents: parseDecimalToCents(priceStr) ?? 0,
      compareAtPriceCents: parseDecimalToCents(compareAtStr) ?? undefined,
      costCents: parseDecimalToCents(costStr) ?? undefined,
      estimatedShippingCostCents: parseDecimalToCents(shippingStr) ?? 0,
      estimatedFeesCents: parseDecimalToCents(feesStr) ?? 0,
      currency: 'USD',
    };
    const productOptions: ProductOption[] = localOptions.map((o, i) => ({
      id: o.id, type: o.type, name: o.name,
      values: o.values.map(v => ({ id: v.id, value: v.value, colorHex: v.colorHex })),
      sortOrder: i,
    }));
    const productVariants: ProductVariant[] = localVariants.map(v => ({
      id: v.id, productId: '',
      title: v.title, optionValues: v.optionValues,
      sku: v.sku, priceCents: parseDecimalToCents(v.price) ?? undefined,
      inventoryQuantity: parseInt(variantQtys[v.id] || v.qty) || 0,
      reservedQuantity: 0, incomingQuantity: 0,
      status: 'active' as const,
      requiresShipping: true, taxable: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    const forValidation = {
      name: draftData.name ?? '',
      description: draftData.description ?? '',
      pricing,
      media: draftData.media ?? [],
      variants: productVariants,
    };
    const warnings = validateForPublish(forValidation);
    if (warnings.length > 0) {
      Alert.alert(
        'Cannot publish',
        'Please fix the following:\n\n' + warnings.map(w => '• ' + w).join('\n'),
        [{ text: 'OK' }]
      );
      return;
    }

    if (publishing) return;
    setPublishing(true);

    const retailPriceCents = parseDecimalToCents(priceStr);
    if (retailPriceCents === null || retailPriceCents <= 0) {
      Alert.alert('Invalid price', 'Enter a valid price with up to two decimal places.');
      setPublishing(false);
      return;
    }
    const compareAtCents = compareAtStr ? parseDecimalToCents(compareAtStr) : undefined;
    if (compareAtStr && (compareAtCents === null || compareAtCents === undefined || compareAtCents <= retailPriceCents)) {
      Alert.alert('Compare-at price', 'Compare-at price should be higher than the retail price.');
      setPublishing(false);
      return;
    }

    const ps = draftData.preorderSettings;
    const salesModel = draftData.salesModel;
    if ((salesModel === 'pre-order' || salesModel === 'both') && ps && ps.openDate && ps.closeDate && ps.closeDate <= ps.openDate) {
      Alert.alert('Invalid dates', 'Pre-order close date must be after the open date.');
      setPublishing(false);
      return;
    }

    const skus = productVariants.map(v => v.sku).filter(Boolean);
    const uniqueSkus = new Set(skus);
    if (skus.length !== uniqueSkus.size) {
      Alert.alert('Duplicate SKU', 'Each variant must have a unique SKU.');
      setPublishing(false);
      return;
    }

    const totalStock = productVariants.reduce((sum, v) => sum + v.inventoryQuantity, 0);

    const productPayload: Partial<Product> = {
      ...draftData,
      pricing,
      options: productOptions,
      variants: productVariants,
      status: 'active',
      inventory: {
        ...(draftData.inventory ?? { productId: '', trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 5, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [] }),
        productId: isEditMode && editProductId ? editProductId : '',
        totalStock,
        availableStock: totalStock,
        trackQuantity: trackInventory,
        allowOverselling: allowOversell,
        policy: allowOversell ? 'continue' : 'deny',
        lowStockThreshold: parseInt(lowStockStr) || 5,
      },
      storeSettings: {
        ...(draftData.storeSettings ?? { collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } }),
        status: 'active',
        featuredOnHomepage: featuredHome,
      },
      manufacturing: {
        stage: mfgMode === 'quote' ? 'quote_requested' : 'none',
        manufacturerName: mfgName || undefined,
        targetCostPerUnitCents: parseDecimalToCents(targetCost) ?? undefined,
        requiredQuantity: parseInt(reqQty) || undefined,
        productionDeadline: prodDeadline || undefined,
      },
    };

    const productVariantsForServer = (productPayload.variants ?? []).map((v: any) => ({
      size:              v.size,
      color:             v.color,
      sku:               v.sku || ((productPayload.name ?? 'SKU').replace(/\s+/g, '-').toUpperCase() + '-' + (v.id ?? 'DEFAULT')),
       priceCents:        (v.priceCents ?? productPayload.pricing?.priceCents ?? 0) as number,
      stock:             typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : 0,
      lowStockThreshold: (productPayload.inventory as any)?.lowStockThreshold ?? 10,
    })).filter((v: any) => v.priceCents > 0);

    const serverCreatePayload = {
      name:        productPayload.name ?? '',
      description: productPayload.description,
      category:    typeof productPayload.category === 'string' ? productPayload.category : 'apparel',
      status:      'active',
      images:      (productPayload.media ?? []).map((m: any) => m.uri ?? m.url ?? '').filter(Boolean),
      tags:        productPayload.tags ?? [],
      styleTags:   productPayload.styleTags ?? [],
      variants:    productVariantsForServer,
      isPreOrder,
      preOrderClosingDate:  isPreOrder ? (productPayload.preorderSettings?.closeDate ?? undefined) : undefined,
      preOrderEstShipDate:  isPreOrder ? (productPayload.preorderSettings?.estimatedShippingDate ?? undefined) : undefined,
    };

    const serverUpdatePayload = {
      name:        productPayload.name,
      description: productPayload.description,
      category:    typeof productPayload.category === 'string' ? productPayload.category : undefined,
      status:      'active',
      images:      (productPayload.media ?? []).map((m: any) => m.uri ?? m.url ?? '').filter(Boolean),
      tags:        productPayload.tags ?? [],
      styleTags:   productPayload.styleTags ?? [],
      isPreOrder,
      preOrderClosingDate:  isPreOrder ? (productPayload.preorderSettings?.closeDate ?? undefined) : undefined,
      preOrderEstShipDate:  isPreOrder ? (productPayload.preorderSettings?.estimatedShippingDate ?? undefined) : undefined,
    };

    try {
      const name = draftData.name ?? 'Product';
      if (isEditMode && editProductId) {
        await api.products.update(editProductId, serverUpdatePayload);
        await deleteDraft(draftId.current);
        Alert.alert('Product updated!', name + ' has been updated.', [
          { text: 'View product', onPress: () => router.replace('/product-detail?id=' + editProductId as never) },
          { text: 'Done', onPress: leaveProductFlow },
        ]);
      } else {
        const newProduct = await completeSetupTaskAfter(
          'first_product',
          () => api.products.create(serverCreatePayload),
        ) as any;
        await deleteDraft(draftId.current);
        Alert.alert('Product published!', name + ' is now live.', [
          { text: 'View product', onPress: () => router.replace('/product-detail?id=' + newProduct.id as never) },
          { text: 'Done', onPress: leaveProductFlow },
        ]);
      }
    } catch {
      Alert.alert('Error', 'Could not publish. Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  // ─── Section renderers ────────────────────────────────────────────
  // Each is identical to the original step render, just without the outer
  // <View style={s.stepContent}> wrapper (sections provide their own padding).

  // Uploads a locally-picked photo, tracking per-item status so the thumbnail
  // can show a progress overlay and Publish can be blocked until it's done.
  async function uploadMediaAsset(item: ProductMedia) {
    setMediaUpload(prev => ({ ...prev, [item.id]: { status: 'uploading' } }));
    try {
      const uploaded = await api.products.uploadImage({ uri: item.uri });
      const remoteUri = (uploaded as any)?.objectPath || (uploaded as any)?.url || item.uri;
      setMediaUpload(prev => ({ ...prev, [item.id]: { status: 'done', remoteUri } }));
      setDraftData(prev => ({ ...prev, media: (prev.media ?? []).map(m => m.id === item.id ? { ...m, uri: remoteUri } : m) }));
    } catch {
      setMediaUpload(prev => ({ ...prev, [item.id]: { status: 'error' } }));
    }
  }

  // ── Photos: reorder / set cover / crop / background removal ──────────────────

  function moveMedia(id: string, direction: -1 | 1) {
    const media = draftData.media ?? [];
    const idx = media.findIndex(m => m.id === id);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= media.length) return;
    const next = [...media];
    [next[idx], next[target]] = [next[target], next[idx]];
    const resequenced = next.map((m, i) => ({ ...m, sortOrder: i }));
    hapticToggle();
    patchDraft({ media: resequenced });
  }

  function setCoverImage(id: string) {
    const media = draftData.media ?? [];
    hapticToggle();
    patchDraft({ media: media.map(m => ({ ...m, isCover: m.id === id })) });
  }

  function toggleCutoutUse(id: string) {
    const media = draftData.media ?? [];
    hapticToggle();
    patchDraft({ media: media.map(m => m.id === id ? { ...m, useCutout: !m.useCutout } : m) });
  }

  /** Center-crop a photo to a square using expo-image-manipulator. */
  async function cropToSquare(item: ProductMedia) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(item.uri, [], { compress: 0.95 });
      const size = Math.min(manipulated.width, manipulated.height);
      const originX = Math.max(0, Math.floor((manipulated.width - size) / 2));
      const originY = Math.max(0, Math.floor((manipulated.height - size) / 2));
      const cropped = await ImageManipulator.manipulateAsync(
        item.uri,
        [{ crop: { originX, originY, width: size, height: size } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
      );
      const media = draftData.media ?? [];
      patchDraft({ media: media.map(m => m.id === item.id ? { ...m, uri: cropped.uri } : m) });
      setMediaUpload(prev => ({ ...prev, [item.id]: { status: 'uploading' } }));
      void uploadMediaAsset({ ...item, uri: cropped.uri });
      hapticSuccessAction();
    } catch {
      Alert.alert('Crop failed', 'Could not crop this photo. Please try again.');
    }
  }

  /**
   * Calls the existing background-removal service for one photo. Stores the
   * cutout as a local PNG (via bgRemovalService's file convention) and
   * uploads it so both the original and cutout have remote URLs — the
   * seller toggles which one is used per image.
   */
  async function removeBackgroundForMedia(item: ProductMedia) {
    setBgRemovalState(prev => ({ ...prev, [item.id]: 'processing' }));
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        item.uri, [], { base64: true, compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (!manipulated.base64) throw new Error('Could not read image data');
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      const result = await api.bgRemoval.remove(dataUrl);
      if (!result?.b64_json) throw new Error('No cutout returned');

      const localFile = new File(Paths.cache, `product-cutout-${item.id}-${Date.now()}.png`);
      localFile.write(result.b64_json, { encoding: 'base64' });

      const media = draftData.media ?? [];
      patchDraft({ media: media.map(m => m.id === item.id ? { ...m, cutoutUri: localFile.uri, useCutout: true } : m) });
      setBgRemovalState(prev => ({ ...prev, [item.id]: 'done' }));
      hapticSuccessAction();

      // Upload the cutout in the background so it has a remote URL by publish time.
      try {
        const uploaded = await api.products.uploadImage({ uri: localFile.uri });
        const remoteCutoutUri = (uploaded as any)?.objectPath || (uploaded as any)?.url || localFile.uri;
        setDraftData(prev => ({ ...prev, media: (prev.media ?? []).map(m => m.id === item.id ? { ...m, cutoutUri: remoteCutoutUri } : m) }));
      } catch {
        // Cutout stays local; it will be re-uploaded on publish/retry via uploadMediaAsset-style flow.
      }
    } catch {
      // Network failure / offline / service error — degrade to an explicit
      // "retry" affordance rather than silently dropping the feature. There
      // is no reliable on-device fallback for background removal.
      setBgRemovalState(prev => ({ ...prev, [item.id]: 'failed' }));
    }
  }

  function renderPhotos() {
    const media = draftData.media ?? [];
    return (
      <>
        <GradientCard
          onPress={async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Permission required', 'Please allow access to your photo library in Settings.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsMultipleSelection: true,
              quality: 0.9,
            });
            if (!result.canceled && result.assets.length > 0) {
              const existingMedia = draftData.media ?? [];
              const newItems: ProductMedia[] = result.assets.map((a, i) => ({
                id: `${Date.now()}-${i}`,
                type: 'image' as const,
                uri: a.uri,
                isCover: existingMedia.length + i === 0,
                sortOrder: existingMedia.length + i,
                createdAt: new Date().toISOString(),
              }));
              patchDraft({ media: [...existingMedia, ...newItems] });
              newItems.forEach(item => { void uploadMediaAsset(item); });
            }
          }}
          style={s.uploadZone}
        >
          <View style={s.uploadInner}>
            <Feather name="camera" size={32} color={PURPLE_LIGHT} />
            <Text style={s.uploadLabel}>Tap to add photos</Text>
            <Text style={s.uploadHint}>JPG, PNG · Select multiple</Text>
          </View>
        </GradientCard>

        {media.length > 0 && (
          <View style={s.mediaGrid}>
            {media.map((m, idx) => {
              const upload = mediaUpload[m.id];
              const bgStatus = bgRemovalState[m.id];
              const displayUri = m.useCutout && m.cutoutUri ? m.cutoutUri : m.uri;
              return (
              <View key={m.id} style={s.mediaThumbnail}>
                {displayUri && (displayUri.startsWith('http') || displayUri.startsWith('file') || displayUri.startsWith('ph://') || displayUri.startsWith('asset-library://') || displayUri.startsWith('content://') || displayUri.startsWith('/objects/')) ? (
                  <Image source={{ uri: displayUri }} style={s.mediaThumbImg} resizeMode="cover" />
                ) : (
                  <View style={s.mediaThumbImg}>
                    <Feather name="image" size={24} color={PURPLE_LIGHT} />
                  </View>
                )}
                {m.isCover && (
                  <View style={s.mediaCoverBadge}>
                    <Text style={s.mediaCoverBadgeText}>Cover</Text>
                  </View>
                )}
                {(upload?.status === 'uploading' || bgStatus === 'processing') && (
                  <View style={s.mediaUploadOverlay}>
                    <ActivityIndicator color={ON_DARK} />
                  </View>
                )}
                {upload?.status === 'error' && (
                  <TouchableOpacity style={s.mediaUploadOverlay} onPress={() => uploadMediaAsset(m)} accessibilityLabel="Retry photo upload">
                    <Feather name="refresh-cw" size={16} color={ON_DARK} />
                    <Text style={s.mediaRetryLabel}>Retry upload</Text>
                  </TouchableOpacity>
                )}
                {bgStatus === 'failed' && upload?.status !== 'error' && (
                  <TouchableOpacity style={s.mediaUploadOverlay} onPress={() => removeBackgroundForMedia(m)} accessibilityLabel="Retry background removal">
                    <Feather name="refresh-cw" size={16} color={ON_DARK} />
                    <Text style={s.mediaRetryLabel}>Retry cutout</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={s.mediaDeleteBtn}
                  onPress={() => {
                    patchDraft({ media: media.filter(x => x.id !== m.id).map((x, i) => ({ ...x, sortOrder: i })) });
                    setMediaUpload(prev => {
                      const next = { ...prev };
                      delete next[m.id];
                      return next;
                    });
                    setBgRemovalState(prev => {
                      const next = { ...prev };
                      delete next[m.id];
                      return next;
                    });
                  }}
                >
                  <Feather name="x" size={12} color={ON_DARK} />
                </TouchableOpacity>

                {/* Reorder arrows */}
                <View style={s.mediaReorderRow}>
                  <TouchableOpacity
                    disabled={idx === 0}
                    onPress={() => moveMedia(m.id, -1)}
                    style={[s.mediaReorderBtn, idx === 0 && { opacity: 0.3 }]}
                  >
                    <Feather name="chevron-left" size={12} color={ON_DARK} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={idx === media.length - 1}
                    onPress={() => moveMedia(m.id, 1)}
                    style={[s.mediaReorderBtn, idx === media.length - 1 && { opacity: 0.3 }]}
                  >
                    <Feather name="chevron-right" size={12} color={ON_DARK} />
                  </TouchableOpacity>
                </View>
              </View>
              );
            })}
          </View>
        )}

        {media.length > 0 && (
          <View style={s.mediaActionsList}>
            {media.map(m => {
              const bgStatus = bgRemovalState[m.id];
              return (
                <View key={m.id} style={s.mediaActionRow}>
                  <Image source={{ uri: m.useCutout && m.cutoutUri ? m.cutoutUri : m.uri }} style={s.mediaActionThumb} resizeMode="cover" />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={s.chipRow}>
                      {!m.isCover && (
                        <TouchableOpacity style={s.mediaActionChip} onPress={() => setCoverImage(m.id)}>
                          <Feather name="star" size={11} color={theme.accentLight} />
                          <Text style={s.mediaActionChipText}>Set cover</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={s.mediaActionChip} onPress={() => cropToSquare(m)}>
                        <Feather name="crop" size={11} color={theme.accentLight} />
                        <Text style={s.mediaActionChipText}>Crop square</Text>
                      </TouchableOpacity>
                      {bgStatus !== 'processing' && (
                        <TouchableOpacity style={s.mediaActionChip} onPress={() => removeBackgroundForMedia(m)}>
                          <Feather name="scissors" size={11} color={theme.accentLight} />
                          <Text style={s.mediaActionChipText}>{m.cutoutUri ? 'Redo cutout' : 'Remove background'}</Text>
                        </TouchableOpacity>
                      )}
                      {m.cutoutUri && (
                        <TouchableOpacity style={[s.mediaActionChip, m.useCutout && s.mediaActionChipActive]} onPress={() => toggleCutoutUse(m.id)}>
                          <Feather name={m.useCutout ? 'toggle-right' : 'toggle-left'} size={12} color={theme.accentLight} />
                          <Text style={s.mediaActionChipText}>{m.useCutout ? 'Using cutout' : 'Using original'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <FormInput
          label="Image URL"
          value={mediaUrlInput}
          onChange={v => updateUnsavedState(setMediaUrlInput, v)}
          placeholder="https://..."
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!mediaUrlInput.trim()) return;
            const newMedia: ProductMedia = {
              id: uid(), type: 'image',
              uri: mediaUrlInput.trim(),
              isCover: media.length === 0,
              sortOrder: media.length,
              createdAt: new Date().toISOString(),
            };
            patchDraft({ media: [...media, newMedia] });
            setMediaUrlInput('');
          }}
        />
      </>
    );
  }

  function renderBasicInfo() {
    return (
      <>
        <FormInput
          label="Product name *"
          value={draftData.name ?? ''}
          onChange={v => patchDraft({ name: v })}
          placeholder="e.g. Vintage Washed Tee"
        />
        <FormInput
          label="Description"
          value={draftData.description ?? ''}
          onChange={v => patchDraft({ description: v })}
          placeholder="Describe your product, materials, fit and care..."
          multiline
        />
        <SectionHeader title="Category" style={s.sectionHdr} />
        <View style={s.chipGrid}>
          {PRODUCT_CATEGORIES.map(cat => (
            <FilterChip
              key={cat}
              label={cat}
              active={draftData.category === cat}
              onPress={() => patchDraft({ category: cat })}
            />
          ))}
        </View>
        <FormInput
          label="Product type"
          value={draftData.productType ?? ''}
          onChange={v => patchDraft({ productType: v })}
          placeholder="Apparel, Accessories..."
        />
        <FormInput
          label="Vendor"
          value={draftData.vendor ?? ''}
          onChange={v => patchDraft({ vendor: v })}
          placeholder="Your brand or supplier"
        />
        <FormInput
          label="Tags"
          value={tagsInput}
          onChange={v => {
            updateUnsavedState(setTagsInput, v);
            patchDraft({ tags: v.split(',').map(t => t.trim()).filter(Boolean) });
          }}
          placeholder="streetwear, hoodie, oversized"
        />
        {collections.length > 0 && (
          <>
            <SectionHeader title="Collection" style={s.sectionHdr} />
            <View style={s.chipGrid}>
              {collections.map(col => {
                const collIds = draftData.storeSettings?.collectionIds ?? [];
                const active = collIds.includes(col.id);
                return (
                  <FilterChip
                    key={col.id}
                    label={col.name}
                    active={active}
                    onPress={() => {
                      const updated = active
                        ? collIds.filter(id => id !== col.id)
                        : [...collIds, col.id];
                      patchDraft({ storeSettings: { ...(draftData.storeSettings ?? { status: 'draft', featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } }), collectionIds: updated } });
                    }}
                  />
                );
              })}
            </View>
          </>
        )}
      </>
    );
  }

  function renderPricing() {
    const pricing = getPricing();
    const fmt = (v: number | undefined) => v !== undefined ? formatCents(v) : '—';

    return (
      <>
        <FormInput
          label="Retail price *"
          value={priceStr}
          onChange={v => updateUnsavedState(setPriceStr, v)}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Compare-at price"
          value={compareAtStr}
          onChange={v => updateUnsavedState(setCompareAtStr, v)}
          placeholder="Original price if on sale"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Product cost"
          value={costStr}
          onChange={v => updateUnsavedState(setCostStr, v)}
          placeholder="What it costs to make"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Est. shipping cost"
          value={shippingStr}
          onChange={v => updateUnsavedState(setShippingStr, v)}
          placeholder="per unit"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Est. fees"
          value={feesStr}
          onChange={v => updateUnsavedState(setFeesStr, v)}
          placeholder="Platform + payment fees"
          keyboardType="decimal-pad"
        />
        <GradientCard glow style={s.pricingCard}>
          <Text style={s.pricingTitle}>Pricing Summary</Text>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Gross profit</Text>
            <Text style={[s.pricingValue, { color: pricing.grossProfitCents !== undefined && pricing.grossProfitCents >= 0 ? SUCCESS : RED }]}>
              {fmt(pricing.grossProfitCents)}
            </Text>
          </View>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Net profit</Text>
            <Text style={[s.pricingValue, { color: pricing.netProfitCents !== undefined && pricing.netProfitCents >= 0 ? SUCCESS : RED }]}>
              {fmt(pricing.netProfitCents)}
            </Text>
          </View>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Margin</Text>
            <Text style={[s.pricingValue, { color: PURPLE_LIGHT }]}>
              {pricing.marginPercent !== undefined ? `${pricing.marginPercent.toFixed(1)}%` : '—'}
            </Text>
          </View>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Break-even</Text>
            <Text style={s.pricingValue}>{fmt(pricing.breakEvenPriceCents)}</Text>
          </View>
        </GradientCard>
      </>
    );
  }

  function renderInventory() {
    return (
      <>
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Track inventory</Text>
          <Switch
            value={trackInventory}
            onValueChange={v => {
              updateUnsavedState(setTrackInventory, v);
              patchDraft({ inventory: { ...(draftData.inventory!), trackQuantity: v } });
            }}
            trackColor={{ false: BORDER, true: theme.accent }}
            thumbColor={ON_DARK}
          />
        </View>
        {trackInventory && (
          <>
            <FormInput
              label="Current stock"
              value={stockStr}
              onChange={v => updateUnsavedState(setStockStr, v)}
              placeholder="0"
              keyboardType="numeric"
            />
            <FormInput
              label="Low-stock threshold"
              value={lowStockStr}
              onChange={v => updateUnsavedState(setLowStockStr, v)}
              placeholder="5"
              keyboardType="numeric"
            />
          </>
        )}
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Allow overselling</Text>
          <Switch
            value={allowOversell}
            onValueChange={v => {
              updateUnsavedState(setAllowOversell, v);
              patchDraft({ inventory: { ...(draftData.inventory!), allowOverselling: v, policy: v ? 'continue' : 'deny' } });
            }}
            trackColor={{ false: BORDER, true: theme.accent }}
            thumbColor={ON_DARK}
          />
        </View>
        {localVariants.length > 0 && (
          <>
            <SectionHeader title="Stock by variant" style={s.sectionHdr} />
            {localVariants.map(v => (
              <View key={v.id} style={s.variantQtyRow}>
                <Text style={s.variantQtyLabel}>{v.title}</Text>
                <TextInput
                  style={s.variantQtyInput}
                  value={variantQtys[v.id] ?? ''}
                  onChangeText={txt => updateUnsavedState(setVariantQtys, prev => ({ ...prev, [v.id]: txt }))}
                  placeholder="0"
                  placeholderTextColor={SUBTLE}
                  keyboardType="numeric"
                />
              </View>
            ))}
          </>
        )}
      </>
    );
  }

  function renderVariants() {
    return (
      <>
        <SectionHeader
          title="Options"
          action={{
            label: 'Add option',
            onPress: () => {
                updateUnsavedState(setLocalOptions, prev => [...prev, {
                  id: uid(), type: 'size' as OptionType, name: 'Size', values: [], customInput: '',
                }]);
            },
          }}
          style={s.sectionHdr}
        />

        {localOptions.map((opt, idx) => (
          <BrandthreadCard key={opt.id} style={s.optionCard}>
            <Text style={s.optionLabel}>Option type</Text>
            <View style={s.chipRow}>
              {(['size', 'color', 'material', 'style', 'custom'] as OptionType[]).map(t => (
                <FilterChip
                  key={t}
                  label={t.charAt(0).toUpperCase() + t.slice(1)}
                  active={opt.type === t}
                  onPress={() => {
                    const updated = [...localOptions];
                    updated[idx] = { ...opt, type: t, name: t === 'custom' ? '' : t.charAt(0).toUpperCase() + t.slice(1) };
                    updateUnsavedState(setLocalOptions, updated);
                  }}
                />
              ))}
            </View>
            <FormInput
              label="Option name"
              value={opt.name}
              onChange={v => {
                const updated = [...localOptions];
                updated[idx] = { ...opt, name: v };
                updateUnsavedState(setLocalOptions, updated);
              }}
              placeholder="e.g. Size, Color..."
            />
            {opt.type === 'size' && (
              <>
                <Text style={[s.optionLabel, { marginTop: SP.sm }]}>Size presets</Text>
                <View style={s.chipRow}>
                  {SIZE_PRESETS.map(sz => (
                    <FilterChip
                      key={sz}
                      label={sz}
                      active={opt.values.some(v => v.value === sz)}
                      onPress={() => {
                        const updated = [...localOptions];
                        const already = opt.values.some(v => v.value === sz);
                        updated[idx] = { ...opt, values: already ? opt.values.filter(v => v.value !== sz) : [...opt.values, { id: uid(), value: sz }] };
                        updateUnsavedState(setLocalOptions, updated);
                      }}
                    />
                  ))}
                </View>
              </>
            )}
            {opt.type === 'color' && (
              <>
                <Text style={[s.optionLabel, { marginTop: SP.sm }]}>Color presets</Text>
                <View style={s.colorGrid}>
                  {COLOR_PRESETS.map(c => {
                    const selected = opt.values.some(v => v.value === c.name);
                    return (
                      <TouchableOpacity
                        key={c.name}
                        onPress={() => {
                          const updated = [...localOptions];
                          const already = opt.values.some(v => v.value === c.name);
                          updated[idx] = { ...opt, values: already ? opt.values.filter(v => v.value !== c.name) : [...opt.values, { id: uid(), value: c.name, colorHex: c.hex }] };
                          updateUnsavedState(setLocalOptions, updated);
                        }}
                        style={[s.colorSwatch, { backgroundColor: c.hex, borderColor: selected ? theme.accent : BORDER, borderWidth: selected ? 2 : 1 }]}
                      >
                        {selected && <Feather name="check" size={12} color={c.hex === '#FFFFFF' || c.hex === '#F5F0E8' ? '#000' : '#fff'} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
            {opt.values.length > 0 && (
              <View style={[s.chipRow, { marginTop: SP.sm }]}>
                {opt.values.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={s.valueChip}
                    onPress={() => {
                      const updated = [...localOptions];
                      updated[idx] = { ...opt, values: opt.values.filter(x => x.id !== v.id) };
                      updateUnsavedState(setLocalOptions, updated);
                    }}
                  >
                    {v.colorHex && <View style={[s.valueDot, { backgroundColor: v.colorHex }]} />}
                    <Text style={[s.valueChipText, { color: theme.accentLight }]}>{v.value}</Text>
                    <Feather name="x" size={10} color={MUTED} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={s.customValueRow}>
              <TextInput
                style={s.customValueInput}
                value={opt.customInput}
                onChangeText={v => {
                  const updated = [...localOptions];
                  updated[idx] = { ...opt, customInput: v };
                  updateUnsavedState(setLocalOptions, updated);
                }}
                placeholder="Add value..."
                placeholderTextColor={SUBTLE}
              />
              <TouchableOpacity
                style={s.customValueAdd}
                onPress={() => {
                  if (!opt.customInput.trim()) return;
                  const updated = [...localOptions];
                  updated[idx] = { ...opt, values: [...opt.values, { id: uid(), value: opt.customInput.trim() }], customInput: '' };
                  updateUnsavedState(setLocalOptions, updated);
                }}
              >
                <Feather name="plus" size={16} color={PURPLE_LIGHT} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={s.deleteOptionBtn}
              onPress={() => updateUnsavedState(setLocalOptions, prev => prev.filter((_, i) => i !== idx))}
            >
              <Feather name="trash-2" size={14} color={RED} />
              <Text style={s.deleteOptionText}>Remove option</Text>
            </TouchableOpacity>
          </BrandthreadCard>
        ))}

        {localOptions.length > 0 && (
          <PrimaryButton
            label={`Generate combinations${localVariants.length > 0 ? ` (${localVariants.length} existing)` : ''}`}
            onPress={generateVariants}
            icon="zap"
            style={{ marginTop: SP.sm }}
          />
        )}

        {localVariants.length > 0 && (
          <>
            <View style={s.variantsHeaderRow}>
              <Text style={s.variantCount}>{localVariants.length} variant{localVariants.length !== 1 ? 's' : ''}</Text>
              <TouchableOpacity
                onPress={() => {
                  hapticToggle();
                  setBulkEditMode(v => !v);
                  setSelectedVariantIds(new Set());
                }}
              >
                <Text style={[s.bulkEditToggle, { color: theme.accentLight }]}>
                  {bulkEditMode ? 'Done' : 'Bulk edit'}
                </Text>
              </TouchableOpacity>
            </View>

            {bulkEditMode && (
              <BrandthreadCard style={s.bulkEditCard}>
                <Text style={s.optionLabel}>{selectedVariantIds.size} selected</Text>
                <View style={s.chipRow}>
                  <FilterChip
                    label={selectedVariantIds.size === localVariants.length ? 'Deselect all' : 'Select all'}
                    active={selectedVariantIds.size === localVariants.length && localVariants.length > 0}
                    onPress={() => setSelectedVariantIds(
                      selectedVariantIds.size === localVariants.length ? new Set() : new Set(localVariants.map(v => v.id)),
                    )}
                  />
                </View>
                <View style={s.variantFields}>
                  <TextInput
                    style={s.variantInput}
                    value={bulkPrice}
                    onChangeText={setBulkPrice}
                    placeholder="Set price for selected"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={s.variantInput}
                    value={bulkQty}
                    onChangeText={setBulkQty}
                    placeholder="Set stock for selected"
                    placeholderTextColor={SUBTLE}
                    keyboardType="numeric"
                  />
                </View>
                <SecondaryButton
                  label="Apply to selected"
                  icon="check"
                  disabled={selectedVariantIds.size === 0 || (!bulkPrice.trim() && !bulkQty.trim())}
                  onPress={() => {
                    if (bulkPrice.trim()) {
                      updateUnsavedState(setLocalVariants, prev => applyBulkEditToVariants(prev, selectedVariantIds, { price: bulkPrice }));
                    }
                    if (bulkQty.trim()) {
                      updateUnsavedState(setVariantQtys, prev => {
                        const next = { ...prev };
                        selectedVariantIds.forEach(id => { next[id] = bulkQty; });
                        return next;
                      });
                    }
                    hapticSuccessAction();
                    setBulkPrice(''); setBulkQty('');
                  }}
                />
              </BrandthreadCard>
            )}

            {localVariants.map(v => {
              const selected = selectedVariantIds.has(v.id);
              return (
              <BrandthreadCard key={v.id} style={[s.variantRow, bulkEditMode && selected && { borderColor: BORDER_ACTIVE }]}>
                <View style={s.variantTitleRow}>
                  {bulkEditMode && (
                    <TouchableOpacity
                      onPress={() => setSelectedVariantIds(prev => {
                        const next = new Set(prev);
                        if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                        return next;
                      })}
                      style={[s.variantCheckbox, selected && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                    >
                      {selected && <Feather name="check" size={11} color={theme.onAccent} />}
                    </TouchableOpacity>
                  )}
                  <Text style={s.variantTitle}>{v.title}</Text>
                </View>
                <View style={s.variantFields}>
                  <TextInput
                    style={[s.variantInput, { flex: 1.3 }]}
                    value={v.sku}
                    onChangeText={txt => updateUnsavedState(setLocalVariants, prev => prev.map(x => x.id === v.id ? { ...x, sku: txt } : x))}
                    placeholder="SKU"
                    placeholderTextColor={SUBTLE}
                    autoCapitalize="characters"
                    returnKeyType="next"
                  />
                  <TextInput
                    style={[s.variantInput, { flex: 0.9 }]}
                    value={v.price}
                    onChangeText={txt => updateUnsavedState(setLocalVariants, prev => prev.map(x => x.id === v.id ? { ...x, price: txt } : x))}
                    placeholder="Price"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                  <TextInput
                    style={[s.variantInput, { flex: 0.7 }]}
                    value={variantQtys[v.id] ?? v.qty}
                    onChangeText={txt => updateUnsavedState(setVariantQtys, prev => ({ ...prev, [v.id]: txt }))}
                    placeholder="Stock"
                    placeholderTextColor={SUBTLE}
                    keyboardType="numeric"
                    returnKeyType="done"
                  />
                  <TouchableOpacity onPress={() => updateUnsavedState(setLocalVariants, prev => prev.filter(x => x.id !== v.id))} style={{ padding: 4 }}>
                    <Feather name="trash-2" size={14} color={RED} />
                  </TouchableOpacity>
                </View>
              </BrandthreadCard>
              );
            })}
          </>
        )}
      </>
    );
  }

  function renderSalesModel() {
    const sm = draftData.salesModel ?? 'pre-made';
    const ps = draftData.preorderSettings ?? { unitsOrdered: 0, isFunded: false };
    const models: { key: SalesModel; title: string; desc: string }[] = [
      { key: 'pre-made',  title: 'Pre-made',  desc: 'Sell from existing inventory. Ship when ordered.' },
      { key: 'pre-order', title: 'Pre-order', desc: 'Accept orders before production. Set open/close dates.' },
      { key: 'both',      title: 'Both',      desc: 'Sell stock until empty, then take pre-orders.' },
    ];

    return (
      <>
        <SectionHeader title="How will you sell this product?" style={s.sectionHdr} />
        {models.map(m => (
          <TouchableOpacity key={m.key} onPress={() => { hapticToggle(); patchDraft({ salesModel: m.key }); }} activeOpacity={0.8}>
            <BrandthreadCard style={[s.modelCard, sm === m.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}>
              <View style={s.modelCardHeader}>
                <Text style={s.modelTitle}>{m.title}</Text>
                {sm === m.key && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
              </View>
              <Text style={s.modelDesc}>{m.desc}</Text>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}
        {(sm === 'pre-order' || sm === 'both') && (
          <>
            <SectionHeader title="Pre-order settings" style={s.sectionHdr} />
            <FormInput label="Pre-order opens" value={ps.openDate ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, openDate: v } })} placeholder="YYYY-MM-DD" />
            <FormInput label="Pre-order closes" value={ps.closeDate ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, closeDate: v } })} placeholder="YYYY-MM-DD" />
            <FormInput label="Est. shipping date" value={ps.estimatedShippingDate ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, estimatedShippingDate: v } })} placeholder="YYYY-MM-DD" />
            <FormInput label="Funding goal (units)" value={ps.fundingGoalUnits?.toString() ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, fundingGoalUnits: parseInt(v) || 0 } })} keyboardType="numeric" />
            <FormInput label="Min order qty" keyboardType="numeric" value={ps.minOrderQty?.toString() ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, minOrderQty: parseInt(v) || 1 } })} />
            <FormInput label="Max order qty" keyboardType="numeric" value={ps.maxOrderQty?.toString() ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, maxOrderQty: parseInt(v) || 0 } })} />
            <FormInput label="Est. production date" value={ps.productionStartDate ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, productionStartDate: v } })} placeholder="YYYY-MM-DD" />
            <FormInput label="Pre-order disclaimer" value={ps.disclaimer ?? ''} onChange={v => patchDraft({ preorderSettings: { ...ps, disclaimer: v } })} placeholder="e.g. Production begins when funding goal is reached." multiline />
          </>
        )}
      </>
    );
  }

  function renderFulfillment() {
    const ff = draftData.fulfillment ?? { type: 'seller' };
    const types: { key: 'seller' | 'manufacturer' | 'mixed'; label: string }[] = [
      { key: 'seller',       label: 'Fulfilled by me' },
      { key: 'manufacturer', label: 'Fulfilled by manufacturer' },
      { key: 'mixed',        label: 'Mixed' },
    ];

    return (
      <>
        <SectionHeader title="Fulfillment type" style={s.sectionHdr} />
        <View style={s.chipRow}>
          {types.map(t => (
            <FilterChip key={t.key} label={t.label} active={ff.type === t.key} onPress={() => patchDraft({ fulfillment: { ...ff, type: t.key } })} />
          ))}
        </View>
        <FormInput label="Weight (grams)" value={ff.weightGrams?.toString() ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, weightGrams: parseInt(v) || undefined } })} keyboardType="numeric" placeholder="280" />
        <FormInput label="Length (cm)" value={ff.packageLengthCm?.toString() ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, packageLengthCm: parseFloat(v) || undefined } })} keyboardType="numeric" placeholder="30" />
        <FormInput label="Width (cm)" value={ff.packageWidthCm?.toString() ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, packageWidthCm: parseFloat(v) || undefined } })} keyboardType="numeric" placeholder="25" />
        <FormInput label="Height (cm)" value={ff.packageHeightCm?.toString() ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, packageHeightCm: parseFloat(v) || undefined } })} keyboardType="numeric" placeholder="4" />
        <FormInput label="Processing time (days)" value={ff.processingTimeDays?.toString() ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, processingTimeDays: parseInt(v) || undefined } })} keyboardType="numeric" placeholder="2" />
        <FormInput label="Country of origin" value={ff.countryOfOrigin ?? ''} onChange={v => patchDraft({ fulfillment: { ...ff, countryOfOrigin: v } })} placeholder="US" />
      </>
    );
  }

  function renderManufacturing() {
    const modes: { key: 'none' | 'existing' | 'quote'; label: string; desc: string }[] = [
      { key: 'none',     label: 'No manufacturer yet', desc: 'Skip for now, assign later.' },
      { key: 'existing', label: 'Assign existing',     desc: 'Link an existing manufacturer to this product.' },
      { key: 'quote',    label: 'Request quote',       desc: 'Submit production details and request pricing.' },
    ];

    return (
      <>
        <SectionHeader title="Manufacturer" style={s.sectionHdr} />
        {modes.map(m => (
          <TouchableOpacity key={m.key} onPress={() => { hapticToggle(); updateUnsavedState(setMfgMode, m.key); }} activeOpacity={0.8}>
            <BrandthreadCard style={[s.modelCard, mfgMode === m.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}>
              <View style={s.modelCardHeader}>
                <Text style={s.modelTitle}>{m.label}</Text>
                {mfgMode === m.key && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
              </View>
              <Text style={s.modelDesc}>{m.desc}</Text>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}
        {mfgMode === 'existing' && (
          <FormInput label="Manufacturer name" value={mfgName} onChange={v => updateUnsavedState(setMfgName, v)} placeholder="e.g. Euro Stitch Ltd" />
        )}
        {mfgMode === 'quote' && (
          <>
            <FormInput label="Target cost per unit" value={targetCost} onChange={v => updateUnsavedState(setTargetCost, v)} placeholder="0.00" keyboardType="decimal-pad" />
            <FormInput label="Required quantity" value={reqQty} onChange={v => updateUnsavedState(setReqQty, v)} placeholder="50" keyboardType="numeric" />
            <FormInput label="Production deadline" value={prodDeadline} onChange={v => updateUnsavedState(setProdDeadline, v)} placeholder="YYYY-MM-DD" />
            <SecondaryButton label="Upload tech pack" onPress={() => Alert.alert('Tech Pack', 'Tech pack upload will be available in the next release.')} icon="upload" disabled />
          </>
        )}
      </>
    );
  }

  function renderStorefront() {
    const ss = draftData.storeSettings ?? { status: 'draft', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } };
    const seo = ss.seo ?? { searchVisible: true };
    const statuses: { key: 'active' | 'draft' | 'scheduled' | 'hidden' | 'archived'; label: string; desc: string }[] = [
      { key: 'active',    label: 'Active',    desc: 'Visible and purchasable on your storefront.' },
      { key: 'draft',     label: 'Draft',     desc: 'Not visible. Continue editing before publishing.' },
      { key: 'scheduled', label: 'Scheduled', desc: 'Goes live automatically at a set date.' },
      { key: 'hidden',    label: 'Hidden',    desc: 'Only accessible via direct link.' },
      { key: 'archived',  label: 'Archived',  desc: 'Removed from storefront, data retained.' },
    ];

    return (
      <>
        <SectionHeader title="Store visibility" style={s.sectionHdr} />
        {statuses.map(st => (
          <TouchableOpacity key={st.key} onPress={() => { hapticToggle(); patchDraft({ storeSettings: { ...ss, status: st.key }, status: st.key }); }} activeOpacity={0.8}>
            <BrandthreadCard style={[s.modelCard, ss.status === st.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}>
              <View style={s.modelCardHeader}>
                <Text style={s.modelTitle}>{st.label}</Text>
                {ss.status === st.key && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
              </View>
              <Text style={s.modelDesc}>{st.desc}</Text>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}
        {ss.status === 'scheduled' && (
          <FormInput label="Publish date" value={ss.scheduledPublishDate ?? ''} onChange={v => patchDraft({ storeSettings: { ...ss, scheduledPublishDate: v } })} placeholder="YYYY-MM-DD HH:MM" />
        )}
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Featured on homepage</Text>
          <Switch
            value={featuredHome}
            onValueChange={v => { setFeaturedHome(v); patchDraft({ storeSettings: { ...ss, featuredOnHomepage: v } }); }}
            trackColor={{ false: BORDER, true: theme.accent }}
            thumbColor={ON_DARK}
          />
        </View>
        <SectionHeader title="SEO & URL" style={s.sectionHdr} />
        <FormInput label="URL handle" value={seo.urlHandle ?? ''} onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, urlHandle: v } } })} placeholder="my-product-name" />
        <FormInput label="SEO title" value={seo.title ?? ''} onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, title: v } } })} placeholder="Product name — Brand" />
        <FormInput label="SEO description" value={seo.description ?? ''} onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, description: v } } })} multiline />
      </>
    );
  }

  // ── Pricing & Stock step: pricing + preorder toggle + inventory, merged ──
  function renderPricingAndStock() {
    return (
      <>
        {renderPricing()}

        <SectionHeader title="Sales model" style={s.sectionHdr} />
        <View style={s.switchRow}>
          <View style={{ flex: 1, paddingRight: SP.sm }}>
            <Text style={s.switchLabel}>Accept pre-orders</Text>
            <Text style={s.collapsibleHint}>Take orders before the item ships. Only enable if you can fulfil later.</Text>
          </View>
          <Switch
            value={isPreOrder}
            onValueChange={v => {
              hapticToggle();
              setIsPreOrder(v);
              patchDraft({ salesModel: v ? 'pre-order' : 'pre-made' });
            }}
            trackColor={{ false: BORDER, true: theme.accent }}
            thumbColor={ON_DARK}
          />
        </View>
        {isPreOrder && (
          <>
            <FormInput
              label="Pre-order closes"
              value={draftData.preorderSettings?.closeDate ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...(draftData.preorderSettings ?? { unitsOrdered: 0, isFunded: false }), closeDate: v } })}
              placeholder="YYYY-MM-DD"
            />
            <FormInput
              label="Est. shipping date"
              value={draftData.preorderSettings?.estimatedShippingDate ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...(draftData.preorderSettings ?? { unitsOrdered: 0, isFunded: false }), estimatedShippingDate: v } })}
              placeholder="YYYY-MM-DD"
            />
          </>
        )}

        <SectionHeader title="Stock" style={s.sectionHdr} />
        {renderInventory()}
      </>
    );
  }

  // ── Shipping step: fulfillment + advanced manufacturing ──
  function renderShippingStep() {
    return (
      <>
        {renderFulfillment()}
        <CollapsibleSection
          title="Manufacturing"
          icon="tool"
          expanded={expandedSections.manufacturing}
          onToggle={() => toggleSection('manufacturing')}
          hint={mfgMode === 'none' ? 'Not set up yet' : mfgMode === 'existing' ? mfgName || 'Existing manufacturer' : 'Quote requested'}
        >
          {renderManufacturing()}
        </CollapsibleSection>
      </>
    );
  }

  // ── Review & Publish step: live preview + advanced storefront/SEO ──
  function renderReviewStep() {
    const media = draftData.media ?? [];
    const cover = media.find(m => m.isCover) ?? media[0];
    const coverUri = cover ? (cover.useCutout && cover.cutoutUri ? cover.cutoutUri : cover.uri) : undefined;
    const pricing = getPricing();
    const totalStock = localVariants.length > 0
      ? localVariants.reduce((sum, v) => sum + (parseInt(variantQtys[v.id] ?? v.qty) || 0), 0)
      : parseInt(stockStr) || 0;

    return (
      <>
        <SectionHeader title="Live preview" style={s.sectionHdr} />
        <Text style={s.collapsibleHint}>Approximate render — actual layout on Discover and in the feed may vary slightly.</Text>

        {/* Discover-style card preview */}
        <BrandthreadCard style={s.previewCard}>
          <View style={s.previewImageWrap}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={s.previewImage} resizeMode="cover" />
            ) : (
              <View style={[s.previewImage, { alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="image" size={28} color={SUBTLE} />
              </View>
            )}
            {pricing.isOnSale && (
              <View style={s.previewSaleBadge}>
                <Text style={s.previewSaleBadgeText}>-{pricing.discountPercent}%</Text>
              </View>
            )}
          </View>
          <View style={s.previewInfo}>
            <Text style={s.previewName} numberOfLines={1}>{draftData.name || 'Untitled product'}</Text>
            <View style={s.previewPriceRow}>
              <Text style={s.previewPrice}>{formatCents(pricing.retailPriceCents)}</Text>
              {pricing.isOnSale && pricing.compareAtPriceCents !== undefined && (
                <Text style={s.previewCompareAt}>{formatCents(pricing.compareAtPriceCents)}</Text>
              )}
            </View>
            {isPreOrder && <StatusBadge label="Pre-order" variant="warning" />}
          </View>
        </BrandthreadCard>

        {/* Feed product-sheet style preview */}
        <BrandthreadCard style={s.previewSheetCard}>
          <View style={s.previewSheetHeader}>
            {coverUri && <Image source={{ uri: coverUri }} style={s.previewSheetThumb} resizeMode="cover" />}
            <View style={{ flex: 1 }}>
              <Text style={s.previewName} numberOfLines={1}>{draftData.name || 'Untitled product'}</Text>
              <Text style={s.previewPrice}>{formatCents(pricing.retailPriceCents)}</Text>
            </View>
          </View>
          <Text style={s.previewDescription} numberOfLines={3}>
            {draftData.description || 'No description yet.'}
          </Text>
          <View style={s.previewMetaRow}>
            <Text style={s.collapsibleHint}>{media.length} photo{media.length !== 1 ? 's' : ''}</Text>
            <Text style={s.collapsibleHint}>·</Text>
            <Text style={s.collapsibleHint}>{localVariants.length > 0 ? `${localVariants.length} variants` : 'No variants'}</Text>
            <Text style={s.collapsibleHint}>·</Text>
            <Text style={s.collapsibleHint}>{totalStock} in stock</Text>
          </View>
        </BrandthreadCard>

        <CollapsibleSection
          title="Storefront & SEO"
          icon="globe"
          expanded={expandedSections.storefront}
          onToggle={() => toggleSection('storefront')}
          hint="Visibility, collections, URL handle"
        >
          {renderStorefront()}
        </CollapsibleSection>
      </>
    );
  }

  // ── Step progression: validate before advancing, surface inline errors ──
  function stepErrorsFor(step: FlowStep): { field: string; message: string }[] {
    switch (step) {
      case 'photos':   return validatePhotosStep({ media: draftData.media ?? [] });
      case 'details':  return validateDetailsStep({ name: draftData.name ?? '', category: draftData.category });
      case 'variants': return validateVariantsStep({ variants: localVariants.map(v => ({ title: v.title, sku: v.sku, price: v.price })) });
      case 'pricing':  return validatePricingStep({
        priceStr, compareAtStr, costStr, isPreOrder,
        preOrderOpenDate: undefined, preOrderCloseDate: draftData.preorderSettings?.closeDate,
      });
      default: return [];
    }
  }

  const currentErrors = stepErrorsFor(currentStepKey);

  // Inline errors are shown as soon as a step is visited, but only the final
  // Publish is hard-blocked (see handlePublish) — sellers can freely move
  // between steps to fill things in whatever order suits them, and a step
  // with unresolved issues is called out with a warning banner + haptic
  // rather than trapping navigation.
  function goNext() {
    setStepAttempted(prev => ({ ...prev, [currentStepKey]: true }));
    const errs = stepErrorsFor(currentStepKey);
    if (errs.length > 0) hapticDestructiveConfirm();
    else hapticPrimaryAction();
    setStepIndex(i => Math.min(i + 1, FLOW_STEPS.length - 1));
  }

  function goBack() {
    if (stepIndex === 0) { handleExit(); return; }
    hapticPrimaryAction();
    setStepIndex(i => Math.max(i - 1, 0));
  }

  function goToStep(i: number) {
    if (i === stepIndex) return;
    hapticToggle();
    setStepAttempted(prev => ({ ...prev, [currentStepKey]: true }));
    setStepIndex(i);
  }

  function renderStepContent() {
    switch (currentStepKey) {
      case 'photos':   return renderPhotos();
      case 'details':  return renderBasicInfo();
      case 'variants': return renderVariants();
      case 'pricing':  return renderPricingAndStock();
      case 'shipping': return renderShippingStep();
      case 'review':   return renderReviewStep();
    }
  }

  const isLastStep = stepIndex === FLOW_STEPS.length - 1;

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <View style={s.root}>

      {/* ── Header ── */}
      <ScreenHeader
        title={isEditMode ? 'Edit Product' : 'Add Product'}
        variant="push"
        onBack={handleExit}
        backTestID="add-product-exit"
        rightElement={
          <Button
            variant="tertiary"
            size="small"
            label="Save draft"
            onPress={handleSaveDraftInPlace}
            testID="add-product-save-draft"
          />
        }
      />

      {/* ── Sticky step progress ── */}
      <View style={s.progressBar}>
        {FLOW_STEPS.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <TouchableOpacity
              key={step.key}
              style={s.progressStep}
              onPress={() => goToStep(i)}
              accessibilityLabel={`Step ${i + 1}: ${step.label}`}
              testID={`add-product-step-${step.key}`}
            >
              <View style={[s.progressDot, done && s.progressDotDone, active && s.progressDotActive]}>
                {done ? (
                  <Feather name="check" size={11} color={theme.onAccent} />
                ) : (
                  <Text style={[s.progressDotText, active && { color: theme.onAccent }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[s.progressLabel, active && { color: FG, fontFamily: FONT.semibold }]} numberOfLines={1}>
                {step.label}
              </Text>
              {i < FLOW_STEPS.length - 1 && <View style={[s.progressConnector, done && s.progressConnectorDone]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Current step form ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={s.scrollView}
          contentContainerStyle={[s.scrollContent, { paddingBottom: 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.essentialSection}>
            <Text style={s.essentialLabel}>{FLOW_STEPS[stepIndex].label}</Text>
            {renderStepContent()}

            {stepAttempted[currentStepKey] && currentErrors.length > 0 && (
              <View style={s.errorBanner}>
                {currentErrors.map((e, i) => (
                  <Text key={i} style={s.errorBannerText}>• {e.message}</Text>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        {/* The action area is outside the scroll view so it's always
            available without losing the form's draft state or scroll position. */}
        <View style={[s.stickyFooter, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
          <View style={s.publishButtons}>
            <SecondaryButton
              label={stepIndex === 0 ? 'Cancel' : 'Back'}
              onPress={goBack}
              style={{ flex: 1 }}
            />
            {isLastStep ? (
              <PrimaryButton
                label={photosUploading ? 'Uploading photos…' : publishing ? 'Publishing...' : 'Publish'}
                disabled={publishing || photosUploading}
                onPress={handlePublish}
                style={{ flex: 1 }}
              />
            ) : (
              <PrimaryButton
                label="Next"
                icon="arrow-right"
                onPress={goNext}
                style={{ flex: 1 }}
              />
            )}
          </View>
          <TouchableOpacity onPress={handleSaveDraftAndExit} style={{ alignSelf: 'center', paddingTop: 4 }}>
            <Text style={[s.headerSaveText, { color: MUTED }]}>Save as draft & exit</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
    onAccent: ON_DARK,
  } = theme;
  const BORDER_ACTIVE = theme.accentLight;
  const BLUE = theme.accentLight;
  const GOLD = theme.accent;
  const GRAD_CARD_GLOW = theme.glowGradient;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // Footer "Save as draft & exit" link (header itself is now ScreenHeader)
  headerSaveText: {
    ...TYPE_SCALE.footnote,
    fontFamily: FONT.semibold,
  },

  // Sticky step progress
  progressBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  progressStep: { flex: 1, alignItems: 'center', position: 'relative' },
  progressDot: {
    width: 22, height: 22, borderRadius: RADII.pill,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  progressDotActive: { borderColor: theme.accent, backgroundColor: theme.accent },
  progressDotDone: { borderColor: theme.accent, backgroundColor: theme.accent },
  progressDotText: { ...TYPE_SCALE.caption, fontFamily: FONT.bold, color: MUTED },
  progressLabel: { ...TYPE_SCALE.caption, color: MUTED, marginTop: 4, textAlign: 'center' },
  progressConnector: {
    position: 'absolute', top: 10, right: '-50%', width: '100%', height: 1.5, backgroundColor: BORDER, zIndex: -1,
  },
  progressConnectorDone: { backgroundColor: theme.accent },

  // Inline step validation
  errorBanner: {
    backgroundColor: 'rgba(248,113,113,0.12)', borderRadius: RADIUS.sm, borderWidth: 1, borderColor: RED,
    padding: SP.sm, gap: 4, marginTop: SP.xs,
  },
  errorBannerText: { fontSize: FS.sm, fontFamily: FONT.medium, color: RED },

  // Scroll
  scrollView: { flex: 1 },
  scrollContent: { paddingTop: SP.md },

  // Essential sections (always visible)
  essentialSection: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
    gap: SP.md,
  },
  essentialLabel: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: SP.md,
    marginBottom: SP.md,
  },

  // Collapsible sections
  collapsibleBlock: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: 14,
  },
  collapsibleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flex: 1,
  },
  collapsibleIconWrap: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  collapsibleHint: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  collapsibleBody: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
    gap: SP.md,
  },

  // Sticky actions stay above the safe area while the form scrolls behind it.
  stickyFooter: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  publishButtons: {
    flexDirection: 'row',
    gap: SP.sm,
  },

  // Shared field helpers
  sectionHdr: { paddingHorizontal: 0 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },

  // Media
  uploadZone: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  uploadInner: { alignItems: 'center', gap: SP.sm, paddingVertical: SP.lg },
  uploadLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED },
  uploadHint: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  mediaThumbnail: {
    width: 80, height: 80, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', position: 'relative',
  },
  mediaThumbImg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mediaDeleteBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  mediaUploadOverlay: {
    // theme-exempt: scrim over media thumbnail, not a themed surface
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  mediaRetryLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: ON_DARK },
  mediaCoverBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  mediaCoverBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.bold, color: ON_DARK },
  mediaReorderRow: {
    position: 'absolute', top: 4, left: 4, flexDirection: 'row', gap: 2,
  },
  mediaReorderBtn: {
    width: 18, height: 18, borderRadius: RADII.pill, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  mediaActionsList: { gap: SP.sm, marginTop: SP.xs },
  mediaActionRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  mediaActionThumb: { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: CARD },
  mediaActionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: CARD, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  mediaActionChipActive: { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED },
  mediaActionChipText: { ...TYPE_SCALE.caption, fontFamily: FONT.medium, color: MUTED },

  // Pricing
  pricingCard: { gap: SP.sm },
  pricingTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: SP.xs },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  pricingValue: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },

  // Inventory
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, height: COMP.inputH,
  },
  switchLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  variantQtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, height: COMP.inputH,
  },
  variantQtyLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flex: 1 },
  variantQtyInput: {
    width: 80, height: 36, backgroundColor: SURFACE,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular,
    color: FG, textAlign: 'right',
  },

  // Options / variants
  optionCard: { gap: SP.sm },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  colorSwatch: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  valueChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  valueDot: { width: 10, height: 10, borderRadius: RADII.pill, borderWidth: 1, borderColor: BORDER },
  valueChipText: { fontSize: FS.xs, fontFamily: FONT.medium },
  customValueRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, height: COMP.inputH,
  },
  customValueInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  customValueAdd: { padding: SP.xs },
  deleteOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, alignSelf: 'flex-start', marginTop: SP.xs },
  deleteOptionText: { fontSize: FS.xs, fontFamily: FONT.medium, color: RED },
  variantCount: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  variantsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.xs },
  bulkEditToggle: { fontSize: FS.sm, fontFamily: FONT.semibold },
  bulkEditCard: { gap: SP.sm },
  variantRow: { gap: SP.sm },
  variantTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  variantCheckbox: {
    width: 18, height: 18, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  variantTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  variantFields: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  variantInput: {
    flex: 1, height: 40, backgroundColor: SURFACE,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },

  // Review step: live preview cards
  previewCard: { padding: 0, overflow: 'hidden' },
  previewImageWrap: { width: '100%', aspectRatio: 1, backgroundColor: CARD },
  previewImage: { width: '100%', height: '100%' },
  previewSaleBadge: {
    position: 'absolute', top: SP.sm, left: SP.sm,
    backgroundColor: RED, borderRadius: RADIUS.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  previewSaleBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  previewInfo: { padding: SP.md, gap: 4 },
  previewName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  previewPriceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  previewPrice: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  previewCompareAt: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
  previewSheetCard: { gap: SP.sm },
  previewSheetHeader: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  previewSheetThumb: { width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: CARD },
  previewDescription: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  previewMetaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  // Model selection cards
  modelCard: { gap: SP.xs },
  modelCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modelTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  modelDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  });
};
