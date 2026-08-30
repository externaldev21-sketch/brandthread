/**
 * Quote Detail Screen — Brandthread Manufacturer Hub
 * Params: quoteId (string), mode? ('view' | 'counter')
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, Alert, TextInput,
  StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, StatusBadge, SectionHeader, FormInput,
  LoadingSkeleton,
} from '@/components/BrandthreadUI';

import {
  getQuote, getCounteroffersForQuote, acceptQuote, declineQuote,
  submitCounteroffer, getOrCreateConversation, createSample, getManufacturer,
} from '@/services/manufacturerService';
import { Quote, Counteroffer } from '@/services/manufacturerTypes';
import { formatCents, parseDecimalToCents } from '@/lib/money';

import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM,
  SUCCESS, SUCCESS_DIM, RED, RED_DIM, ORANGE, ORANGE_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW, GRAD_SUCCESS_G,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple' {
  if (status === 'accepted') return 'success';
  if (status === 'quote_received') return 'info';
  if (status === 'counteroffer_sent') return 'purple';
  if (status === 'declined' || status === 'cancelled' || status === 'expired') return 'error';
  if (status === 'sent' || status === 'viewed') return 'warning';
  return 'neutral';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── InfoRow ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, highlight && s.infoValueHighlight]}>{value}</Text>
    </View>
  );
}

// ─── CounterOfferForm ─────────────────────────────────────────────────────────

interface CounterFormState {
  desiredUnitPrice: string;
  desiredMoq: string;
  desiredProductionDays: string;
  desiredPaymentTerms: string;
  notes: string;
}

function CounterOfferForm({
  quoteId,
  onSubmitted,
}: {
  quoteId: string;
  onSubmitted: () => void;
}) {
  const [form, setForm] = useState<CounterFormState>({
    desiredUnitPrice: '',
    desiredMoq: '',
    desiredProductionDays: '',
    desiredPaymentTerms: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof CounterFormState) => (val: string) =>
    setForm(prev => ({ ...prev, [field]: val }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await submitCounteroffer(quoteId, {
        desiredUnitPriceCents: form.desiredUnitPrice ? parseDecimalToCents(form.desiredUnitPrice) ?? undefined : undefined,
        desiredMoq: form.desiredMoq ? parseInt(form.desiredMoq) : undefined,
        desiredProductionDays: form.desiredProductionDays ? parseInt(form.desiredProductionDays) : undefined,
        desiredPaymentTerms: form.desiredPaymentTerms || undefined,
        notes: form.notes || undefined,
      });
      onSubmitted();
    } catch (e) {
      Alert.alert('Error', 'Failed to submit counteroffer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BrandthreadCard style={s.counterCard} elevated>
      <Text style={s.counterTitle}>Send Counteroffer</Text>
      <View style={s.formGap}>
        <FormInput
          label="Desired Unit Price ($)"
          value={form.desiredUnitPrice}
          onChange={set('desiredUnitPrice')}
          placeholder="e.g. 18.50"
          keyboardType="decimal-pad"
        />
        <FormInput
          label="Desired MOQ (units)"
          value={form.desiredMoq}
          onChange={set('desiredMoq')}
          placeholder="e.g. 100"
          keyboardType="numeric"
        />
        <FormInput
          label="Desired Production Days"
          value={form.desiredProductionDays}
          onChange={set('desiredProductionDays')}
          placeholder="e.g. 21"
          keyboardType="numeric"
        />
        <FormInput
          label="Desired Payment Terms"
          value={form.desiredPaymentTerms}
          onChange={set('desiredPaymentTerms')}
          placeholder="e.g. Net 30"
        />
        <FormInput
          label="Notes"
          value={form.notes}
          onChange={set('notes')}
          placeholder="Any additional context for the manufacturer…"
          multiline
        />
        <PrimaryButton
          label="Submit Counteroffer"
          onPress={handleSubmit}
          loading={submitting}
          icon="send"
        />
      </View>
    </BrandthreadCard>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function QuoteDetailScreen() {
  const colors = useColors();
  const { quoteId, mode } = useLocalSearchParams<{ quoteId: string; mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [counteroffers, setCounteroffers] = useState<Counteroffer[]>([]);
  const [manufacturerName, setManufacturerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCounterForm, setShowCounterForm] = useState(mode === 'counter');

  const load = useCallback(async () => {
    if (!quoteId) return;
    setLoading(true);
    try {
      const [q, cos] = await Promise.all([
        getQuote(quoteId),
        getCounteroffersForQuote(quoteId),
      ]);
      if (q) {
        setQuote(q);
        setCounteroffers(cos);
        const mfg = await getManufacturer(q.manufacturerId);
        setManufacturerName(mfg?.name ?? 'Manufacturer');
      }
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => { load(); }, [load]);

  const handleAccept = () => {
    Alert.alert(
      'Accept Quote',
      'Are you sure you want to accept this quote? This will begin the production process.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setActionLoading(true);
            await acceptQuote(quoteId!);
            await load();
            setActionLoading(false);
          },
        },
      ]
    );
  };

  const handleDecline = () => {
    Alert.alert(
      'Decline Quote',
      'Are you sure you want to decline this quote?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            await declineQuote(quoteId!);
            setActionLoading(false);
            router.back();
          },
        },
      ]
    );
  };

  const handleMessage = async () => {
    if (!quote) return;
    const conv = await getOrCreateConversation(quote.manufacturerId, {
      quoteId: quote.id,
      contextLabel: `Quote: ${quote.productName}`,
    });
    router.push({ pathname: '/manufacturer-messages', params: { threadId: conv.id } } as any);
  };

  const handleStartSample = async () => {
    if (!quote) return;
    // Sample orders are persisted against real manufacturer records. Legacy
    // offline/demo quote IDs are intentionally not sent to the API.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(quote.manufacturerId)) {
      Alert.alert(
        'Sample unavailable',
        'This quote is a local preview and cannot start a real sample order. Choose a manufacturer from the live directory and request a fresh quote.',
      );
      return;
    }
    setActionLoading(true);
    try {
      const sample = await createSample({
        manufacturerId: quote.manufacturerId,
        quoteId: quote.id,
        productName: quote.productName,
        type: 'proto',
        costCents: quote.sampleCostCents,
      });
      router.push({ pathname: '/sample-detail', params: { id: sample.id, paymentPrompt: '1' } } as any);
    } catch (err: any) {
      Alert.alert('Could not start sample', err?.message ?? 'Please try again after refreshing the quote.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Quote Details" onBack={() => router.back()} />
        <View style={s.loadingContainer}>
          <LoadingSkeleton height={120} style={s.skeleton} />
          <LoadingSkeleton height={200} style={s.skeleton} />
          <LoadingSkeleton height={160} style={s.skeleton} />
        </View>
      </BrandthreadScreen>
    );
  }

  if (!quote) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Quote Details" onBack={() => router.back()} />
        <View style={s.centered}>
          <Text style={s.errorText}>Quote not found.</Text>
        </View>
      </BrandthreadScreen>
    );
  }

  const daysLeft = daysUntil(quote.validUntil);
  const isExpiringSoon = daysLeft <= 7 && daysLeft > 0;
  const isExpired = daysLeft <= 0;
  const isReadOnly = ['declined', 'cancelled', 'expired'].includes(quote.status);
  const isAccepted = quote.status === 'accepted';
  const canAct = quote.status === 'quote_received';

  return (
    <BrandthreadScreen>
      <BrandthreadHeader
        title="Quote Details"
        subtitle={manufacturerName}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          {/* ── STATUS CARD ─────────────────────────────────────── */}
          <GradientCard glow style={s.section}>
            <View style={s.statusRow}>
              <StatusBadge label={statusLabel(quote.status)} variant={statusVariant(quote.status)} />
            </View>
            <Text style={s.productName}>{quote.productName}</Text>
            <Text style={s.validUntil}>Valid until {formatDate(quote.validUntil)}</Text>
            {isExpiringSoon && !isExpired && (
              <View style={s.warningBanner}>
                <Feather name="alert-triangle" size={ICON.xs} color={ORANGE} />
                <Text style={s.warningText}>Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''} — act soon!</Text>
              </View>
            )}
            {isExpired && (
              <View style={s.errorBanner}>
                <Feather name="x-circle" size={ICON.xs} color={RED} />
                <Text style={s.errorBannerText}>This quote has expired</Text>
              </View>
            )}
          </GradientCard>

          {/* ── PRICING BREAKDOWN ────────────────────────────────── */}
          <SectionHeader title="Pricing Breakdown" style={s.sectionHeader} />
          <BrandthreadCard style={s.section}>
            <InfoRow label="Unit Price" value={formatCents(quote.unitPriceCents)} />
            <InfoRow label="Sample Cost" value={formatCents(quote.sampleCostCents)} />
            <InfoRow label="Setup / Tooling" value={formatCents(quote.setupCostCents)} />
            <InfoRow label="Packaging" value={formatCents(quote.packagingCostCents)} />
            <InfoRow label="Shipping Estimate" value={formatCents(quote.shippingEstimateCents)} />
            <View style={s.separator} />
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total Estimate</Text>
              <Text style={s.totalValue}>{formatCents(quote.totalEstimateCents)}</Text>
            </View>
          </BrandthreadCard>

          {/* ── TERMS ───────────────────────────────────────────── */}
          <SectionHeader title="Terms" style={s.sectionHeader} />
          <BrandthreadCard style={s.section}>
            <InfoRow label="MOQ" value={`${quote.moq} units`} />
            <InfoRow label="Lead Time" value={`${quote.leadTimeDays} days`} />
            <InfoRow label="Production Time" value={`${quote.productionDays} days`} />
            <InfoRow label="Payment Terms" value={quote.paymentTerms} />
            {quote.notes && (
              <>
                <View style={s.separator} />
                <Text style={s.notesLabel}>Notes from Manufacturer</Text>
                <Text style={s.notesText}>{quote.notes}</Text>
              </>
            )}
          </BrandthreadCard>

          {/* ── COUNTEROFFER HISTORY ─────────────────────────────── */}
          {counteroffers.length > 0 && (
            <>
              <SectionHeader title={`Counteroffer History (${counteroffers.length})`} style={s.sectionHeader} />
              {counteroffers.map(co => (
                <BrandthreadCard key={co.id} style={s.section}>
                  <View style={s.coHeader}>
                    <Text style={s.coDate}>{formatDate(co.createdAt)}</Text>
                    <StatusBadge
                      label={co.status.charAt(0).toUpperCase() + co.status.slice(1)}
                      variant={co.status === 'accepted' ? 'success' : co.status === 'declined' ? 'error' : 'purple'}
                      small
                    />
                  </View>
                  {co.desiredUnitPriceCents !== undefined && (
                    <InfoRow label="Desired Unit Price" value={formatCents(co.desiredUnitPriceCents)} />
                  )}
                  {co.desiredMoq !== undefined && (
                    <InfoRow label="Desired MOQ" value={`${co.desiredMoq} units`} />
                  )}
                  {co.desiredProductionDays !== undefined && (
                    <InfoRow label="Desired Production Days" value={`${co.desiredProductionDays} days`} />
                  )}
                  {co.desiredPaymentTerms && (
                    <InfoRow label="Desired Payment Terms" value={co.desiredPaymentTerms} />
                  )}
                  {co.notes && (
                    <Text style={s.coNotes}>{co.notes}</Text>
                  )}
                </BrandthreadCard>
              ))}
            </>
          )}

          {/* ── ACCEPTED STATE ───────────────────────────────────── */}
          {isAccepted && (
            <>
              <BrandthreadCard style={[s.section, s.successCard]} elevated>
                <View style={s.successRow}>
                  <Feather name="check-circle" size={ICON.lg} color={SUCCESS} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.successTitle}>Quote Accepted</Text>
                    <Text style={s.successSub}>You've accepted this quote. Start by ordering a prototype sample.</Text>
                  </View>
                </View>
              </BrandthreadCard>
              <View style={s.actionsSection}>
                <PrimaryButton
                  label="Start Sample"
                  onPress={handleStartSample}
                  loading={actionLoading}
                  icon="package"
                  colors={['#10B981', '#34D399']}
                />
                <SecondaryButton
                  label="Message Manufacturer"
                  onPress={handleMessage}
                  icon="message-square"
                />
              </View>
            </>
          )}

          {/* ── READ-ONLY STATE ──────────────────────────────────── */}
          {isReadOnly && (
            <BrandthreadCard style={[s.section, s.readOnlyCard]}>
              <View style={s.readOnlyRow}>
                <Feather name="info" size={ICON.md} color={MUTED} />
                <Text style={s.readOnlyText}>
                  This quote is {statusLabel(quote.status).toLowerCase()} and no further actions are available.
                </Text>
              </View>
            </BrandthreadCard>
          )}

          {/* ── ACTIONS — quote_received ─────────────────────────── */}
          {canAct && (
            <View style={s.actionsSection}>
              <PrimaryButton
                label="Accept Quote"
                onPress={handleAccept}
                loading={actionLoading}
                icon="check"
                colors={['#10B981', '#34D399']}
              />
              <SecondaryButton
                label="Send Counteroffer"
                onPress={() => setShowCounterForm(v => !v)}
                icon="repeat"
              />
              <SecondaryButton
                label="Message Manufacturer"
                onPress={handleMessage}
                icon="message-square"
              />
              <SecondaryButton
                label="Decline Quote"
                onPress={handleDecline}
                icon="x"
                accent={RED}
              />
            </View>
          )}

          {/* ── COUNTEROFFER FORM ────────────────────────────────── */}
          {(showCounterForm && (canAct || mode === 'counter')) && (
            <CounterOfferForm
              quoteId={quoteId!}
              onSubmitted={async () => {
                setShowCounterForm(false);
                await load();
              }}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: {
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  section: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  sectionHeader: {
    marginTop: SP.sm,
  },
  loadingContainer: {
    padding: SP.md,
    gap: SP.md,
  },
  skeleton: {
    marginHorizontal: SP.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: MUTED,
  },

  // Status card
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SP.sm,
  },
  productName: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
    marginBottom: SP.xs,
  },
  validUntil: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.sm,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  warningText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: ORANGE,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.sm,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  errorBannerText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: RED,
  },

  // InfoRow
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.xs,
  },
  infoLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
    flex: 1,
  },
  infoValue: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
    textAlign: 'right',
  },
  infoValueHighlight: {
    color: CYAN,
    fontSize: FS.base,
    fontFamily: FONT.bold,
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.sm,
  },

  // Total row
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.xs,
  },
  totalLabel: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  totalValue: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: CYAN,
    letterSpacing: -0.5,
  },

  // Notes
  notesLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginBottom: SP.xs,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  notesText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 20,
  },

  // Counteroffer
  coHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  coDate: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  coNotes: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: SP.xs,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // Success card
  successCard: {
    borderColor: SUCCESS + '44',
    backgroundColor: SUCCESS_DIM,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.md,
  },
  successTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: SUCCESS,
    marginBottom: 2,
  },
  successSub: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 18,
  },

  // Read-only
  readOnlyCard: {
    borderColor: BORDER,
  },
  readOnlyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
  },
  readOnlyText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 18,
  },

  // Actions
  actionsSection: {
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: SP.sm,
    gap: SP.sm,
  },

  // Counter form
  counterCard: {
    marginHorizontal: SP.md,
    marginBottom: SP.md,
  },
  counterTitle: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: SP.md,
    letterSpacing: -0.2,
  },
  formGap: {
    gap: SP.md,
  },
});

// Local color references used above
