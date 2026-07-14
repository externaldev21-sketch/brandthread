import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, TextInput, Image,
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
import {
  BrandthreadCard, BrandthreadHeader, GradientCard, PrimaryButton,
  SecondaryButton, StatusBadge,
} from '@/components/BrandthreadUI';
import { getOrder, updateReturnStatus } from '@/services/orderService';
import { Order, ReturnRequest, RETURN_REASONS } from '@/services/orderTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RETURN_STATUSES = [
  'requested', 'under_review', 'approved', 'denied',
  'label_issued', 'in_transit', 'received', 'inspected',
  'refund_pending', 'refunded', 'closed',
] as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function returnStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  if (['refunded', 'exchange_completed', 'closed'].includes(status)) return 'success';
  if (status === 'denied') return 'error';
  if (['approved', 'label_issued', 'in_transit', 'received', 'inspected', 'refund_pending'].includes(status)) return 'info';
  if (status === 'under_review') return 'warning';
  return 'neutral';
}

function returnStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function resolutionLabel(r: string): string {
  if (r === 'refund') return 'Refund';
  if (r === 'exchange') return 'Exchange';
  if (r === 'store_credit') return 'Store Credit';
  return r;
}

// ─── Timeline Step ────────────────────────────────────────────────────────────

function TimelineStep({ label, state }: { label: string; state: 'completed' | 'current' | 'future' }) {
  return (
    <View style={tlS.row}>
      <View style={tlS.dotCol}>
        {state === 'completed' ? (
          <View style={[tlS.dot, tlS.dotDone]}>
            <Feather name="check" size={10} color="#fff" />
          </View>
        ) : state === 'current' ? (
          <View style={[tlS.dot, tlS.dotCurrent]} />
        ) : (
          <View style={[tlS.dot, tlS.dotFuture]} />
        )}
        <View style={tlS.line} />
      </View>
      <Text style={[tlS.label,
        state === 'completed' && tlS.labelDone,
        state === 'current' && tlS.labelCurrent,
        state === 'future' && tlS.labelFuture,
      ]}>
        {label}
      </Text>
    </View>
  );
}

