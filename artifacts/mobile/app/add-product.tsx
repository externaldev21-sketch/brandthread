import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  TextInput, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const RED    = '#EF4444';

// ─── Steps ────────────────────────────────────────────────────────────────────
const STEPS = [
  { label: 'Basic Info',  icon: 'type'        as const },
  { label: 'Media',       icon: 'image'       as const },
  { label: 'Pricing',     icon: 'dollar-sign' as const },
  { label: 'Variants',    icon: 'layers'      as const },
  { label: 'Inventory',   icon: 'box'         as const },
  { label: 'Fulfillment', icon: 'truck'       as const },
  { label: 'Sales Model', icon: 'tag'         as const },
  { label: 'Visibility',  icon: 'eye'         as const },
  { label: 'Review',      icon: 'check-circle'as const },
];

const CATEGORIES = ['Tops', 'Bottoms', 'Outerwear', 'Accessories', 'Footwear', 'Bags'];
const PRODUCT_TYPES = ['T-Shirt', 'Hoodie', 'Sweatpants', 'Jacket', 'Tank', 'Crewneck', 'Shorts', 'Cap', 'Bag'];
const SIZES   = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'];
const COLORS  = ['Black', 'White', 'Navy', 'Grey', 'Olive', 'Sage', 'Cream', 'Slate', 'Red'];
const SHIPPING_PROFILES = ['Standard Shipping', 'Free Shipping', 'Express Shipping', 'Custom'];

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormData {
  name:         string;
  description:  string;
  category:     string;
  productType:  string;
  vendor:       string;
  tags:         string;
  price:        string;
  compareAt:    string;
  cost:         string;
  sizes:        string[];
  colors:       string[];
  trackQty:     boolean;
  sku:          string;
  inventory:    string;
  lowStock:     string;
  weight:       string;
  shippingProfile: string;
  fulfillment:  'seller' | 'manufacturer';
  salesModel:   'pre-made' | 'pre-order' | 'both';
  status:       'active' | 'draft' | 'scheduled';
  seoTitle:     string;
  seoDesc:      string;
}

