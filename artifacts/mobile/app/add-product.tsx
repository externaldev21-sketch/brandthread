/**
 * Add Product — 10-step product creation flow
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  TextInput, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, BLUE, ORANGE, RED, GOLD, ON_DARK,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
} from '@/lib/theme';

import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader, FormInput,
  ProgressCard, EmptyState, GuidedTip,
} from '@/components/BrandthreadUI';

import {
  createProduct, saveDraft, loadDraft, getCollections, DEMO_FULL_PRODUCTS,
} from '@/services/productService';

import {
  Product, ProductDraft, ProductCategory, PRODUCT_CATEGORIES,
  SIZE_PRESETS, COLOR_PRESETS, SalesModel, OptionType,
  ProductOption, OptionValue, ProductVariant, ProductMedia,
} from '@/services/productTypes';

import {
  calcPricing, generateVariantCombinations, buildVariantTitle, validateForPublish,
} from '@/lib/productUtils';

// ─── Step definitions ─────────────────────────────────────────────────────────

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

// ─── Local state interfaces ───────────────────────────────────────────────────

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AddProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(1);
  const [draftData, setDraftData] = useState<Partial<Product>>({
    name: '',
    description: '',
    tags: [],
    media: [],
    pricing: { price: 0, currency: 'USD' },
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
    salesModel: 'pre-made',
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

  // ── Step-specific local state ──
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

  const draftId = useRef('draft_' + uid());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-save draft ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const draft: ProductDraft = {
        ...draftData,
        id: draftId.current,
        isDraft: true,
        currentStep: step,
        lastSavedAt: new Date().toISOString(),
      };
      saveDraft(draft);
    }, 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [draftData, step]);

  // ── Helpers ──
  function patchDraft(patch: Partial<Product>) {
    setDraftData(prev => ({ ...prev, ...patch }));
  }

  function handleExit() {
    Alert.alert('Exit product creation?', 'Your progress will be saved as a draft.', [
      {
        text: 'Save draft', onPress: () => {
          const draft: ProductDraft = {
            ...draftData,
            id: draftId.current,
            isDraft: true,
            currentStep: step,
            lastSavedAt: new Date().toISOString(),
          };
          saveDraft(draft);
          router.back();
        },
      },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleSaveDraft() {
    const draft: ProductDraft = {
      ...draftData,
      id: draftId.current,
      isDraft: true,
      currentStep: step,
      lastSavedAt: new Date().toISOString(),
    };
    saveDraft(draft);
    Alert.alert('Draft saved', 'You can continue editing later.');
    router.back();
  }

  function goNext() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < 10) {
      setStep(s => s + 1);
    } else {
      handlePublish();
    }
  }

  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step > 1) setStep(s => s - 1);
  }

  // ── Pricing helpers ──
  function getPricing() {
    return calcPricing({
      price: parseFloat(priceStr) || 0,
      compareAtPrice: parseFloat(compareAtStr) || undefined,
      cost: parseFloat(costStr) || undefined,
      estimatedShippingCost: parseFloat(shippingStr) || 0,
      estimatedFees: parseFloat(feesStr) || 0,
      currency: 'USD',
    });
  }

  // ── Variant generation ──
  function generateVariants() {
    if (localOptions.length === 0) {
      Alert.alert('No options', 'Add at least one option with values first.');
      return;
    }
    const opts = localOptions.map(o => ({
      id: o.id,
      name: o.name,
      values: o.values,
    }));
    const combos = generateVariantCombinations(opts);
    const variants: LocalVariant[] = combos.map(combo => ({
      id: uid(),
      title: buildVariantTitle(combo.map(c => c.value)),
      optionValues: combo.map(c => ({ optionId: c.optionId, valueId: c.valueId })),
      sku: '',
      price: '',
      qty: '',
    }));
    setLocalVariants(variants);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // ── Publish ──
  async function handlePublish() {
    const pricing = {
      price: parseFloat(priceStr) || 0,
      compareAtPrice: parseFloat(compareAtStr) || undefined,
      cost: parseFloat(costStr) || undefined,
      estimatedShippingCost: parseFloat(shippingStr) || 0,
      estimatedFees: parseFloat(feesStr) || 0,
      currency: 'USD',
    };
    const productOptions: ProductOption[] = localOptions.map((o, i) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      values: o.values.map(v => ({
        id: v.id,
        value: v.value,
        colorHex: v.colorHex,
      })),
      sortOrder: i,
    }));
    const productVariants: ProductVariant[] = localVariants.map(v => ({
      id: v.id,
      productId: '',
      title: v.title,
      optionValues: v.optionValues,
      sku: v.sku,
      price: parseFloat(v.price) || undefined,
      inventoryQuantity: parseInt(variantQtys[v.id] || v.qty) || 0,
      reservedQuantity: 0,
      incomingQuantity: 0,
      status: 'active' as const,
      requiresShipping: true,
      taxable: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    try {
      await createProduct({
        ...draftData,
        pricing,
        options: productOptions,
        variants: productVariants,
        status: 'active',
        storeSettings: {
          ...(draftData.storeSettings ?? { collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } }),
          status: 'active',
          featuredOnHomepage: featuredHome,
        },
        manufacturing: {
          stage: mfgMode === 'quote' ? 'quote_requested' : 'none',
          manufacturerName: mfgName || undefined,
          targetCostPerUnit: parseFloat(targetCost) || undefined,
          requiredQuantity: parseInt(reqQty) || undefined,
          productionDeadline: prodDeadline || undefined,
        },
      });
      Alert.alert('Published!', `"${draftData.name}" is now live.`);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not publish. Please try again.');
    }
  }

  // ─── Render steps ──────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <View style={s.stepContent}>
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
            setTagsInput(v);
            patchDraft({ tags: v.split(',').map(t => t.trim()).filter(Boolean) });
          }}
          placeholder="streetwear, hoodie, oversized"
        />
      </View>
    );
  }

  function renderStep2() {
    const media = draftData.media ?? [];
    return (
      <View style={s.stepContent}>
        <SectionHeader title="Product media" style={s.sectionHdr} />
        <GradientCard
          onPress={() => Alert.alert('Upload', 'Media upload coming soon — add a URL for now')}
          style={s.uploadZone}
        >
          <View style={s.uploadInner}>
            <Feather name="camera" size={32} color={PURPLE_LIGHT} />
            <Text style={s.uploadLabel}>Tap to add photos and videos</Text>
            <Text style={s.uploadHint}>JPG, PNG, MP4 · Max 100MB</Text>
          </View>
        </GradientCard>

        {media.length > 0 && (
          <View style={s.mediaGrid}>
            {media.map(m => (
              <View key={m.id} style={s.mediaThumbnail}>
                <View style={s.mediaThumbImg}>
                  <Feather name="image" size={24} color={PURPLE_LIGHT} />
                </View>
                <TouchableOpacity
                  style={s.mediaDeleteBtn}
                  onPress={() => patchDraft({ media: media.filter(x => x.id !== m.id) })}
                >
                  <Feather name="x" size={12} color={ON_DARK} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <FormInput
          label="Image URL (demo)"
          value={mediaUrlInput}
          onChange={setMediaUrlInput}
          placeholder="https://..."
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!mediaUrlInput.trim()) return;
            const newMedia: ProductMedia = {
              id: uid(),
              type: 'image',
              uri: mediaUrlInput.trim(),
              isCover: media.length === 0,
              sortOrder: media.length,
              createdAt: new Date().toISOString(),
            };
            patchDraft({ media: [...media, newMedia] });
            setMediaUrlInput('');
          }}
        />

        <SectionHeader title="Media tips" style={s.sectionHdr} />
        <BrandthreadCard>
          <Text style={s.tipText}>
            Your cover image is the first thing buyers see. Use a clean background or lifestyle shot.
          </Text>
        </BrandthreadCard>
      </View>
    );
  }

  function renderStep3() {
    const pricing = getPricing();
    const fmt = (v: number | undefined) =>
      v !== undefined ? `$${v.toFixed(2)}` : '—';

    return (
      <View style={s.stepContent}>
        <FormInput
          label="Retail price *"
          value={priceStr}
          onChange={setPriceStr}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Compare-at price"
          value={compareAtStr}
          onChange={setCompareAtStr}
          placeholder="Original price if on sale"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Product cost"
          value={costStr}
          onChange={setCostStr}
          placeholder="What it costs to make"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Est. shipping cost"
          value={shippingStr}
          onChange={setShippingStr}
          placeholder="per unit"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Est. fees"
          value={feesStr}
          onChange={setFeesStr}
          placeholder="Platform + payment fees"
          keyboardType="decimal-pad"
        />

        <GradientCard glow style={s.pricingCard}>
          <Text style={s.pricingTitle}>Pricing Summary</Text>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Gross profit</Text>
            <Text style={[s.pricingValue, { color: pricing.grossProfit !== undefined && pricing.grossProfit >= 0 ? SUCCESS : RED }]}>
              {fmt(pricing.grossProfit)}
            </Text>
          </View>
          <View style={s.pricingRow}>
            <Text style={s.pricingLabel}>Net profit</Text>
            <Text style={[s.pricingValue, { color: pricing.netProfit !== undefined && pricing.netProfit >= 0 ? SUCCESS : RED }]}>
              {fmt(pricing.netProfit)}
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
            <Text style={s.pricingValue}>{fmt(pricing.breakEvenPrice)}</Text>
          </View>
        </GradientCard>
      </View>
    );
  }

  function renderStep4() {
    return (
      <View style={s.stepContent}>
        <SectionHeader
          title="Options"
          action={{
            label: 'Add option',
            onPress: () => {
              setLocalOptions(prev => [...prev, {
                id: uid(),
                type: 'size',
                name: 'Size',
                values: [],
                customInput: '',
              }]);
            },
          }}
          style={s.sectionHdr}
        />

        {localOptions.map((opt, idx) => (
          <BrandthreadCard key={opt.id} style={s.optionCard}>
            {/* Option type selector */}
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
                    setLocalOptions(updated);
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
                setLocalOptions(updated);
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
                        updated[idx] = {
                          ...opt,
                          values: already
                            ? opt.values.filter(v => v.value !== sz)
                            : [...opt.values, { id: uid(), value: sz }],
                        };
                        setLocalOptions(updated);
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
                          updated[idx] = {
                            ...opt,
                            values: already
                              ? opt.values.filter(v => v.value !== c.name)
                              : [...opt.values, { id: uid(), value: c.name, colorHex: c.hex }],
                          };
                          setLocalOptions(updated);
                        }}
                        style={[s.colorSwatch, { backgroundColor: c.hex, borderColor: selected ? PURPLE : BORDER, borderWidth: selected ? 2 : 1 }]}
                      >
                        {selected && <Feather name="check" size={12} color={c.hex === '#FFFFFF' || c.hex === '#F5F0E8' ? '#000' : '#fff'} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Current values as chips */}
            {opt.values.length > 0 && (
              <View style={[s.chipRow, { marginTop: SP.sm }]}>
                {opt.values.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={s.valueChip}
                    onPress={() => {
                      const updated = [...localOptions];
                      updated[idx] = { ...opt, values: opt.values.filter(x => x.id !== v.id) };
                      setLocalOptions(updated);
                    }}
                  >
                    {v.colorHex && <View style={[s.valueDot, { backgroundColor: v.colorHex }]} />}
                    <Text style={s.valueChipText}>{v.value}</Text>
                    <Feather name="x" size={10} color={MUTED} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Custom value input */}
            <View style={s.customValueRow}>
              <TextInput
                style={s.customValueInput}
                value={opt.customInput}
                onChangeText={v => {
                  const updated = [...localOptions];
                  updated[idx] = { ...opt, customInput: v };
                  setLocalOptions(updated);
                }}
                placeholder="Add value..."
                placeholderTextColor={SUBTLE}
              />
              <TouchableOpacity
                style={s.customValueAdd}
                onPress={() => {
                  if (!opt.customInput.trim()) return;
                  const updated = [...localOptions];
                  updated[idx] = {
                    ...opt,
                    values: [...opt.values, { id: uid(), value: opt.customInput.trim() }],
                    customInput: '',
                  };
                  setLocalOptions(updated);
                }}
              >
                <Feather name="plus" size={16} color={PURPLE_LIGHT} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={s.deleteOptionBtn}
              onPress={() => setLocalOptions(prev => prev.filter((_, i) => i !== idx))}
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
            <Text style={s.variantCount}>{localVariants.length} variants will be created</Text>
            {localVariants.map(v => (
              <BrandthreadCard key={v.id} style={s.variantRow}>
                <Text style={s.variantTitle}>{v.title}</Text>
                <View style={s.variantFields}>
                  <TextInput
                    style={s.variantInput}
                    value={v.sku}
                    onChangeText={txt => setLocalVariants(prev => prev.map(x => x.id === v.id ? { ...x, sku: txt } : x))}
                    placeholder="SKU"
                    placeholderTextColor={SUBTLE}
                  />
                  <TextInput
                    style={s.variantInput}
                    value={v.price}
                    onChangeText={txt => setLocalVariants(prev => prev.map(x => x.id === v.id ? { ...x, price: txt } : x))}
                    placeholder="Price override"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                  />
                </View>
              </BrandthreadCard>
            ))}
          </>
        )}
      </View>
    );
  }

  function renderStep5() {
    return (
      <View style={s.stepContent}>
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Track inventory</Text>
          <Switch
            value={trackInventory}
            onValueChange={v => {
              setTrackInventory(v);
              patchDraft({ inventory: { ...(draftData.inventory!), trackQuantity: v } });
            }}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor={ON_DARK}
          />
        </View>

        {trackInventory && (
          <>
            <FormInput
              label="Current stock"
              value={stockStr}
              onChange={setStockStr}
              placeholder="0"
              keyboardType="numeric"
            />
            <FormInput
              label="Low-stock threshold"
              value={lowStockStr}
              onChange={setLowStockStr}
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
              setAllowOversell(v);
              patchDraft({ inventory: { ...(draftData.inventory!), allowOverselling: v, policy: v ? 'continue' : 'deny' } });
            }}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor={ON_DARK}
          />
        </View>

        {localVariants.length > 0 && (
          <>
            <SectionHeader title="By variant" style={s.sectionHdr} />
            {localVariants.map(v => (
              <View key={v.id} style={s.variantQtyRow}>
                <Text style={s.variantQtyLabel}>{v.title}</Text>
                <TextInput
                  style={s.variantQtyInput}
                  value={variantQtys[v.id] ?? ''}
                  onChangeText={txt => setVariantQtys(prev => ({ ...prev, [v.id]: txt }))}
                  placeholder="0"
                  placeholderTextColor={SUBTLE}
                  keyboardType="numeric"
                />
              </View>
            ))}
          </>
        )}
      </View>
    );
  }

  function renderStep6() {
    const sm = draftData.salesModel ?? 'pre-made';
    const ps = draftData.preorderSettings ?? { unitsOrdered: 0, isFunded: false };

    const models: { key: SalesModel; title: string; desc: string }[] = [
      { key: 'pre-made', title: 'Pre-made', desc: 'Sell from existing inventory. Ship when ordered.' },
      { key: 'pre-order', title: 'Pre-order', desc: 'Accept orders before production. Set open/close dates.' },
      { key: 'both', title: 'Both', desc: 'Sell stock until empty, then take pre-orders.' },
    ];

    return (
      <View style={s.stepContent}>
        <SectionHeader title="How will you sell this product?" style={s.sectionHdr} />
        {models.map(m => (
          <TouchableOpacity
            key={m.key}
            onPress={() => {
              Haptics.selectionAsync();
              patchDraft({ salesModel: m.key });
            }}
            activeOpacity={0.8}
          >
            <BrandthreadCard
              style={[s.modelCard, sm === m.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}
            >
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
            <FormInput
              label="Pre-order opens"
              value={ps.openDate ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...ps, openDate: v } })}
              placeholder="YYYY-MM-DD"
            />
            <FormInput
              label="Pre-order closes"
              value={ps.closeDate ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...ps, closeDate: v } })}
              placeholder="YYYY-MM-DD"
            />
            <FormInput
              label="Est. shipping date"
              value={ps.estimatedShippingDate ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...ps, estimatedShippingDate: v } })}
              placeholder="YYYY-MM-DD"
            />
            <FormInput
              label="Funding goal (units)"
              value={ps.fundingGoalUnits?.toString() ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...ps, fundingGoalUnits: parseInt(v) || 0 } })}
              keyboardType="numeric"
            />
            <FormInput
              label="Pre-order disclaimer"
              value={ps.disclaimer ?? ''}
              onChange={v => patchDraft({ preorderSettings: { ...ps, disclaimer: v } })}
              placeholder="e.g. Production begins when funding goal is reached."
              multiline
            />
          </>
        )}
      </View>
    );
  }

  function renderStep7() {
    const ff = draftData.fulfillment ?? { type: 'seller' };
    const types: { key: 'seller' | 'manufacturer' | 'mixed'; label: string }[] = [
      { key: 'seller', label: 'Fulfilled by me' },
      { key: 'manufacturer', label: 'Fulfilled by manufacturer' },
      { key: 'mixed', label: 'Mixed' },
    ];

    return (
      <View style={s.stepContent}>
        <SectionHeader title="Fulfillment type" style={s.sectionHdr} />
        <View style={s.chipRow}>
          {types.map(t => (
            <FilterChip
              key={t.key}
              label={t.label}
              active={ff.type === t.key}
              onPress={() => patchDraft({ fulfillment: { ...ff, type: t.key } })}
            />
          ))}
        </View>

        <FormInput
          label="Weight (grams)"
          value={ff.weightGrams?.toString() ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, weightGrams: parseInt(v) || undefined } })}
          keyboardType="numeric"
          placeholder="280"
        />
        <FormInput
          label="Length (cm)"
          value={ff.packageLengthCm?.toString() ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, packageLengthCm: parseFloat(v) || undefined } })}
          keyboardType="numeric"
          placeholder="30"
        />
        <FormInput
          label="Width (cm)"
          value={ff.packageWidthCm?.toString() ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, packageWidthCm: parseFloat(v) || undefined } })}
          keyboardType="numeric"
          placeholder="25"
        />
        <FormInput
          label="Height (cm)"
          value={ff.packageHeightCm?.toString() ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, packageHeightCm: parseFloat(v) || undefined } })}
          keyboardType="numeric"
          placeholder="4"
        />
        <FormInput
          label="Processing time (days)"
          value={ff.processingTimeDays?.toString() ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, processingTimeDays: parseInt(v) || undefined } })}
          keyboardType="numeric"
          placeholder="2"
        />
        <FormInput
          label="Country of origin"
          value={ff.countryOfOrigin ?? ''}
          onChange={v => patchDraft({ fulfillment: { ...ff, countryOfOrigin: v } })}
          placeholder="US"
        />
      </View>
    );
  }

  function renderStep8() {
    const modes: { key: 'none' | 'existing' | 'quote'; label: string; desc: string }[] = [
      { key: 'none', label: 'No manufacturer yet', desc: 'Skip for now, assign later.' },
      { key: 'existing', label: 'Assign existing', desc: 'Link an existing manufacturer to this product.' },
      { key: 'quote', label: 'Request quote', desc: 'Submit production details and request pricing.' },
    ];

    return (
      <View style={s.stepContent}>
        <SectionHeader title="Manufacturer" style={s.sectionHdr} />
        {modes.map(m => (
          <TouchableOpacity
            key={m.key}
            onPress={() => { Haptics.selectionAsync(); setMfgMode(m.key); }}
            activeOpacity={0.8}
          >
            <BrandthreadCard
              style={[s.modelCard, mfgMode === m.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}
            >
              <View style={s.modelCardHeader}>
                <Text style={s.modelTitle}>{m.label}</Text>
                {mfgMode === m.key && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
              </View>
              <Text style={s.modelDesc}>{m.desc}</Text>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}

        {mfgMode === 'existing' && (
          <FormInput
            label="Manufacturer name"
            value={mfgName}
            onChange={setMfgName}
            placeholder="e.g. Euro Stitch Ltd"
          />
        )}

        {mfgMode === 'quote' && (
          <>
            <FormInput
              label="Target cost per unit"
              value={targetCost}
              onChange={setTargetCost}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <FormInput
              label="Required quantity"
              value={reqQty}
              onChange={setReqQty}
              placeholder="50"
              keyboardType="numeric"
            />
            <FormInput
              label="Production deadline"
              value={prodDeadline}
              onChange={setProdDeadline}
              placeholder="YYYY-MM-DD"
            />
            <SecondaryButton
              label="Upload tech pack (coming soon)"
              onPress={() => Alert.alert('Coming soon', 'Tech pack upload will be available in a future update.')}
              icon="upload"
              disabled
            />
          </>
        )}
      </View>
    );
  }

  function renderStep9() {
    const ss = draftData.storeSettings ?? {
      status: 'draft',
      collectionIds: [],
      featuredOnHomepage: false,
      relatedProductIds: [],
      seo: { searchVisible: true },
    };
    const seo = ss.seo ?? { searchVisible: true };

    const statuses: { key: 'active' | 'draft' | 'scheduled' | 'hidden' | 'archived'; label: string; desc: string }[] = [
      { key: 'active', label: 'Active', desc: 'Visible and purchasable on your storefront.' },
      { key: 'draft', label: 'Draft', desc: 'Not visible. Continue editing before publishing.' },
      { key: 'scheduled', label: 'Scheduled', desc: 'Goes live automatically at a set date.' },
      { key: 'hidden', label: 'Hidden', desc: 'Only accessible via direct link.' },
      { key: 'archived', label: 'Archived', desc: 'Removed from storefront, data retained.' },
    ];

    return (
      <View style={s.stepContent}>
        <SectionHeader title="Store visibility" style={s.sectionHdr} />
        {statuses.map(st => (
          <TouchableOpacity
            key={st.key}
            onPress={() => { Haptics.selectionAsync(); patchDraft({ storeSettings: { ...ss, status: st.key }, status: st.key }); }}
            activeOpacity={0.8}
          >
            <BrandthreadCard
              style={[s.modelCard, ss.status === st.key && { borderColor: BORDER_ACTIVE, backgroundColor: CARD_ELEVATED }]}
            >
              <View style={s.modelCardHeader}>
                <Text style={s.modelTitle}>{st.label}</Text>
                {ss.status === st.key && <Feather name="check-circle" size={18} color={PURPLE_LIGHT} />}
              </View>
              <Text style={s.modelDesc}>{st.desc}</Text>
            </BrandthreadCard>
          </TouchableOpacity>
        ))}

        {ss.status === 'scheduled' && (
          <FormInput
            label="Publish date"
            value={ss.scheduledPublishDate ?? ''}
            onChange={v => patchDraft({ storeSettings: { ...ss, scheduledPublishDate: v } })}
            placeholder="YYYY-MM-DD HH:MM"
          />
        )}

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Featured on homepage</Text>
          <Switch
            value={featuredHome}
            onValueChange={v => {
              setFeaturedHome(v);
              patchDraft({ storeSettings: { ...ss, featuredOnHomepage: v } });
            }}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor={ON_DARK}
          />
        </View>

        <SectionHeader title="SEO & URL" style={s.sectionHdr} />
        <FormInput
          label="URL handle"
          value={seo.urlHandle ?? ''}
          onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, urlHandle: v } } })}
          placeholder="my-product-name"
        />
        <FormInput
          label="SEO title"
          value={seo.title ?? ''}
          onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, title: v } } })}
          placeholder="Product name — Brand"
        />
        <FormInput
          label="SEO description"
          value={seo.description ?? ''}
          onChange={v => patchDraft({ storeSettings: { ...ss, seo: { ...seo, description: v } } })}
          multiline
        />
      </View>
    );
  }

  function renderStep10() {
    const pricing = getPricing();
    const ss = draftData.storeSettings ?? { status: 'draft', collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } };
    const seo = ss.seo ?? { searchVisible: true };
    const ff = draftData.fulfillment ?? { type: 'seller' };
    const media = draftData.media ?? [];
    const tags = draftData.tags ?? [];

    const forValidation = {
      name: draftData.name ?? '',
      description: draftData.description ?? '',
      pricing: { price: parseFloat(priceStr) || 0, currency: 'USD' },
      media,
      variants: localVariants,
    };
    const warnings = validateForPublish(forValidation);

    function ReviewRow({ label, value }: { label: string; value: string }) {
      return (
        <View style={s.reviewRow}>
          <Text style={s.reviewLabel}>{label}</Text>
          <Text style={s.reviewValue}>{value}</Text>
        </View>
      );
    }

    return (
      <View style={s.stepContent}>
        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Basic</Text>
          <ReviewRow label="Name" value={draftData.name || '—'} />
          <ReviewRow label="Category" value={draftData.category || '—'} />
          <ReviewRow label="Tags" value={tags.length > 0 ? tags.join(', ') : '—'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Media</Text>
          <ReviewRow label="Images" value={media.length > 0 ? `${media.length} image${media.length !== 1 ? 's' : ''}` : 'None added'} />
          {media[0] && <ReviewRow label="Cover" value={media[0].uri.slice(0, 40) + '...'} />}
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Pricing</Text>
          <ReviewRow label="Retail" value={priceStr ? `$${priceStr}` : '—'} />
          <ReviewRow label="Cost" value={costStr ? `$${costStr}` : '—'} />
          <ReviewRow label="Net margin" value={pricing.marginPercent !== undefined ? `${pricing.marginPercent.toFixed(1)}%` : '—'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Variants</Text>
          <ReviewRow label="Options" value={localOptions.length > 0 ? localOptions.map(o => o.name).join(', ') : 'None'} />
          <ReviewRow label="Variants" value={localVariants.length > 0 ? `${localVariants.length} variants` : 'None generated'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Inventory</Text>
          <ReviewRow label="Track inventory" value={trackInventory ? 'Yes' : 'No'} />
          <ReviewRow label="Current stock" value={stockStr || '0'} />
          <ReviewRow label="Allow overselling" value={allowOversell ? 'Yes' : 'No'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Sales model</Text>
          <ReviewRow label="Model" value={draftData.salesModel ?? 'pre-made'} />
          {(draftData.salesModel === 'pre-order' || draftData.salesModel === 'both') && (
            <>
              <ReviewRow label="Opens" value={draftData.preorderSettings?.openDate ?? '—'} />
              <ReviewRow label="Closes" value={draftData.preorderSettings?.closeDate ?? '—'} />
            </>
          )}
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Fulfillment</Text>
          <ReviewRow label="Type" value={ff.type} />
          <ReviewRow label="Weight" value={ff.weightGrams ? `${ff.weightGrams}g` : '—'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Manufacturing</Text>
          <ReviewRow label="Stage" value={mfgMode === 'quote' ? 'Quote requested' : mfgMode === 'existing' ? `Assigned: ${mfgName || '—'}` : 'None'} />
        </BrandthreadCard>

        <BrandthreadCard style={s.reviewCard}>
          <Text style={s.reviewSection}>Storefront</Text>
          <ReviewRow label="Status" value={ss.status} />
          <ReviewRow label="SEO title" value={seo.title || '—'} />
          <ReviewRow label="Featured" value={featuredHome ? 'Yes' : 'No'} />
        </BrandthreadCard>

        {warnings.length > 0 && (
          <BrandthreadCard style={[s.reviewCard, { borderColor: RED + '55' }]}>
            <Text style={[s.reviewSection, { color: RED }]}>Warnings</Text>
            {warnings.map((w, i) => (
              <View key={i} style={s.warningRow}>
                <Feather name="alert-circle" size={14} color={RED} />
                <Text style={s.warningText}>{w}</Text>
              </View>
            ))}
          </BrandthreadCard>
        )}

        <View style={s.publishButtons}>
          <SecondaryButton
            label="Save draft"
            onPress={handleSaveDraft}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Publish"
            onPress={handlePublish}
            style={{ flex: 1 }}
          />
          <SecondaryButton
            label="Schedule"
            onPress={() => Alert.alert('Schedule', 'Scheduling coming soon')}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  function renderCurrentStep() {
    switch (step) {
      case 1:  return renderStep1();
      case 2:  return renderStep2();
      case 3:  return renderStep3();
      case 4:  return renderStep4();
      case 5:  return renderStep5();
      case 6:  return renderStep6();
      case 7:  return renderStep7();
      case 8:  return renderStep8();
      case 9:  return renderStep9();
      case 10: return renderStep10();
      default: return null;
    }
  }

  const progressPct = (step / 10) * 100;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── Fixed header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={handleExit} style={s.headerBack}>
          <Feather name="x" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.stepIndicator}>Step {step} of 10</Text>
          <Text style={s.stepTitle}>{STEP_TITLES[step - 1]}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveDraft} style={s.headerSave}>
          <Text style={s.headerSaveText}>Save draft</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ── */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${progressPct}%` }]} />
      </View>

      {/* ── Step content ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={s.scrollView}
          contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderCurrentStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Bottom nav ── */}
      <View style={[s.bottomNav, { paddingBottom: insets.bottom + SP.sm }]}>
        {step > 1 ? (
          <SecondaryButton label="Back" onPress={goBack} style={s.navBack} />
        ) : (
          <View style={s.navBack} />
        )}
        <PrimaryButton
          label={step === 10 ? 'Publish' : 'Next'}
          onPress={goNext}
          style={s.navNext}
        />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    minHeight: COMP.headerH,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  stepIndicator: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  stepTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  headerSave: {
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  headerSaveText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  progressTrack: {
    height: 4,
    backgroundColor: BORDER,
  },
  progressFill: {
    height: 4,
    backgroundColor: PURPLE,
    borderRadius: RADIUS.pill,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SP.md,
  },
  stepContent: {
    paddingHorizontal: SP.md,
    gap: SP.md,
  },
  sectionHdr: {
    paddingHorizontal: 0,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  // Media
  uploadZone: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadInner: {
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.lg,
  },
  uploadLabel: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  uploadHint: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  mediaThumbnail: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    position: 'relative',
  },
  mediaThumbImg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },
  // Pricing
  pricingCard: {
    gap: SP.sm,
  },
  pricingTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: SP.xs,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pricingLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  pricingValue: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  // Options
  optionCard: {
    gap: SP.sm,
  },
  optionLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  valueDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: BORDER,
  },
  valueChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
  },
  customValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    height: COMP.inputH,
  },
  customValueInput: {
    flex: 1,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },
  customValueAdd: {
    padding: SP.xs,
  },
  deleteOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    alignSelf: 'flex-start',
    marginTop: SP.xs,
  },
  deleteOptionText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: RED,
  },
  variantCount: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
    textAlign: 'center',
    marginTop: SP.xs,
  },
  variantRow: {
    gap: SP.sm,
  },
  variantTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  variantFields: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  variantInput: {
    flex: 1,
    height: 40,
    backgroundColor: SURFACE,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
  },
  // Inventory
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    height: COMP.inputH,
  },
  switchLabel: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: FG,
  },
  variantQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    height: COMP.inputH,
  },
  variantQtyLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
    flex: 1,
  },
  variantQtyInput: {
    width: 80,
    height: 36,
    backgroundColor: SURFACE,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    textAlign: 'right',
  },
  // Model cards
  modelCard: {
    gap: SP.xs,
  },
  modelCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modelTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  modelDesc: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 18,
  },
  // Review
  reviewCard: {
    gap: SP.xs,
  },
  reviewSection: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SP.xs,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  reviewLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  reviewValue: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
    maxWidth: '60%',
    textAlign: 'right',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.xs,
    paddingVertical: 2,
  },
  warningText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: RED,
    flex: 1,
    lineHeight: 18,
  },
  publishButtons: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.sm,
  },
  // Bottom nav
  bottomNav: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  navBack: {
    flex: 1,
  },
  navNext: {
    flex: 2,
  },
});