const tlS = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'flex-start', minHeight: 36 },
  dotCol:     { alignItems: 'center', width: 24, marginRight: SP.sm },
  dot:        { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dotDone:    { backgroundColor: SUCCESS },
  dotCurrent: { backgroundColor: PURPLE, borderWidth: 2, borderColor: PURPLE },
  dotFuture:  { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: SUBTLE },
  line:       { flex: 1, width: 1.5, backgroundColor: BORDER, marginTop: 2 },
  label:      { fontSize: FS.sm, fontFamily: FONT.regular, paddingTop: 2 },
  labelDone:  { color: SUCCESS },
  labelCurrent:{ color: FG, fontFamily: FONT.semibold },
  labelFuture:{ color: SUBTLE },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ReturnDetailScreen() {
  const { orderId, returnId } = useLocalSearchParams<{ orderId: string; returnId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [returnReq, setReturnReq] = useState<ReturnRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyForm, setShowDenyForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const o = await getOrder(orderId);
    if (o) {
      setOrder(o);
      const r = o.returns.find(x => x.id === returnId);
      setReturnReq(r ?? null);
    }
    setLoading(false);
  }, [orderId, returnId]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (status: ReturnRequest['status'], reason?: string) => {
    if (!order || !returnReq) return;
    setActionLoading(true);
    await updateReturnStatus(order.id, returnReq.id, status, reason);
    await load();
    setActionLoading(false);
    setShowDenyForm(false);
  };

  if (loading || !returnReq || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>{loading ? 'Loading…' : 'Return not found.'}</Text>
      </View>
    );
  }

  const status = returnReq.status;
  const isExpired = returnReq.returnDeadline && new Date(returnReq.returnDeadline) < new Date();

  // Build timeline states
  const currentIdx = RETURN_STATUSES.indexOf(status as typeof RETURN_STATUSES[number]);

  const shipment = returnReq.shipmentId ? order.shipments.find(s => s.id === returnReq.shipmentId) : null;
  const label = returnReq.labelId ? order.labels.find(l => l.id === returnReq.labelId) : null;

  const reasonLabel = (r: string) => RETURN_REASONS.find(x => x.key === r)?.label ?? r;

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      {/* HEADER */}
      <BrandthreadHeader
        title="Return Request"
        onBack={() => router.back()}
        rightElement={
          <StatusBadge
            label={returnStatusLabel(status)}
            variant={returnStatusVariant(status)}
          />
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.md }}
      >
        {/* 2. STATUS TIMELINE */}
        <BrandthreadCard style={styles.section}>
          <Text style={styles.sectionTitle}>Status Timeline</Text>
          {RETURN_STATUSES.map((s, i) => {
            let state: 'completed' | 'current' | 'future' = 'future';
            if (i < currentIdx) state = 'completed';
            else if (i === currentIdx) state = 'current';
            return <TimelineStep key={s} label={returnStatusLabel(s)} state={state} />;
          })}
        </BrandthreadCard>

        {/* 3. CUSTOMER */}
        <BrandthreadCard style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <Text style={styles.customerName}>{order.customer.name}</Text>
          <Text style={styles.customerEmail}>{order.customer.email}</Text>
          <Text style={styles.metaRow}>Return requested {fmtDate(returnReq.createdAt)}</Text>
          <View style={styles.metaRowView}>
            <Text style={styles.metaLabel}>Return deadline:</Text>
            <Text style={[styles.metaValue, isExpired && { color: ORANGE }]}>
              {fmtDate(returnReq.returnDeadline)}{isExpired ? ' (Expired)' : ''}
            </Text>
          </View>
          <View style={[styles.metaRowView, { marginTop: SP.sm }]}>
            <Text style={styles.metaLabel}>Requested resolution:</Text>
            <View style={styles.resolutionBadge}>
              <Text style={styles.resolutionText}>{resolutionLabel(returnReq.requestedResolution)}</Text>
            </View>
          </View>
        </BrandthreadCard>

        {/* 4. ITEMS REQUESTED */}
        <View>
          <Text style={styles.sectionHeader}>Items Requested</Text>
          {returnReq.items.map((item, idx) => (
            <BrandthreadCard key={idx} style={[styles.section, { marginBottom: SP.sm }]}>
              <Text style={styles.itemName}>{item.productName}</Text>
              <Text style={styles.itemVariant}>{item.variant}</Text>
              <View style={styles.itemRow}>
                <Text style={styles.itemQty}>Qty: {item.quantity}</Text>
                <Text style={styles.itemPrice}>× ${item.unitPrice.toFixed(2)}</Text>
                <Text style={styles.itemTotal}> = ${(item.quantity * item.unitPrice).toFixed(2)}</Text>
              </View>
              <View style={styles.reasonRow}>
                <Text style={styles.metaLabel}>Reason: </Text>
                <Text style={styles.reasonText}>{reasonLabel(item.reason)}</Text>
              </View>
            </BrandthreadCard>
          ))}
        </View>

        {/* 5. CUSTOMER EXPLANATION */}
        <View>
          <Text style={styles.sectionHeader}>Customer Explanation</Text>
          <View style={[styles.section, { backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md }]}>
            <Text style={styles.explanationText}>
              {returnReq.customerExplanation || 'No explanation provided.'}
            </Text>
            {returnReq.imageUris.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SP.sm }}>
                {returnReq.imageUris.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={styles.returnImage} />
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.noPhotos}>No photos provided</Text>
            )}
          </View>
        </View>

        {/* 6. POLICY */}
        <BrandthreadCard style={styles.section}>
          <View style={styles.policyRow}>
            <Feather name="info" size={ICON.sm} color={MUTED} />
            <Text style={styles.policyText}>
              Standard return policy: items must be returned within 30 days of delivery in original condition.
            </Text>
          </View>
        </BrandthreadCard>

        {/* 7. ACTIONS */}
        <BrandthreadCard style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>

          {(status === 'requested' || status === 'under_review') && (
            <View style={styles.actionsGap}>
              <PrimaryButton
                label="Approve Return"
                onPress={() => doAction('approved')}
                loading={actionLoading}
                colors={[SUCCESS, '#34D399']}
              />
              <SecondaryButton
                label="Request More Info"
                onPress={() => Alert.alert('Request More Info', 'In a real app, this would send a message to the customer.')}
                accent={CYAN}
              />
              {!showDenyForm ? (
                <SecondaryButton
                  label="Deny Return"
                  onPress={() => setShowDenyForm(true)}
                  accent={RED}
                />
              ) : (
                <View style={styles.denyForm}>
                  <Text style={styles.denyLabel}>Denial reason (required)</Text>
                  <TextInput
                    style={styles.denyInput}
                    value={denyReason}
                    onChangeText={setDenyReason}
                    placeholder="Explain why the return is denied…"
                    placeholderTextColor={SUBTLE}
                    multiline
                  />
                  <View style={styles.denyButtons}>
                    <SecondaryButton
                      label="Cancel"
                      onPress={() => { setShowDenyForm(false); setDenyReason(''); }}
                      small
                      style={{ flex: 1 }}
                    />
                    <PrimaryButton
                      label="Submit Denial"
                      onPress={() => {
                        if (!denyReason.trim()) {
                          Alert.alert('Required', 'Please enter a denial reason.');
                          return;
                        }
                        doAction('denied', denyReason.trim());
                      }}
                      loading={actionLoading}
                      disabled={!denyReason.trim()}
                      small
                      colors={[RED, '#F87171']}
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              )}
            </View>
          )}

          {status === 'approved' && (
            <View style={styles.actionsGap}>
              <PrimaryButton
                label="Issue Return Label (Demo)"
                onPress={() => {
                  Alert.alert('Demo', 'In a real app, a prepaid return label would be generated.');
                  doAction('label_issued');
                }}
                loading={actionLoading}
              />
              <SecondaryButton
                label="Offer Store Credit"
                onPress={() => Alert.alert('Store Credit', 'In a real app, store credit would be issued.')}
                accent={GOLD}
              />
              <SecondaryButton
                label="Issue Refund Without Return"
                onPress={() => router.push(`/refund-detail?orderId=${order.id}&returnId=${returnReq.id}`)}
                accent={CYAN}
              />
            </View>
          )}

          {(status === 'label_issued' || status === 'in_transit') && (
            <PrimaryButton
              label="Mark Return Received"
              onPress={() => doAction('received')}
              loading={actionLoading}
              colors={[BLUE, '#60A5FA']}
            />
          )}

          {status === 'received' && (
            <PrimaryButton
              label="Mark Inspected"
              onPress={() => doAction('inspected')}
              loading={actionLoading}
              colors={[PURPLE, CYAN]}
            />
          )}

          {status === 'inspected' && (
            <View style={styles.actionsGap}>
              <PrimaryButton
                label="Issue Refund"
                onPress={() => router.push(`/refund-detail?orderId=${order.id}&returnId=${returnReq.id}`)}
              />
              <SecondaryButton
                label="Issue Exchange (Demo)"
                onPress={() => Alert.alert('Exchange', 'In a real app, an exchange order would be created.')}
                accent={CYAN}
              />
            </View>
          )}

          {(status === 'refunded' || status === 'closed' || status === 'denied') && (
            <View style={[styles.readOnlySummary, status === 'denied' && { borderColor: RED + '55' }]}>
              <Feather
                name={status === 'denied' ? 'x-circle' : 'check-circle'}
                size={ICON.md}
                color={status === 'denied' ? RED : SUCCESS}
              />
              <Text style={[styles.readOnlyText, { color: status === 'denied' ? RED : SUCCESS }]}>
                {status === 'denied'
                  ? `Return denied${returnReq.deniedReason ? `: ${returnReq.deniedReason}` : ''}`
                  : `Return ${returnStatusLabel(status)}`}
              </Text>
            </View>
          )}
        </BrandthreadCard>

        {/* 8. SHIPMENT TRACKING */}
        {(label || shipment) && (
          <BrandthreadCard style={styles.section}>
            <Text style={styles.sectionTitle}>Shipment Tracking</Text>
            {label && (
              <View style={styles.trackingRow}>
                <Text style={styles.metaLabel}>Carrier:</Text>
                <Text style={styles.metaValue}>{label.carrier}</Text>
              </View>
            )}
            {(label?.trackingNumber || shipment?.trackingNumber) && (
              <View style={styles.trackingRow}>
                <Text style={styles.metaLabel}>Tracking:</Text>
                <Text style={styles.trackingNumber}>{label?.trackingNumber ?? shipment?.trackingNumber}</Text>
              </View>
            )}
            {shipment?.trackingStatus && (
              <View style={styles.trackingRow}>
                <Text style={styles.metaLabel}>Status:</Text>
                <Text style={styles.metaValue}>{returnStatusLabel(shipment.trackingStatus)}</Text>
              </View>
            )}
          </BrandthreadCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered:        { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  loadingText:     { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  section:         { gap: SP.sm },
  sectionTitle:    { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },
  sectionHeader:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.sm },
  customerName:    { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  customerEmail:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  metaRow:         { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: SP.xs },
  metaRowView:     { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  metaLabel:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  metaValue:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  resolutionBadge: { backgroundColor: PURPLE_DIM, paddingHorizontal: SP.sm, paddingVertical: 3, borderRadius: RADIUS.pill },
  resolutionText:  { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE },
  itemName:        { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  itemVariant:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  itemRow:         { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  itemQty:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  itemPrice:       { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  itemTotal:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  reasonRow:       { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs },
  reasonText:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN },
  explanationText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  returnImage:     { width: 80, height: 80, borderRadius: RADIUS.sm, marginRight: SP.sm },
  noPhotos:        { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: SP.sm },
  policyRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  policyText:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1, lineHeight: 18 },
  actionsGap:      { gap: SP.sm },
  denyForm:        { gap: SP.sm },
  denyLabel:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  denyInput:       {
    backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: BORDER, padding: SP.md, minHeight: 90, color: FG,
    fontFamily: FONT.regular, fontSize: FS.sm, textAlignVertical: 'top',
  },
  denyButtons:     { flexDirection: 'row', gap: SP.sm },
  readOnlySummary: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: SUCCESS + '44', padding: SP.md,
  },
  readOnlyText:    { fontSize: FS.sm, fontFamily: FONT.semibold, flex: 1 },
  trackingRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  trackingNumber:  { fontSize: FS.sm, fontFamily: FONT.medium, color: CYAN, flex: 1 },
});