const DEFAULT_FORM: FormData = {
  name: '', description: '', category: '', productType: '', vendor: '', tags: '',
  price: '', compareAt: '', cost: '',
  sizes: [], colors: [],
  trackQty: true, sku: '', inventory: '', lowStock: '10',
  weight: '', shippingProfile: 'Standard Shipping', fulfillment: 'seller',
  salesModel: 'pre-made',
  status: 'draft', seoTitle: '', seoDesc: '',
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AddProductScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [step,    setStep]    = useState(0);
  const [form,    setForm]    = useState<FormData>(DEFAULT_FORM);

  function back()  { step > 0 ? setStep(s => s - 1) : router.back(); }
  function next()  {
    if (step < STEPS.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(s => s + 1);
    } else {
      publish();
    }
  }
  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }
  function toggleArray<K extends keyof FormData>(key: K, value: string) {
    const arr = form[key] as string[];
    set(key, (arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]) as FormData[K]);
  }

  function publish() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Product Saved', `"${form.name || 'New Product'}" has been saved as a ${form.status}.`, [
      { text: 'View Products', onPress: () => router.back() },
    ]);
  }

  const margin = parseFloat(form.price || '0') - parseFloat(form.cost || '0');
  const marginPct = parseFloat(form.price || '0') > 0
    ? Math.round((margin / parseFloat(form.price)) * 100)
    : 0;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={back}>
          <Feather name={step === 0 ? 'x' : 'arrow-left'} size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Add Product</Text>
        <TouchableOpacity style={s.draftBtn} onPress={() => { set('status', 'draft'); publish(); }}>
          <Text style={s.draftText}>Save Draft</Text>
        </TouchableOpacity>
      </View>

      {/* Step progress */}
      <View style={s.progressWrap}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` as any }]} />
        </View>
        <Text style={s.stepLabel}>{STEPS[step].label} · Step {step + 1} of {STEPS.length}</Text>
      </View>

      {/* Step tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll}>
        <View style={s.tabRow}>
          {STEPS.map((st, i) => (
            <TouchableOpacity
              key={st.label}
              style={[s.stepTab, i === step && s.stepTabActive, i < step && s.stepTabDone]}
              onPress={() => setStep(i)}
              activeOpacity={0.8}
            >
              <Feather
                name={i < step ? 'check' : st.icon}
                size={12}
                color={i === step ? '#0A0B0A' : i < step ? GREEN : MUTED}
              />
              <Text style={[s.stepTabText, i === step && s.stepTabTextActive, i < step && { color: GREEN }]}>
                {st.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>

        {/* ── Step 0: Basic Info ── */}
        {step === 0 && (
          <View style={s.stepContent}>
            <StepTitle title="Basic information" desc="Start with the core product details." />
            <FormField label="Product name *" placeholder="e.g. Vintage Washed Tee" value={form.name} onChange={v => set('name', v)} />
            <FormField label="Description" placeholder="Describe your product…" value={form.description} onChange={v => set('description', v)} multiline />
            <Label text="Category" />
            <View style={s.chipGrid}>
              {CATEGORIES.map(c => (
                <Chip key={c} label={c} active={form.category === c} onPress={() => set('category', c)} />
              ))}
            </View>
            <Label text="Product type" />
            <View style={s.chipGrid}>
              {PRODUCT_TYPES.map(t => (
                <Chip key={t} label={t} active={form.productType === t} onPress={() => set('productType', t)} />
              ))}
            </View>
            <FormField label="Vendor" placeholder="e.g. Ace Apparel Co." value={form.vendor} onChange={v => set('vendor', v)} />
            <FormField label="Tags (comma separated)" placeholder="streetwear, tee, drop" value={form.tags} onChange={v => set('tags', v)} />
          </View>
        )}

        {/* ── Step 1: Media ── */}
        {step === 1 && (
          <View style={s.stepContent}>
            <StepTitle title="Product media" desc="Upload photos and videos of your product." />
            <TouchableOpacity style={s.uploadZone} activeOpacity={0.8} onPress={() => {}}>
              <View style={s.uploadIcon}><Feather name="upload-cloud" size={28} color={MUTED} /></View>
              <Text style={s.uploadTitle}>Upload product images</Text>
              <Text style={s.uploadDesc}>JPG, PNG or WEBP · Up to 20MB each</Text>
              <View style={s.uploadBtn}><Text style={s.uploadBtnText}>Choose files</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.uploadZone, { marginTop: 12 }]} activeOpacity={0.8} onPress={() => {}}>
              <View style={s.uploadIcon}><Feather name="video" size={24} color={MUTED} /></View>
              <Text style={s.uploadTitle}>Upload product video (optional)</Text>
              <Text style={s.uploadDesc}>MP4 · Up to 100MB</Text>
            </TouchableOpacity>
            <View style={[s.uploadZone, { marginTop: 12 }]}>
              <Feather name="zap" size={20} color={GREEN} style={{ marginBottom: 6 }} />
              <Text style={[s.uploadTitle, { color: FG }]}>Generate mockups with AI</Text>
              <Text style={s.uploadDesc}>Skip the photoshoot. Add a design and we'll generate realistic mockups.</Text>
              <TouchableOpacity style={[s.uploadBtn, { backgroundColor: GREEN }]} onPress={() => {}}>
                <Text style={[s.uploadBtnText, { color: '#0A0B0A' }]}>Generate Mockups</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 2: Pricing ── */}
        {step === 2 && (
          <View style={s.stepContent}>
            <StepTitle title="Pricing" desc="Set your retail price, cost and compare-at price." />
            <FormField label="Retail price *" placeholder="59.99" value={form.price} onChange={v => set('price', v)} keyboardType="decimal-pad" prefix="$" />
            <FormField label="Compare-at price" placeholder="79.99" value={form.compareAt} onChange={v => set('compareAt', v)} keyboardType="decimal-pad" prefix="$" />
            <FormField label="Product cost" placeholder="14.50" value={form.cost} onChange={v => set('cost', v)} keyboardType="decimal-pad" prefix="$" />
            {parseFloat(form.price) > 0 && parseFloat(form.cost) > 0 && (
              <View style={s.profitCard}>
                <View style={s.profitRow}>
                  <Text style={s.profitLabel}>Estimated profit per unit</Text>
                  <Text style={[s.profitValue, { color: GREEN }]}>${margin.toFixed(2)}</Text>
                </View>
                <View style={s.profitRow}>
                  <Text style={s.profitLabel}>Margin</Text>
                  <Text style={[s.profitValue, { color: marginPct >= 50 ? GREEN : marginPct >= 30 ? '#F97316' : RED }]}>{marginPct}%</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Step 3: Variants ── */}
        {step === 3 && (
          <View style={s.stepContent}>
            <StepTitle title="Variants" desc="Choose the sizes and colors you offer." />
            <Label text="Sizes" />
            <View style={s.chipGrid}>
              {SIZES.map(sz => (
                <Chip key={sz} label={sz} active={form.sizes.includes(sz)} onPress={() => toggleArray('sizes', sz)} />
              ))}
            </View>
            <Label text="Colors" />
            <View style={s.chipGrid}>
              {COLORS.map(c => (
                <Chip key={c} label={c} active={form.colors.includes(c)} onPress={() => toggleArray('colors', c)} />
              ))}
            </View>
            {form.sizes.length > 0 && form.colors.length > 0 && (
              <View style={s.variantPreview}>
                <Text style={s.profitLabel}>
                  {form.sizes.length * form.colors.length} variants will be created
                </Text>
                <Text style={s.uploadDesc}>You can set individual pricing and inventory per variant on the next steps.</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Step 4: Inventory ── */}
        {step === 4 && (
          <View style={s.stepContent}>
            <StepTitle title="Inventory" desc="Track your stock levels and set restock thresholds." />
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.toggleLabel}>Track quantity</Text>
                <Text style={s.toggleDesc}>Get alerts when stock runs low.</Text>
              </View>
              <TouchableOpacity
                style={[s.toggle, form.trackQty && s.toggleActive]}
                onPress={() => { set('trackQty', !form.trackQty); Haptics.selectionAsync(); }}
              >
                <View style={[s.toggleKnob, form.trackQty && s.toggleKnobActive]} />
              </TouchableOpacity>
            </View>
            {form.trackQty && (
              <>
                <FormField label="SKU" placeholder="VWT-BLK-M" value={form.sku} onChange={v => set('sku', v)} />
                <FormField label="Barcode (optional)" placeholder="012345678901" value={''} onChange={() => {}} />
                <FormField label="Current stock" placeholder="100" value={form.inventory} onChange={v => set('inventory', v)} keyboardType="number-pad" />
                <FormField label="Low-stock threshold" placeholder="10" value={form.lowStock} onChange={v => set('lowStock', v)} keyboardType="number-pad" />
              </>
            )}
          </View>
        )}

        {/* ── Step 5: Fulfillment ── */}
        {step === 5 && (
          <View style={s.stepContent}>
            <StepTitle title="Fulfillment" desc="Set shipping preferences and dimensions." />
            <FormField label="Weight (kg)" placeholder="0.35" value={form.weight} onChange={v => set('weight', v)} keyboardType="decimal-pad" />
            <Label text="Shipping profile" />
            <View style={s.chipGrid}>
              {SHIPPING_PROFILES.map(sp => (
                <Chip key={sp} label={sp} active={form.shippingProfile === sp} onPress={() => set('shippingProfile', sp)} />
              ))}
            </View>
            <Label text="Fulfilled by" />
            {(['seller', 'manufacturer'] as const).map(opt => (
              <TouchableOpacity
                key={opt}
                style={[s.radioRow, form.fulfillment === opt && s.radioRowActive]}
                onPress={() => { set('fulfillment', opt); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <View style={[s.radioCircle, form.fulfillment === opt && s.radioCircleActive]}>
                  {form.fulfillment === opt && <View style={s.radioInner} />}
                </View>
                <View>
                  <Text style={s.radioLabel}>{opt === 'seller' ? 'Seller (me)' : 'Manufacturer'}</Text>
                  <Text style={s.radioDesc}>{opt === 'seller' ? 'You ship directly to the customer.' : 'The manufacturer ships to the customer.'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Step 6: Sales model ── */}
        {step === 6 && (
          <View style={s.stepContent}>
            <StepTitle title="Sales model" desc="Choose how customers can purchase this product." />
            {(['pre-made', 'pre-order', 'both'] as const).map(model => (
              <TouchableOpacity
                key={model}
                style={[s.modelCard, form.salesModel === model && s.modelCardActive]}
                onPress={() => { set('salesModel', model); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <View style={s.modelTop}>
                  <Text style={s.modelTitle}>
                    {model === 'pre-made' ? 'Pre-made inventory' : model === 'pre-order' ? 'Pre-order' : 'Both'}
                  </Text>
                  {form.salesModel === model && <Feather name="check-circle" size={16} color={GREEN} />}
                </View>
                <Text style={s.modelDesc}>
                  {model === 'pre-made'  ? 'Ship from existing stock. Orders fulfilled immediately.' :
                   model === 'pre-order' ? 'Accept orders before production. Collect payments upfront.' :
                   'Offer both pre-made and pre-order options.'}
                </Text>
              </TouchableOpacity>
            ))}
            {(form.salesModel === 'pre-order' || form.salesModel === 'both') && (
              <>
                <FormField label="Pre-order opening date" placeholder="2026-07-01" value={''} onChange={() => {}} />
                <FormField label="Pre-order closing date" placeholder="2026-07-31" value={''} onChange={() => {}} />
                <FormField label="Minimum order quantity" placeholder="50" value={''} onChange={() => {}} keyboardType="number-pad" />
                <FormField label="Expected ship date" placeholder="2026-09-01" value={''} onChange={() => {}} />
              </>
            )}
          </View>
        )}

        {/* ── Step 7: Store visibility ── */}
        {step === 7 && (
          <View style={s.stepContent}>
            <StepTitle title="Store visibility" desc="Control when and how this product appears in your store." />
            <Label text="Status" />
            {(['active', 'draft', 'scheduled'] as const).map(st => (
              <TouchableOpacity
                key={st}
                style={[s.radioRow, form.status === st && s.radioRowActive]}
                onPress={() => { set('status', st); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <View style={[s.radioCircle, form.status === st && s.radioCircleActive]}>
                  {form.status === st && <View style={s.radioInner} />}
                </View>
                <View>
                  <Text style={s.radioLabel}>{st.charAt(0).toUpperCase() + st.slice(1)}</Text>
                  <Text style={s.radioDesc}>{
                    st === 'active' ? 'Visible in your store now.' :
                    st === 'draft'  ? 'Hidden from your store.' :
                    'Goes live on a scheduled date.'
                  }</Text>
                </View>
              </TouchableOpacity>
            ))}
            <FormField label="SEO title" placeholder={form.name || 'Product name for search engines'} value={form.seoTitle} onChange={v => set('seoTitle', v)} />
            <FormField label="SEO description" placeholder="Brief product summary for search results." value={form.seoDesc} onChange={v => set('seoDesc', v)} multiline />
          </View>
        )}

        {/* ── Step 8: Review ── */}
        {step === 8 && (
          <View style={s.stepContent}>
            <StepTitle title="Review & publish" desc="Check your product details before publishing." />
            {[
              { label: 'Name',       value: form.name        || '—' },
              { label: 'Category',   value: form.category    || '—' },
              { label: 'Type',       value: form.productType || '—' },
              { label: 'Price',      value: form.price ? `$${form.price}` : '—' },
              { label: 'Cost',       value: form.cost  ? `$${form.cost}`  : '—' },
              { label: 'Sizes',      value: form.sizes.join(', ') || '—' },
              { label: 'Colors',     value: form.colors.join(', ') || '—' },
              { label: 'Status',     value: form.status },
              { label: 'Sales model',value: form.salesModel },
              { label: 'Fulfillment',value: form.fulfillment },
            ].map(row => (
              <View key={row.label} style={s.reviewRow}>
                <Text style={s.reviewLabel}>{row.label}</Text>
                <Text style={s.reviewValue} numberOfLines={2}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Footer buttons */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step > 0 && (
          <TouchableOpacity style={s.prevBtn} onPress={back} activeOpacity={0.8}>
            <Feather name="arrow-left" size={16} color={FG} />
            <Text style={s.prevText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[s.nextBtn, { flex: step > 0 ? 0.65 : 1 }]} onPress={next} activeOpacity={0.85}>
          <LinearGradient colors={[GREEN, '#00C853']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.nextGrad}>
            <Text style={s.nextText}>{step === STEPS.length - 1 ? 'Publish Product' : 'Continue'}</Text>
            <Feather name={step === STEPS.length - 1 ? 'check' : 'arrow-right'} size={16} color="#0A0B0A" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StepTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={s.stepTitle}>{title}</Text>
      <Text style={s.stepDesc}>{desc}</Text>
    </View>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={s.label}>{text}</Text>;
}

function FormField({
  label, placeholder, value, onChange, multiline, keyboardType, prefix,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad'; prefix?: string;
}) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputWrap}>
        {prefix && <Text style={s.inputPrefix}>{prefix}</Text>}
        <TextInput
          style={[s.input, multiline && s.inputMulti]}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          value={value}
          onChangeText={onChange}
          multiline={multiline}
          keyboardType={keyboardType ?? 'default'}
        />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.chip, active && s.chipActive]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.8}
    >
      {active && <Feather name="check" size={10} color="#0A0B0A" style={{ marginRight: 3 }} />}
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn:{ width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  draftBtn:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER },
  draftText:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },

  progressWrap: { paddingHorizontal: 20, marginBottom: 4 },
  progressTrack:{ height: 2, backgroundColor: BORDER, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, backgroundColor: GREEN, borderRadius: 1 },
  stepLabel:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 6 },

  tabScroll: { flexGrow: 0, marginBottom: 4 },
  tabRow:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  stepTab:   { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: BORDER },
  stepTabActive: { backgroundColor: GREEN, borderColor: GREEN },
  stepTabDone:   { backgroundColor: GREEN + '15', borderColor: GREEN + '44' },
  stepTabText:   { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED },
  stepTabTextActive: { color: '#0A0B0A', fontFamily: 'Inter_700Bold' },

  stepContent: { gap: 16 },
  stepTitle:   { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.3 },
  stepDesc:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },

  fieldWrap: { gap: 6 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, letterSpacing: 0.2 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  inputPrefix:{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED, paddingLeft: 14 },
  input:     { flex: 1, paddingVertical: 13, paddingHorizontal: 14, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  inputMulti:{ height: 90, textAlignVertical: 'top', paddingTop: 13 },

  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:      { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: BORDER },
  chipActive:{ backgroundColor: GREEN, borderColor: GREEN },
  chipText:  { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextActive: { color: '#0A0B0A', fontFamily: 'Inter_700Bold' },

  profitCard: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 8 },
  profitRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  profitLabel:{ fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  profitValue:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },

  uploadZone: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', padding: 24, alignItems: 'center', gap: 8 },
  uploadIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  uploadTitle:{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED },
  uploadDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  uploadBtn:  { backgroundColor: CARD, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: BORDER, marginTop: 4 },
  uploadBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },

  variantPreview: { backgroundColor: BLUE + '15', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BLUE + '33', gap: 4 },

  toggleRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 12 },
  toggleLabel:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  toggleDesc:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  toggle:       { width: 44, height: 26, borderRadius: 13, backgroundColor: BORDER, padding: 3 },
  toggleActive: { backgroundColor: GREEN },
  toggleKnob:   { width: 20, height: 20, borderRadius: 10, backgroundColor: MUTED },
  toggleKnobActive: { backgroundColor: '#0A0B0A', transform: [{ translateX: 18 }] },

  radioRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14 },
  radioRowActive:{ borderColor: GREEN, backgroundColor: GREEN + '08' },
  radioCircle:   { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioCircleActive: { borderColor: GREEN },
  radioInner:    { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  radioLabel:    { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  radioDesc:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },

  modelCard:      { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 6 },
  modelCardActive:{ borderColor: GREEN, backgroundColor: GREEN + '08' },
  modelTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modelTitle:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  modelDesc:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },

  reviewRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  reviewValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG, flex: 1, textAlign: 'right' },

  footer:   { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', gap: 10 },
  prevBtn:  { flex: 0.32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: CARD, borderRadius: 14, paddingVertical: 15, borderWidth: 1, borderColor: BORDER },
  prevText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  nextBtn:  { borderRadius: 14, overflow: 'hidden' },
  nextGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, paddingHorizontal: 20 },
  nextText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
});
