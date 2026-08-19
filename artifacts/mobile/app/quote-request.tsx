/**
 * Quote Request — 5-step flow
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_LIGHT,
  SUCCESS, BLUE, ORANGE, RED, GOLD, ON_DARK, GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
} from '@/lib/theme';

import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  FilterChip, StatusBadge, SectionHeader, FormInput, EmptyState,
} from '@/components/BrandthreadUI';

import {
  getManufacturer, saveQuoteRequestDraft, submitQuoteRequest, getQuoteRequest,
} from '@/services/manufacturerService';

import { QuoteRequest, Manufacturer } from '@/services/manufacturerTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_TITLES = [
  'Select Product',
  'Production Details',
  'Materials & Variants',
  'Files',
  'Review & Submit',
];

const TOTAL_STEPS = STEP_TITLES.length;

const MATERIAL_OPTIONS = ['Cotton', 'Poly/Cotton', 'Fleece', 'Denim', 'Nylon', 'Recycled Cotton', 'Other'];
const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PRINT_METHODS = ['Screen Print', 'DTG', 'DTF', 'Embroidery', 'Heat Transfer', 'None'];
const PRODUCTION_TYPES = ['Standard', 'Rush', 'Custom'];

const FILE_TYPES = [
  { key: 'tech_pack', label: 'Tech Pack', icon: 'file-text' as const },
  { key: 'design', label: 'Design Files', icon: 'pen-tool' as const },
  { key: 'measurement', label: 'Measurements', icon: 'maximize' as const },
  { key: 'mockup', label: 'Mockups', icon: 'image' as const },
  { key: 'reference', label: 'Reference Images', icon: 'camera' as const },
];

function uid() { return Math.random().toString(36).slice(2, 11); }

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = ((step - 1) / (total - 1)) * 100;
  return (
    <View style={pb.wrap}>
      <View style={pb.track}>
        <LinearGradient
          colors={GRAD_PRIMARY}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[pb.fill, { width: `${pct}%` }]}
        />
      </View>
      <Text style={pb.label}>Step {step} of {total}: {STEP_TITLES[step - 1]}</Text>
    </View>
  );
}

const pb = StyleSheet.create({
  wrap:  { paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.xs },
  track: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: RADIUS.pill },
  label: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});

// ─── Toggle Row ───────────────────────────────────────────────────────────────

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={tr.row}>
      <Text style={tr.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: BORDER, true: PURPLE_DIM }}
        thumbColor={value ? PURPLE_LIGHT : SUBTLE}
      />
    </View>
  );
}

const tr = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm },
  label: { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function QuoteRequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { manufacturerId, productId, requestId } = useLocalSearchParams<{
    manufacturerId?: string;
    productId?: string;
    requestId?: string;
  }>();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const draftId = useRef<string>('qr_' + uid());

  // Step 1
  const [productSource, setProductSource] = useState<'existing' | 'draft' | 'new'>('existing');
  const [productName, setProductName] = useState('');

  // Step 2
  const [quantity, setQuantity] = useState('100');
  const [targetUnitPrice, setTargetUnitPrice] = useState('');
  const [neededByDate, setNeededByDate] = useState('');
  const [productionType, setProductionType] = useState('Standard');
  const [sampleRequired, setSampleRequired] = useState(true);
  const [packagingRequirements, setPackagingRequirements] = useState('');
  const [shippingDestination, setShippingDestination] = useState('');

  // Step 3
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [colorwayInput, setColorwayInput] = useState('');
  const [colorways, setColorways] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [printMethod, setPrintMethod] = useState('Screen Print');
  const [hasEmbroidery, setHasEmbroidery] = useState(false);
  const [hasWash, setHasWash] = useState(false);
  const [hasHardware, setHasHardware] = useState(false);
  const [hasLabels, setHasLabels] = useState(false);
  const [customPackaging, setCustomPackaging] = useState(false);

  // Step 4
  const [addedFiles, setAddedFiles] = useState<string[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load manufacturer
  useEffect(() => {
    if (manufacturerId) {
      getManufacturer(manufacturerId).then(m => setManufacturer(m ?? null));
    }
  }, [manufacturerId]);

  // Resume draft
  useEffect(() => {
    if (requestId) {
      getQuoteRequest(requestId).then(qr => {
        if (!qr) return;
        draftId.current = qr.id;
        setProductName(qr.productName);
        setQuantity(qr.quantity.toString());
        setTargetUnitPrice(qr.targetUnitPrice?.toString() ?? '');
        setNeededByDate(qr.neededByDate ?? '');
        setProductionType(qr.productionType ?? 'Standard');
        setSampleRequired(qr.sampleRequired);
        setPackagingRequirements(qr.packagingRequirements ?? '');
        setShippingDestination(qr.shippingDestination ?? '');
        setSelectedMaterials(qr.materials);
        setColorways(qr.colorways);
        setSelectedSizes(qr.sizes);
        setPrintMethod(qr.printMethod ?? 'Screen Print');
        setHasEmbroidery(qr.hasEmbroidery);
        setHasWash(qr.hasWash);
        setHasHardware(qr.hasHardware);
        setHasLabels(qr.hasLabels);
        setCustomPackaging(qr.customPackaging);
        setStep(qr.currentStep);
      });
    }
  }, [requestId]);

  // Auto-save draft every 2s
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!manufacturerId && !requestId) return;
      const mfgId = manufacturerId ?? 'mfg_unknown';
      const name = productName.trim() || 'Untitled Product';
      saveQuoteRequestDraft({
        id: draftId.current,
        manufacturerId: mfgId,
        productName: name,
        productId,
        quantity: parseInt(quantity) || 100,
        targetUnitPrice: parseFloat(targetUnitPrice) || undefined,
        neededByDate: neededByDate || undefined,
        productionType,
        sampleRequired,
        packagingRequirements: packagingRequirements || undefined,
        shippingDestination: shippingDestination || undefined,
        materials: selectedMaterials,
        colorways,
        sizes: selectedSizes,
        printMethod,
        hasEmbroidery,
        hasWash,
        hasHardware,
        hasLabels,
        customPackaging,
        currentStep: step,
      }).then(qr => { draftId.current = qr.id; });
    }, 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [
    productName, quantity, targetUnitPrice, neededByDate, productionType,
    sampleRequired, packagingRequirements, shippingDestination,
    selectedMaterials, colorways, selectedSizes, printMethod,
    hasEmbroidery, hasWash, hasHardware, hasLabels, customPackaging, step,
  ]);

  function handleExit() {
    Alert.alert('Exit quote request?', 'Your progress will be auto-saved as a draft.', [
      { text: 'Save & Exit', onPress: () => router.back() },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleSaveDraft() {
    Alert.alert('Draft saved', 'You can resume this quote request from the Manufacturer Hub.');
    router.back();
  }

  function goNext() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < TOTAL_STEPS) setStep(s => s + 1);
  }

  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step > 1) setStep(s => s - 1);
  }

  function toggleMaterial(mat: string) {
    setSelectedMaterials(prev =>
      prev.includes(mat) ? prev.filter(m => m !== mat) : [...prev, mat]
    );
  }

  function toggleSize(size: string) {
    setSelectedSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  }

  function addColorway() {
    const c = colorwayInput.trim();
    if (!c) return;
    setColorways(prev => [...prev, c]);
    setColorwayInput('');
  }

  function removeColorway(c: string) {
    setColorways(prev => prev.filter(x => x !== c));
  }

  async function handleSubmit() {
    if (submitting) return;
    const warnings: string[] = [];
    if (!productName.trim()) warnings.push('Product name is required');
    if (!parseInt(quantity)) warnings.push('Quantity must be greater than 0');
    if (warnings.length > 0) {
      Alert.alert('Review required', warnings.map(w => '• ' + w).join('\n'));
      return;
    }
    setSubmitting(true);
    try {
      // Ensure draft exists first
      const mfgId = manufacturerId ?? 'mfg_unknown';
      const qr = await saveQuoteRequestDraft({
        id: draftId.current,
        manufacturerId: mfgId,
        productName: productName.trim(),
        quantity: parseInt(quantity) || 100,
        materials: selectedMaterials,
        colorways,
        sizes: selectedSizes,
        hasEmbroidery,
        hasWash,
        hasHardware,
        hasLabels,
        customPackaging,
        currentStep: 5,
      });
      await submitQuoteRequest(qr.id);
      Alert.alert(
        'Quote Request Sent! 🎉',
        'Your request has been submitted. The manufacturer will respond within their stated response time.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to submit quote request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step renderers ────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <View style={sc.stepContent}>
        <Text style={sc.stepHeadline}>Which product is this quote for?</Text>

        {/* Manufacturer info */}
        {manufacturer && (
          <GradientCard colors={GRAD_CARD_GLOW} style={sc.mfgCard}>
            <View style={sc.mfgCardRow}>
              <Feather name="settings" size={ICON.md} color={PURPLE_LIGHT} />
              <View>
                <Text style={sc.mfgCardLabel}>For manufacturer</Text>
                <Text style={sc.mfgCardName}>{manufacturer.name}</Text>
              </View>
            </View>
          </GradientCard>
        )}

        {/* Product source radio cards */}
        {(['existing', 'draft', 'new'] as const).map(src => {
          const labels = {
            existing: { title: 'Existing product', desc: 'Select from your active products' },
            draft: { title: 'Draft product', desc: 'Select from your draft products' },
            new: { title: 'New product placeholder', desc: 'Quote for a product you\'re planning' },
          };
          const active = productSource === src;
          return (
            <TouchableOpacity
              key={src}
              onPress={() => { setProductSource(src); Haptics.selectionAsync(); }}
              style={[sc.radioCard, active && sc.radioCardActive]}
              activeOpacity={0.8}
            >
              <View style={[sc.radioCircle, active && sc.radioCircleActive]}>
                {active && <View style={sc.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sc.radioTitle, active && { color: PURPLE_LIGHT }]}>{labels[src].title}</Text>
                <Text style={sc.radioDesc}>{labels[src].desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <FormInput
          label="Product name *"
          value={productName}
          onChange={setProductName}
          placeholder="e.g. Classic Heavyweight Hoodie"
        />
      </View>
    );
  }

  function renderStep2() {
    return (
      <View style={sc.stepContent}>
        <Text style={sc.stepHeadline}>Production details</Text>

        <FormInput label="Quantity *" value={quantity} onChange={setQuantity}
          placeholder="e.g. 500" keyboardType="numeric" />

        <FormInput label="Target unit price ($)" value={targetUnitPrice} onChange={setTargetUnitPrice}
          placeholder="e.g. 18.00" keyboardType="decimal-pad" />

        <FormInput label="Needed by date (YYYY-MM-DD)" value={neededByDate} onChange={setNeededByDate}
          placeholder="e.g. 2025-06-01" />

        <View style={sc.fieldGroup}>
          <Text style={sc.fieldLabel}>Production type</Text>
          <View style={sc.chipRow}>
            {PRODUCTION_TYPES.map(t => (
              <FilterChip key={t} label={t} active={productionType === t} onPress={() => setProductionType(t)} />
            ))}
          </View>
        </View>

        <ToggleRow label="Sample required" value={sampleRequired} onChange={setSampleRequired} />

        <FormInput label="Packaging requirements" value={packagingRequirements}
          onChange={setPackagingRequirements} placeholder="Describe packaging needs..." multiline />

        <FormInput label="Shipping destination" value={shippingDestination}
          onChange={setShippingDestination} placeholder="e.g. Los Angeles, CA, USA" />
      </View>
    );
  }

  function renderStep3() {
    return (
      <View style={sc.stepContent}>
        <Text style={sc.stepHeadline}>Materials & variants</Text>

        <View style={sc.fieldGroup}>
          <Text style={sc.fieldLabel}>Material (select all that apply)</Text>
          <View style={sc.chipRow}>
            {MATERIAL_OPTIONS.map(mat => (
              <FilterChip key={mat} label={mat} active={selectedMaterials.includes(mat)} onPress={() => toggleMaterial(mat)} />
            ))}
          </View>
        </View>

        <View style={sc.fieldGroup}>
          <Text style={sc.fieldLabel}>Colorways</Text>
          <View style={sc.colorwayInput}>
            <FormInput
              value={colorwayInput}
              onChange={setColorwayInput}
              placeholder="e.g. Black, Navy Blue..."
              style={{ flex: 1 }}
            />
            <TouchableOpacity onPress={addColorway} style={sc.addBtn}>
              <Feather name="plus" size={ICON.sm} color={ON_DARK} />
            </TouchableOpacity>
          </View>
          {colorways.length > 0 && (
            <View style={sc.chipRow}>
              {colorways.map(c => (
                <TouchableOpacity key={c} onPress={() => removeColorway(c)} style={sc.tagChip}>
                  <Text style={sc.tagChipText}>{c}</Text>
                  <Feather name="x" size={10} color={PURPLE_LIGHT} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={sc.fieldGroup}>
          <Text style={sc.fieldLabel}>Sizes</Text>
          <View style={sc.chipRow}>
            {SIZE_PRESETS.map(sz => (
              <FilterChip key={sz} label={sz} active={selectedSizes.includes(sz)} onPress={() => toggleSize(sz)} />
            ))}
          </View>
        </View>

        <View style={sc.fieldGroup}>
          <Text style={sc.fieldLabel}>Print method</Text>
          <View style={sc.chipRow}>
            {PRINT_METHODS.map(pm => (
              <FilterChip key={pm} label={pm} active={printMethod === pm} onPress={() => setPrintMethod(pm)} />
            ))}
          </View>
        </View>

        <View style={sc.toggleSection}>
          <Text style={sc.fieldLabel}>Add-ons</Text>
          <ToggleRow label="Embroidery" value={hasEmbroidery} onChange={setHasEmbroidery} />
          <ToggleRow label="Wash treatment" value={hasWash} onChange={setHasWash} />
          <ToggleRow label="Hardware" value={hasHardware} onChange={setHasHardware} />
          <ToggleRow label="Labels" value={hasLabels} onChange={setHasLabels} />
          <ToggleRow label="Custom packaging" value={customPackaging} onChange={setCustomPackaging} />
        </View>
      </View>
    );
  }

  function renderStep4() {
    return (
      <View style={sc.stepContent}>
        <Text style={sc.stepHeadline}>Attach files</Text>
        <Text style={sc.stepSubheadline}>Attach design files, tech packs, or reference images for your manufacturer.</Text>

        <View style={sc.fileGrid}>
          {FILE_TYPES.map(ft => {
            const added = addedFiles.includes(ft.key);
            return (
              <BrandthreadCard key={ft.key} style={sc.fileCard}>
                <View style={[sc.fileIconWrap, added && { backgroundColor: 'rgba(139,92,246,0.18)' }]}>
                  <Feather name={ft.icon} size={ICON.lg} color={added ? PURPLE_LIGHT : MUTED} />
                </View>
                <Text style={sc.fileLabel}>{ft.label}</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (added) return;
                    Alert.alert('Add File', 'File upload will be available in the next release.');
                    setAddedFiles(prev => [...prev, ft.key]);
                  }}
                  style={[sc.addFileBtn, added && sc.addFileBtnDone]}
                >
                  <Text style={[sc.addFileBtnText, added && { color: SUCCESS }]}>
                    {added ? 'Added ✓' : 'Add'}
                  </Text>
                </TouchableOpacity>
              </BrandthreadCard>
            );
          })}
        </View>

        {addedFiles.length > 0 && (
          <BrandthreadCard style={sc.addedFilesCard}>
            <Text style={sc.addedFilesTitle}>Files added ({addedFiles.length})</Text>
            {addedFiles.map(key => {
              const ft = FILE_TYPES.find(f => f.key === key);
              return (
                <View key={key} style={sc.addedFileRow}>
                  <Feather name="file" size={ICON.sm} color={SUCCESS} />
                  <Text style={sc.addedFileName}>{ft?.label ?? key}</Text>
                </View>
              );
            })}
          </BrandthreadCard>
        )}
      </View>
    );
  }

  function renderStep5() {
    const warnings: string[] = [];
    if (!productName.trim()) warnings.push('Product name is required');
    if (!parseInt(quantity)) warnings.push('Quantity must be greater than 0');

    return (
      <View style={sc.stepContent}>
        <Text style={sc.stepHeadline}>Review & submit</Text>

        {warnings.length > 0 && (
          <GradientCard colors={['rgba(248,113,113,0.12)', 'rgba(248,113,113,0.04)'] as const} style={sc.warningCard}>
            <View style={sc.warningRow}>
              <Feather name="alert-triangle" size={ICON.md} color={RED} />
              <Text style={sc.warningTitle}>Please review</Text>
            </View>
            {warnings.map(w => (
              <Text key={w} style={sc.warningItem}>• {w}</Text>
            ))}
          </GradientCard>
        )}

        {manufacturer && (
          <BrandthreadCard>
            <Text style={sc.summarySection}>Manufacturer</Text>
            <Text style={sc.summaryValue}>{manufacturer.name} — {manufacturer.city}, {manufacturer.country}</Text>
          </BrandthreadCard>
        )}

        <BrandthreadCard style={sc.summaryCard}>
          <Text style={sc.summarySection}>Product</Text>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Name</Text>
            <Text style={sc.summaryValue}>{productName || '—'}</Text>
          </View>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Source</Text>
            <Text style={sc.summaryValue}>{productSource}</Text>
          </View>
        </BrandthreadCard>

        <BrandthreadCard style={sc.summaryCard}>
          <Text style={sc.summarySection}>Production</Text>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Quantity</Text>
            <Text style={sc.summaryValue}>{quantity}</Text>
          </View>
          {targetUnitPrice ? (
            <View style={sc.summaryRow}>
              <Text style={sc.summaryLabel}>Target price</Text>
              <Text style={sc.summaryValue}>${targetUnitPrice}/unit</Text>
            </View>
          ) : null}
          {neededByDate ? (
            <View style={sc.summaryRow}>
              <Text style={sc.summaryLabel}>Needed by</Text>
              <Text style={sc.summaryValue}>{neededByDate}</Text>
            </View>
          ) : null}
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Type</Text>
            <Text style={sc.summaryValue}>{productionType}</Text>
          </View>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Sample required</Text>
            <Text style={sc.summaryValue}>{sampleRequired ? 'Yes' : 'No'}</Text>
          </View>
        </BrandthreadCard>

        <BrandthreadCard style={sc.summaryCard}>
          <Text style={sc.summarySection}>Materials & Variants</Text>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Materials</Text>
            <Text style={sc.summaryValue}>{selectedMaterials.join(', ') || '—'}</Text>
          </View>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Colorways</Text>
            <Text style={sc.summaryValue}>{colorways.join(', ') || '—'}</Text>
          </View>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Sizes</Text>
            <Text style={sc.summaryValue}>{selectedSizes.join(', ') || '—'}</Text>
          </View>
          <View style={sc.summaryRow}>
            <Text style={sc.summaryLabel}>Print method</Text>
            <Text style={sc.summaryValue}>{printMethod}</Text>
          </View>
        </BrandthreadCard>

        {addedFiles.length > 0 && (
          <BrandthreadCard style={sc.summaryCard}>
            <Text style={sc.summarySection}>Files ({addedFiles.length} attached)</Text>
            {addedFiles.map(key => {
              const ft = FILE_TYPES.find(f => f.key === key);
              return (
                <View key={key} style={sc.summaryRow}>
                  <Feather name="file" size={12} color={SUCCESS} />
                  <Text style={sc.summaryValue}>{ft?.label ?? key}</Text>
                </View>
              );
            })}
          </BrandthreadCard>
        )}

        <View style={sc.submitBtns}>
          <SecondaryButton label="Save Draft" onPress={handleSaveDraft} style={{ flex: 1 }} />
          <PrimaryButton
            label="Submit Request"
            onPress={handleSubmit}
            loading={submitting}
            disabled={warnings.length > 0}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5][step - 1];

  return (
    <KeyboardAvoidingView
      style={[sc.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={sc.header}>
        <TouchableOpacity onPress={handleExit} style={sc.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={sc.headerTitle}>Quote Request</Text>
        <TouchableOpacity onPress={handleSaveDraft} style={sc.saveDraftBtn}>
          <Text style={sc.saveDraftText}>Save draft</Text>
        </TouchableOpacity>
      </View>

      <ProgressBar step={step} total={TOTAL_STEPS} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {stepContent?.()}
      </ScrollView>

      {/* Bottom nav */}
      <View style={[sc.bottomNav, { paddingBottom: insets.bottom + SP.sm }]}>
        <SecondaryButton
          label="Back"
          onPress={goBack}
          disabled={step === 1}
          style={{ flex: 1 }}
        />
        {step < TOTAL_STEPS ? (
          <PrimaryButton label="Next" onPress={goNext} style={{ flex: 2 }} />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sc = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    minHeight: COMP.headerH,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.md, fontFamily: FONT.bold, color: FG,
  },
  saveDraftBtn: {
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  saveDraftText: {
    fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT,
  },
  stepContent: {
    padding: SP.md, gap: SP.md,
  },
  stepHeadline: {
    fontSize: FS.lg, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3,
  },
  stepSubheadline: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  mfgCard: {
    padding: SP.md,
  },
  mfgCardRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  mfgCardLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED,
  },
  mfgCardName: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE_LIGHT,
  },
  radioCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: BORDER, padding: SP.md,
  },
  radioCardActive: {
    borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM,
  },
  radioCircle: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: PURPLE_LIGHT,
  },
  radioDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE_LIGHT,
  },
  radioTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: FG,
  },
  radioDesc: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  fieldGroup: {
    gap: SP.sm,
  },
  fieldLabel: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.2,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  colorwayInput: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm,
  },
  addBtn: {
    width: COMP.buttonHSm, height: COMP.buttonHSm,
    borderRadius: RADIUS.md, backgroundColor: PURPLE,
    alignItems: 'center', justifyContent: 'center',
  },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  tagChipText: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT,
  },
  toggleSection: {
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, gap: 0,
  },
  fileGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  fileCard: {
    width: '46%', alignItems: 'center', gap: SP.sm, padding: SP.md,
  },
  fileIconWrap: {
    width: 56, height: 56, borderRadius: RADIUS.md,
    backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center',
  },
  fileLabel: {
    fontSize: FS.sm, fontFamily: FONT.medium, color: FG, textAlign: 'center',
  },
  addFileBtn: {
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
  },
  addFileBtnDone: {
    borderColor: SUCCESS,
  },
  addFileBtnText: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED,
  },
  addedFilesCard: {
    gap: SP.sm,
  },
  addedFilesTitle: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: FG,
  },
  addedFileRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  addedFileName: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  warningCard: {
    gap: SP.sm, padding: SP.md,
  },
  warningRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  warningTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: RED,
  },
  warningItem: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: RED,
  },
  summaryCard: {
    gap: SP.sm,
  },
  summarySection: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.xs,
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  summaryValue: {
    fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flex: 1, textAlign: 'right',
  },
  submitBtns: {
    flexDirection: 'row', gap: SP.sm, marginTop: SP.sm,
  },
  bottomNav: {
    flexDirection: 'row', gap: SP.sm,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
});
