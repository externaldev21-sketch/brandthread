/**
 * Manufacturer Onboarding — multi-step form
 * Manufacturers fill this out via an invite link to list on Brandthread
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';

const BG     = '#07070F';
const CARD   = '#12121F';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';
const ERR    = '#EF4444';

const STEPS = ['Account', 'Company', 'Specialties', 'Photos & Pricing', 'Review'];

const SPECIALTY_OPTIONS = [
  'T-Shirts', 'Hoodies', 'Sweatpants', 'Shorts', 'Jackets',
  'Denim', 'Knitwear', 'Activewear', 'Luxury / Tailoring',
  'Sustainable Fabrics', 'Embroidery', 'Screen Print',
  'DTF / DTG', 'Hats & Caps', 'Accessories',
];

const PRODUCTION_MODES = [
  'Screen Print', 'DTG', 'DTF', 'Embroidery',
  'Puff Print', 'Vinyl / HTV', 'Sublimation',
  'Rhinestones', 'Woven Labels', 'Distressed Print',
];

interface FormData {
  // Step 0 — Account
  email: string;
  password: string;
  confirmPassword: string;
  // Step 1 — Company
  companyName: string;
  country: string;
  city: string;
  website: string;
  phone: string;
  // Step 2 — Specialties
  specialties: string[];
  productionModes: string[];
  moq: string;
  leadTimeDays: string;
  // Step 3 — Photos & Pricing
  photos: string[];   // local URIs
  pricePerUnit: string;
  currency: string;
  sampleCost: string;
  // Review
  agreeTerms: boolean;
}

const INITIAL: FormData = {
  email: '', password: '', confirmPassword: '',
  companyName: '', country: '', city: '', website: '', phone: '',
  specialties: [], productionModes: [], moq: '', leadTimeDays: '',
  photos: [], pricePerUnit: '', currency: 'USD', sampleCost: '',
  agreeTerms: false,
};

export default function ManufacturerOnboardScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { token: inviteToken } = useLocalSearchParams<{ token?: string }>();
  const api     = useApi();
  const [step, setStep]   = useState(0);
  const [form, setForm]   = useState<FormData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function toggleArr(key: 'specialties' | 'productionModes', val: string) {
    haptic('light');
    setForm((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val] };
    });
  }

  function haptic(t: 'light' | 'medium' = 'medium') {
    Haptics.impactAsync(t === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to upload factory images.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, quality: 0.8 });
    if (!res.canceled) {
      set('photos', [...form.photos, ...res.assets.map((a) => a.uri)].slice(0, 8));
    }
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!form.email.includes('@')) return 'Enter a valid email address.';
      if (form.password.length < 8)   return 'Password must be at least 8 characters.';
      if (form.password !== form.confirmPassword) return 'Passwords do not match.';
    }
    if (step === 1) {
      if (!form.companyName.trim()) return 'Company name is required.';
      if (!form.country.trim())     return 'Country is required.';
      if (!form.city.trim())        return 'City is required.';
    }
    if (step === 2) {
      if (form.specialties.length === 0) return 'Select at least one specialty.';
      if (!form.moq.trim())              return 'Enter your minimum order quantity.';
    }
    if (step === 3) {
      if (!form.pricePerUnit.trim()) return 'Enter your price per unit.';
    }
    if (step === 4) {
      if (!form.agreeTerms) return 'You must agree to the Brandthread Manufacturer Terms.';
    }
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) { Alert.alert('Fix before continuing', err); return; }
    haptic();
    if (step < STEPS.length - 1) { setStep((s) => s + 1); return; }
    submit();
  }

  async function submit() {
    setSubmitting(true);
    haptic();
    try {
      const payload = {
        businessName:     form.companyName,
        country:          form.country,
        city:             form.city || undefined,
        specialty:        form.specialties[0] ?? 'Apparel',
        description:      form.specialties.join(', '),
        moq:              parseInt(form.moq) || 100,
        contactEmail:     form.email,
        website:          form.website || undefined,
        priceRange:       form.pricePerUnit ? `$${form.pricePerUnit}/${form.currency}` : '',
        sampleTurnaround: '2–4 weeks',
        bulkTurnaround:   `${form.leadTimeDays || '30'} days`,
      };

      if (inviteToken) {
        // Private invite path — user must be signed in to their Clerk account
        await api.manufacturers.registerViaInvite(inviteToken, payload);
      } else {
        // Public apply path — no Clerk account required
        await api.manufacturers.public.apply(payload);
      }

      Alert.alert(
        '🎉 Application Submitted!',
        inviteToken
          ? `Welcome, ${form.companyName}! Your manufacturer profile is live on Brandthread.`
          : `You're listed, ${form.companyName}! Your profile is live on the Brandthread Manufacturer Hub. Brand founders can find and contact you right now.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Submission Failed', e?.message ?? 'Please check your details and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const pct = ((step + 1) / STEPS.length) * 100;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => step === 0 ? router.back() : setStep((v) => v - 1)} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Join as Manufacturer</Text>
          <Text style={s.headerSub}>Step {step + 1} of {STEPS.length} — {STEPS[step]}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── STEP 0: Account ── */}
        {step === 0 && (
          <View style={s.stepWrap}>
            <Text style={s.stepTitle}>Create your manufacturer account</Text>
            <Text style={s.stepSub}>Your login for receiving quote requests and messages from brand founders.</Text>
            <Field label="Business Email" value={form.email} onChange={(v) => set('email', v)} placeholder="production@nightshiftstudio.co" keyboardType="email-address" />
            <Field label="Password" value={form.password} onChange={(v) => set('password', v)} placeholder="Min. 8 characters" secure />
            <Field label="Confirm Password" value={form.confirmPassword} onChange={(v) => set('confirmPassword', v)} placeholder="Re-enter password" secure />
          </View>
        )}

        {/* ── STEP 1: Company ── */}
        {step === 1 && (
          <View style={s.stepWrap}>
            <Text style={s.stepTitle}>Your company details</Text>
            <Text style={s.stepSub}>Shown publicly on your Brandthread manufacturer profile.</Text>
            <Field label="Company / Factory Name" value={form.companyName} onChange={(v) => set('companyName', v)} placeholder="e.g. Apex Garment Co." />
            <Field label="Country" value={form.country} onChange={(v) => set('country', v)} placeholder="e.g. China, Bangladesh, India" />
            <Field label="City" value={form.city} onChange={(v) => set('city', v)} placeholder="e.g. Guangzhou" />
            <Field label="Phone / WhatsApp" value={form.phone} onChange={(v) => set('phone', v)} placeholder="+1 234 567 890" keyboardType="phone-pad" />
            <Field label="Website (optional)" value={form.website} onChange={(v) => set('website', v)} placeholder="https://yourfactory.com" keyboardType="url" />
          </View>
        )}

        {/* ── STEP 2: Specialties ── */}
        {step === 2 && (
          <View style={s.stepWrap}>
            <Text style={s.stepTitle}>What do you produce?</Text>
            <Text style={s.stepSub}>Select everything that applies — brands filter by speciality to find you.</Text>

            <Text style={s.groupLabel}>Product types</Text>
            <View style={s.chipGrid}>
              {SPECIALTY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[s.chip, form.specialties.includes(opt) && [s.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
                  onPress={() => toggleArr('specialties', opt)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.chipText, form.specialties.includes(opt) && [s.chipTextActive, { color: colors.primary }]]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.groupLabel, { marginTop: 20 }]}>Production methods</Text>
            <View style={s.chipGrid}>
              {PRODUCTION_MODES.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[s.chip, form.productionModes.includes(opt) && [s.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
                  onPress={() => toggleArr('productionModes', opt)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.chipText, form.productionModes.includes(opt) && [s.chipTextActive, { color: colors.primary }]]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Field label="Min Order (MOQ)" value={form.moq} onChange={(v) => set('moq', v)} placeholder="e.g. 50" keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Lead Time (days)" value={form.leadTimeDays} onChange={(v) => set('leadTimeDays', v)} placeholder="e.g. 21" keyboardType="number-pad" />
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 3: Photos & Pricing ── */}
        {step === 3 && (
          <View style={s.stepWrap}>
            <Text style={s.stepTitle}>Photos & pricing</Text>
            <Text style={s.stepSub}>Upload up to 8 photos — factory floor, samples, or finished pieces. Brands browse these before reaching out.</Text>

            {/* Photo upload grid */}
            <View style={s.photoGrid}>
              {form.photos.map((uri, i) => (
                <View key={i} style={s.photoThumb}>
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <TouchableOpacity
                    style={s.photoRemove}
                    onPress={() => set('photos', form.photos.filter((_, idx) => idx !== i))}
                  >
                    <Feather name="x" size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {form.photos.length < 8 && (
                <TouchableOpacity style={s.photoAdd} onPress={pickPhoto} activeOpacity={0.8}>
                  <Feather name="plus" size={22} color={colors.primary} />
                  <Text style={[s.photoAddText, { color: colors.primary }]}>Add Photo</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Field label="Starting Price / unit" value={form.pricePerUnit} onChange={(v) => set('pricePerUnit', v)} placeholder="e.g. 4.50" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Currency" value={form.currency} onChange={(v) => set('currency', v)} placeholder="USD" />
              </View>
            </View>
            <Field label="Sample Cost (optional)" value={form.sampleCost} onChange={(v) => set('sampleCost', v)} placeholder="e.g. 25.00" keyboardType="decimal-pad" />

            {/* Escrow notice */}
            <View style={[s.escrowNotice, { backgroundColor: colors.accent, borderColor: colors.primary + '44' }]}>
              <Feather name="shield" size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[s.escrowTitle, { color: colors.primary }]}>Brandthread Escrow Protection</Text>
                <Text style={s.escrowDesc}>
                  Brand payments are held in escrow and released to you only after they confirm production is complete — protecting both sides of every deal.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 4: Review ── */}
        {step === 4 && (
          <View style={s.stepWrap}>
            <Text style={s.stepTitle}>Review your profile</Text>

            <View style={s.reviewCard}>
              <Row label="Email"      value={form.email} />
              <Row label="Company"    value={form.companyName} />
              <Row label="Location"   value={`${form.city}, ${form.country}`} />
              <Row label="Phone"      value={form.phone || '—'} />
              <Row label="MOQ"        value={form.moq ? `${form.moq} pcs` : '—'} />
              <Row label="Lead Time"  value={form.leadTimeDays ? `${form.leadTimeDays} days` : '—'} />
              <Row label="Price from" value={form.pricePerUnit ? `${form.pricePerUnit} ${form.currency}` : '—'} />
              <Row label="Specialties" value={form.specialties.join(', ') || '—'} last />
            </View>

            <View style={[s.reviewCard, { marginTop: 12 }]}>
              <Text style={s.photoCount}>{form.photos.length} photo{form.photos.length !== 1 ? 's' : ''} uploaded</Text>
            </View>

            <TouchableOpacity
              style={s.termsRow}
              onPress={() => { haptic('light'); set('agreeTerms', !form.agreeTerms); }}
              activeOpacity={0.8}
            >
              <View style={[s.checkbox, form.agreeTerms && [s.checkboxActive, { backgroundColor: colors.primary, borderColor: colors.primary }]]}>
                {form.agreeTerms && <Feather name="check" size={12} color={BG} />}
              </View>
              <Text style={s.termsText}>
                I agree to the{' '}
                <Text style={{ color: colors.primary }}>Brandthread Manufacturer Terms</Text>
                {' '}and understand payments are held in escrow until delivery is confirmed.
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[s.nextBtn, { backgroundColor: colors.primary }, submitting && { opacity: 0.7 }]}
          onPress={next}
          activeOpacity={0.85}
          disabled={submitting}
        >
          {submitting ? (
            <Text style={s.nextBtnText}>Submitting…</Text>
          ) : (
            <>
              <Text style={s.nextBtnText}>{step < STEPS.length - 1 ? 'Continue' : 'Submit Application'}</Text>
              <Feather name={step < STEPS.length - 1 ? 'arrow-right' : 'check'} size={16} color={BG} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, keyboardType, secure }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; secure?: boolean;
}) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize={secure || keyboardType === 'email-address' ? 'none' : 'words'}
      />
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[s.reviewRow, !last && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
      <Text style={s.reviewLabel}>{label}</Text>
      <Text style={s.reviewValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  progressTrack: { height: 3, backgroundColor: BORDER },
  progressFill:  { height: 3, backgroundColor: colors.primary, borderRadius: 2 },

  stepWrap:  { gap: 0 },
  stepTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 6 },
  stepSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 19, marginBottom: 24 },

  groupLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  chipGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  chipText:   { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextActive: { color: colors.primary },

  row: { flexDirection: 'row', gap: 12 },

  // Field
  fieldWrap:  { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED, marginBottom: 6 },
  fieldInput: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: FG,
  },

  // Photos
  photoGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  photoThumb:  { width: 88, height: 88, borderRadius: 12, backgroundColor: CARD, overflow: 'hidden' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  photoAdd:    { width: 88, height: 88, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoAddText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: colors.primary },

  // Escrow notice
  escrowNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.accent, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, padding: 14, marginTop: 8 },
  escrowTitle:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, marginBottom: 4 },
  escrowDesc:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 18 },

  // Review
  reviewCard:  { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  reviewRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, gap: 20 },
  reviewLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  reviewValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG, flex: 1, textAlign: 'right' },
  photoCount:  { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center', paddingVertical: 14 },

  // Terms
  termsRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 20 },
  checkbox:     { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  termsText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1, lineHeight: 19 },

  // Bottom
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG },
  nextBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16 },
  nextBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: BG },
});
