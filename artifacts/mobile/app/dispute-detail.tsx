import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  BLUE, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BrandthreadCard, BrandthreadHeader, GradientCard, PrimaryButton,
  SecondaryButton, StatusBadge, FormInput,
} from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { Dispute, DisputeEvidence, DISPUTE_TYPES } from '@/services/orderTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EvidenceType = DisputeEvidence['type'];

const EVIDENCE_TYPES: { key: EvidenceType; label: string; icon: string }[] = [
  { key: 'tracking',         label: 'Tracking Proof',    icon: 'package' },
  { key: 'photo',            label: 'Product Photos',    icon: 'image' },
  { key: 'policy',           label: 'Policy',            icon: 'file-text' },
  { key: 'written_response', label: 'Written Response',  icon: 'edit-3' },
  { key: 'other',            label: 'Other',             icon: 'more-horizontal' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function disputeStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  if (status === 'won') return 'success';
  if (status === 'lost') return 'error';
  if (status === 'closed') return 'neutral';
  if (status === 'evidence_needed') return 'warning';
  if (status === 'evidence_submitted' || status === 'under_review') return 'info';
  if (status === 'open') return 'purple';
  return 'neutral';
}

function disputeStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function evidenceTypeLabel(type: EvidenceType): string {
  return EVIDENCE_TYPES.find(e => e.key === type)?.label ?? type;
}

function disputeTypeLabel(type: string): string {
  return DISPUTE_TYPES.find(d => d.key === type)?.label ?? type.replace(/_/g, ' ');
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

// ─── Map API dispute status → UI DisputeStatus ───────────────────────────────
function mapStatus(s: string): string {
  switch (s) {
    case 'needs_response': return 'evidence_needed';
    case 'evidence_submitted': return 'evidence_submitted';
    case 'under_review': return 'under_review';
    case 'won':   return 'won';
    case 'lost':  return 'lost';
    case 'closed': return 'closed';
    default:       return 'open';
  }
}

export default function DisputeDetailScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, secondary: CYAN } = theme;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { orderId, disputeId } = useLocalSearchParams<{ orderId: string; disputeId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  // order shape compatible with render code
  const [order, setOrder] = useState<any | null>(null);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('tracking');
  const [evidenceDesc, setEvidenceDesc] = useState('');
  const [submittingEvidence, setSubmittingEvidence] = useState(false);
  const [internalNote, setInternalNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Try real API first (requires disputeId to be the DB UUID)
      if (disputeId) {
        const data = await api.disputes.get(disputeId);
        // Map API response → Dispute shape used by render code
        const mapped: Dispute = {
          id:               data.id,
          orderId:          data.orderId ?? orderId,
          type:             (data.reason ?? 'general') as any,
          status:           mapStatus(data.status) as any,
          customerClaim:    data.customerClaim ?? '',
          amount:           data.amount,
          evidenceDeadline: data.evidenceDeadline ?? undefined,
          evidence:         (data.evidence ?? []).filter((e: any) => !e.description?.startsWith('[INTERNAL NOTE]')),
          internalNotes:    (data.evidence ?? [])
            .filter((e: any) => e.description?.startsWith('[INTERNAL NOTE]'))
            .map((e: any) => e.description.replace('[INTERNAL NOTE] ', '')),
          potentialHold:    data.amount,
          createdAt:        data.createdAt,
          updatedAt:        data.updatedAt,
        };
        setDispute(mapped);

        // Build order-compatible shape from the order context the API includes
        const o = data.order;
        if (o) {
          setOrder({
            orderNumber: o.orderNumber,
            createdAt:   o.createdAt,
            payment:     { total: o.totalCents / 100 },
            lineItems:   [],
            shipments:   o.trackingNumber ? [{ trackingNumber: o.trackingNumber, carrier: o.carrier }] : [],
          });
        }
        setLoading(false);
        return;
      }
    } catch (_) { /* fall through to legacy path */ }

    // Legacy path: load from orderService (demo data)
    try {
      const { getOrder } = await import('@/services/orderService');
      const o = await getOrder(orderId);
      if (o) {
        setOrder({
          orderNumber: o.orderNumber,
          createdAt:   o.createdAt,
          payment:     { total: o.payment.total },
          lineItems:   o.lineItems,
          shipments:   o.shipments,
        });
        const d = o.disputes.find(x => x.id === disputeId);
        setDispute(d ?? null);
      }
    } catch (_) {}
    setLoading(false);
  }, [orderId, disputeId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !dispute || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>{loading ? 'Loading…' : 'Dispute not found.'}</Text>
      </View>
    );
  }

  const status = dispute.status;
  const isFinal = ['won', 'lost', 'closed'].includes(status);

  // Deadline color
  const deadlineDays = dispute.evidenceDeadline ? daysUntil(dispute.evidenceDeadline) : null;
  const deadlineColor = deadlineDays === null
    ? MUTED
    : deadlineDays < 0
      ? RED
      : deadlineDays < 5
        ? ORANGE
        : MUTED;

  // Tracking from shipment
  const firstShipment = order.shipments[0];

  const handleSubmitEvidence = async () => {
    if (submittingEvidence) return;
    if (!evidenceDesc.trim()) {
      Alert.alert('Required', 'Please enter a description for the evidence.');
      return;
    }
    setSubmittingEvidence(true);
    try {
      const tracking = evidenceType === 'tracking' ? evidenceDesc.trim() : undefined;
      await api.disputes.submitEvidence(dispute!.id, {
        type: evidenceType,
        description: evidenceDesc.trim(),
        trackingNumber: tracking,
      });
      setEvidenceDesc('');
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to submit evidence');
    } finally {
      setSubmittingEvidence(false);
    }
  };

  const handleAddNote = async () => {
    if (addingNote || !internalNote.trim()) return;
    setAddingNote(true);
    try {
      await api.disputes.submitEvidence(dispute!.id, {
        type: 'other',
        description: `[INTERNAL NOTE] ${internalNote.trim()}`,
      });
      setInternalNote('');
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to add note');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      {/* 1. HEADER */}
      <BrandthreadHeader
        title="Dispute"
        onBack={() => router.back()}
        rightElement={
          <StatusBadge
            label={disputeStatusLabel(status)}
            variant={disputeStatusVariant(status)}
          />
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.md }}
      >
        {/* 2. ALERT CARD */}
        <GradientCard
          colors={['rgba(248,113,113,0.18)', 'rgba(248,113,113,0.06)']}
          glow
          style={styles.alertCard}
        >
          <View style={styles.alertHeader}>
            <Feather name="alert-octagon" size={ICON.md} color={RED} />
            <Text style={styles.alertType}>{disputeTypeLabel(dispute.type)}</Text>
          </View>
          <Text style={styles.alertClaim}>Customer claim: {dispute.customerClaim.slice(0, 120)}{dispute.customerClaim.length > 120 ? '…' : ''}</Text>
          <View style={styles.alertAmountRow}>
            <Text style={styles.alertAmountLabel}>Disputed amount</Text>
            <Text style={styles.alertAmount}>${dispute.amount.toFixed(2)}</Text>
          </View>
          {dispute.evidenceDeadline && (
            <View style={styles.deadlineRow}>
              <Feather name="clock" size={ICON.xs} color={deadlineColor} />
              <Text style={[styles.deadlineText, { color: deadlineColor }]}>
                Evidence due {fmtDate(dispute.evidenceDeadline)}
                {deadlineDays !== null && deadlineDays >= 0
                  ? ` (${deadlineDays} day${deadlineDays !== 1 ? 's' : ''})`
                  : ' (Past due)'}
              </Text>
            </View>
          )}
        </GradientCard>

        {/* 3. CUSTOMER CLAIM */}
        <View>
          <Text style={styles.sectionHeader}>Customer Claim</Text>
          <View style={[styles.claimBlock, { backgroundColor: CARD_ELEVATED }]}>
            <Text style={styles.claimText}>{dispute.customerClaim}</Text>
          </View>
        </View>

        {/* 4. ORDER CONTEXT */}
        <BrandthreadCard style={styles.section}>
          <Text style={styles.sectionTitle}>Order Context</Text>
          <View style={styles.contextRow}>
            <Text style={styles.ctxLabel}>Order</Text>
            <Text style={styles.ctxValue}>{order.orderNumber}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={styles.ctxLabel}>Date</Text>
            <Text style={styles.ctxValue}>{fmtDate(order.createdAt)}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={styles.ctxLabel}>Total</Text>
            <Text style={styles.ctxValue}>${order.payment.total.toFixed(2)}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={styles.ctxLabel}>Products</Text>
            <Text style={[styles.ctxValue, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>
              {order.lineItems.map(li => li.productName).join(', ')}
            </Text>
          </View>
          {firstShipment?.trackingNumber && (
            <View style={styles.contextRow}>
              <Text style={styles.ctxLabel}>Tracking</Text>
              <Text style={[styles.ctxValue, { color: CYAN }]}>{firstShipment.trackingNumber}</Text>
            </View>
          )}
        </BrandthreadCard>

        {/* 5. EVIDENCE SECTION */}
        <View>
          <Text style={styles.sectionHeader}>Evidence</Text>

          {/* Existing evidence */}
          {dispute.evidence.filter(e => !e.description.startsWith('[INTERNAL NOTE]')).map(ev => (
            <BrandthreadCard key={ev.id} style={[styles.section, styles.evidenceCard]}>
              <View style={styles.evidenceBadgeRow}>
                <View style={styles.evidenceTypeBadge}>
                  <Text style={styles.evidenceTypeBadgeText}>{evidenceTypeLabel(ev.type)}</Text>
                </View>
                <Text style={styles.evidenceDate}>{fmtDate(ev.submittedAt)}</Text>
              </View>
              <Text style={styles.evidenceDesc}>{ev.description}</Text>
            </BrandthreadCard>
          ))}

          {/* Add evidence form */}
          {!isFinal && (
            <BrandthreadCard elevated style={styles.section}>
              <Text style={styles.sectionTitle}>Add Evidence</Text>

              {/* Type chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {EVIDENCE_TYPES.map(et => (
                    <TouchableOpacity
                      key={et.key}
                      style={[styles.chip, evidenceType === et.key && styles.chipActive]}
                      onPress={() => setEvidenceType(et.key)}
                    >
                      <Feather
                        name={et.icon as any}
                        size={ICON.xs}
                        color={evidenceType === et.key ? PURPLE : MUTED}
                      />
                      <Text style={[styles.chipText, evidenceType === et.key && styles.chipTextActive]}>
                        {et.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <FormInput
                label="Description"
                value={evidenceDesc}
                onChange={setEvidenceDesc}
                placeholder="Describe the evidence you're submitting…"
                multiline
              />

              <TouchableOpacity
                style={styles.fileNoteRow}
                onPress={() => Alert.alert('Attach Files', 'File attachment will be available in the next release.')}
              >
                <Feather name="paperclip" size={ICON.xs} color={MUTED} />
                <Text style={styles.fileNoteText}>Attach files → tap to add</Text>
              </TouchableOpacity>

              <PrimaryButton
                label="Submit Evidence"
                onPress={handleSubmitEvidence}
                loading={submittingEvidence}
                disabled={submittingEvidence || !evidenceDesc.trim()}
                icon="upload"
              />
            </BrandthreadCard>
          )}
        </View>

        {/* 6. ACTIONS */}
        <BrandthreadCard style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>

          {!isFinal && (
            <View style={styles.actionsGap}>
              <SecondaryButton
                label="Accept Dispute (Concede)"
                onPress={() => Alert.alert(
                  'Are you sure?',
                  'This cannot be undone. You will concede the dispute and the customer will be refunded.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Concede', style: 'destructive', onPress: () => Alert.alert('Dispute Conceded', 'The dispute has been conceded and the customer will be refunded.') },
                  ]
                )}
                accent={RED}
              />
              <SecondaryButton
                label="Message Support"
                onPress={() => Alert.alert('Support', 'Open the inbox to contact Brandthread support about this dispute.')}
                accent={CYAN}
              />
            </View>
          )}

          {(status === 'evidence_needed' || status === 'evidence_submitted') && dispute.evidence.filter(e => !e.description.startsWith('[INTERNAL NOTE]')).length > 0 && (
            <View style={{ marginTop: SP.sm }}>
              <PrimaryButton
                label="Submit All Evidence"
                onPress={() => Alert.alert('Submit Evidence', 'This will finalize and submit all evidence to the payment processor for review.')}
                icon="send"
              />
            </View>
          )}

          {isFinal && (
            <View style={[
              styles.resultCard,
              status === 'won' && { borderColor: SUCCESS + '55', backgroundColor: SUCCESS_DIM },
              status === 'lost' && { borderColor: RED + '55', backgroundColor: RED_DIM },
              status === 'closed' && { borderColor: BORDER },
            ]}>
              <Feather
                name={status === 'won' ? 'check-circle' : status === 'lost' ? 'x-circle' : 'minus-circle'}
                size={ICON.md}
                color={status === 'won' ? SUCCESS : status === 'lost' ? RED : MUTED}
              />
              <View style={{ flex: 1 }}>
                <Text style={[
                  styles.resultTitle,
                  { color: status === 'won' ? SUCCESS : status === 'lost' ? RED : MUTED }
                ]}>
                  Dispute {disputeStatusLabel(status)}
                </Text>
                <Text style={styles.resultSub}>
                  {status === 'won'
                    ? 'You won this dispute. Funds have been released.'
                    : status === 'lost'
                      ? 'This dispute was resolved in the customer\'s favor.'
                      : 'This dispute has been closed.'}
                </Text>
              </View>
            </View>
          )}
        </BrandthreadCard>

        {/* 7. INTERNAL NOTES */}
        <View>
          <Text style={styles.sectionHeader}>Internal Notes</Text>

          {dispute.internalNotes.length === 0 && (
            <Text style={styles.noNotes}>No internal notes yet.</Text>
          )}

          {dispute.internalNotes.map((note, i) => (
            <View key={i} style={styles.noteItem}>
              <Feather name="edit-2" size={ICON.xs} color={SUBTLE} />
              <Text style={styles.noteText}>{note}</Text>
            </View>
          ))}

          <BrandthreadCard elevated style={[styles.section, { marginTop: SP.sm }]}>
            <FormInput
              label="Add internal note"
              value={internalNote}
              onChange={setInternalNote}
              placeholder="Note visible only to you…"
              multiline
            />
            <SecondaryButton
              label="Add Note"
              onPress={handleAddNote}
              disabled={addingNote || !internalNote.trim()}
              icon="plus"
              small
            />
          </BrandthreadCard>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: { accent: string; accentDim: string; secondary: string }) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, secondary: CYAN } = theme;
  return StyleSheet.create({
  centered:           { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  loadingText:        { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  section:            { gap: SP.sm },
  sectionTitle:       { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },
  sectionHeader:      { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.sm },
  alertCard:          { gap: SP.sm, borderColor: RED + '55' },
  alertHeader:        { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  alertType:          { fontSize: FS.md, fontFamily: FONT.bold, color: RED },
  alertClaim:         { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  alertAmountRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SP.xs },
  alertAmountLabel:   { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  alertAmount:        { fontSize: FS.lg, fontFamily: FONT.bold, color: RED },
  deadlineRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.xs },
  deadlineText:       { fontSize: FS.sm, fontFamily: FONT.semibold },
  claimBlock:         {
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER,
    padding: SP.md,
  },
  claimText:          { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  contextRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  ctxLabel:           { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  ctxValue:           { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  evidenceCard:       { marginBottom: SP.sm },
  evidenceBadgeRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  evidenceTypeBadge:  {
    backgroundColor: PURPLE_DIM, paddingHorizontal: SP.sm,
    paddingVertical: 3, borderRadius: RADIUS.pill,
  },
  evidenceTypeBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE },
  evidenceDate:       { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  evidenceDesc:       { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },
  chipRow:            { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.xs },
  chip:               {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.sm, paddingVertical: SP.sm,
    borderRadius: RADIUS.pill, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  chipActive:         { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  chipText:           { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  chipTextActive:     { color: PURPLE, fontFamily: FONT.semibold },
  fileNoteRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingVertical: SP.xs },
  fileNoteText:       { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  actionsGap:         { gap: SP.sm },
  resultCard:         {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    padding: SP.md, marginTop: SP.sm,
  },
  resultTitle:        { fontSize: FS.base, fontFamily: FONT.bold },
  resultSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2, lineHeight: 18 },
  noNotes:            { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, marginBottom: SP.sm },
  noteItem:           {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1,
    borderColor: BORDER, padding: SP.sm, marginBottom: SP.xs,
  },
  noteText:           { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, flex: 1, lineHeight: 18 },
  });
};
