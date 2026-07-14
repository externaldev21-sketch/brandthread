/**
 * Production Detail Screen
 * Params: id (string)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  getProductionOrder,
  advanceProductionStage,
  addProductionUpdate,
  updateQcCheck,
  reportProductionIssue,
  resolveProductionIssue,
  confirmDelivery,
} from '@/services/manufacturerService';
import {
  PRODUCTION_STAGES, ISSUE_TYPES,
  ProductionOrder, IssueType, IssueSeverity, QcResult,
} from '@/services/manufacturerTypes';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, StatusBadge, SectionHeader, FormInput,
} from '@/components/BrandthreadUI';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, BLUE, BLUE_DIM,
  GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function severityColor(s: IssueSeverity) {
  switch (s) {
    case 'low': return SUCCESS;
    case 'medium': return ORANGE;
    case 'high': return RED;
    case 'critical': return '#FF0000';
  }
}

function paymentStatusVariant(s: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (s) {
    case 'paid': return 'success';
    case 'due': return 'warning';
    case 'overdue': return 'error';
    default: return 'neutral';
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProductionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);

  // Update form state
  const [updateMode, setUpdateMode] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [isDelayNotice, setIsDelayNotice] = useState(false);
  const [submittingUpdate, setSubmittingUpdate] = useState(false);

  // Issue form state
  const [issueMode, setIssueMode] = useState(false);
  const [issueType, setIssueType] = useState<IssueType>('quality_issue');
  const [issueSeverity, setIssueSeverity] = useState<IssueSeverity>('medium');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDesc, setIssueDesc] = useState('');
  const [issueResolution, setIssueResolution] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);

  // Shipping state
  const [trackingNum, setTrackingNum] = useState('');
  const [carrier, setCarrier] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const o = await getProductionOrder(id);
    setOrder(o ?? null);
    if (o?.trackingNumber) setTrackingNum(o.trackingNumber);
    if (o?.trackingCarrier) setCarrier(o.trackingCarrier);
    if (o?.shippingAddress) setShippingAddress(o.shippingAddress);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
        <BrandthreadHeader title="Production" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: MUTED, fontFamily: FONT.regular }}>Order not found.</Text>
        </View>
      </View>
    );
  }

  const stageKeys = PRODUCTION_STAGES.map(s => s.key);
  const currentIdx = stageKeys.indexOf(order.currentStage);
  const progressPct = Math.round((currentIdx / (PRODUCTION_STAGES.length - 1)) * 100);
  const currentStageLabel = PRODUCTION_STAGES[currentIdx]?.label ?? order.currentStage;

  const paidAmount = order.payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleAdvance() {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await advanceProductionStage(order.id);
    if (updated) setOrder({ ...updated });
  }

  async function handleSubmitUpdate() {
    if (!order || !updateMsg.trim()) return;
    setSubmittingUpdate(true);
    const updated = await addProductionUpdate(order.id, {
      message: updateMsg.trim(),
      isDelayNotice,
    });
    if (updated) setOrder({ ...updated });
    setUpdateMsg('');
    setIsDelayNotice(false);
    setUpdateMode(false);
    setSubmittingUpdate(false);
  }

  async function handleQc(checkId: string, result: QcResult) {
    if (!order) return;
    Haptics.selectionAsync();
    await updateQcCheck(order.id, checkId, result);
    const updated = await getProductionOrder(order.id);
    if (updated) setOrder({ ...updated });
  }

  async function handleSubmitIssue() {
    if (!order) return;
    if (!issueTitle.trim() || !issueDesc.trim()) {
      Alert.alert('Required', 'Please fill in title and description.');
      return;
    }
    setSubmittingIssue(true);
    await reportProductionIssue(order.id, {
      type: issueType,
      severity: issueSeverity,
      title: issueTitle.trim(),
      description: issueDesc.trim(),
      requestedResolution: issueResolution.trim() || undefined,
      imageUris: [],
      fileIds: [],
    });
    const refreshed = await getProductionOrder(order.id);
    if (refreshed) setOrder({ ...refreshed });
    setIssueTitle('');
    setIssueDesc('');
    setIssueResolution('');
    setIssueMode(false);
    setSubmittingIssue(false);
  }

  async function handleResolveIssue(issueId: string) {
    if (!order) return;
    Alert.alert('Resolve Issue', 'Add resolution notes (optional):', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Resolved', onPress: async () => {
          if (!order) return;
          await resolveProductionIssue(order.id, issueId, 'Resolved by seller.');
          const refreshed = await getProductionOrder(order.id);
          if (refreshed) setOrder({ ...refreshed });
        },
      },
    ]);
  }

  async function handleConfirmDelivery() {
    if (!order) return;
    Alert.alert('Confirm Delivery', 'Mark this order as delivered?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm', onPress: async () => {
          if (!order) return;
          await confirmDelivery(order.id);
          const refreshed = await getProductionOrder(order.id);
          if (refreshed) setOrder({ ...refreshed });
        },
      },
    ]);
  }

  // ── QC summary ──────────────────────────────────────────────────────────────
  const qcPassed = order.qcChecklist.filter(c => c.result === 'pass').length;
  const qcFailed = order.qcChecklist.filter(c => c.result === 'fail').length;
  const qcReview = order.qcChecklist.filter(c => c.result === 'needs_review').length;

  const canConfirmDelivery = order.currentStage === 'ready_to_ship' || order.currentStage === 'shipped';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      <BrandthreadHeader
        title="Production"
        subtitle={order.productName}
        onBack={() => router.back()}
        rightElement={
          <StatusBadge
            label={order.status.toUpperCase()}
            variant={order.status === 'active' ? 'purple' : order.status === 'completed' ? 'success' : 'neutral'}
          />
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60, gap: SP.md, paddingHorizontal: SP.md, paddingTop: SP.sm }}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── 1. Stage Progress ─────────────────────────────────────────── */}
        <GradientCard glow colors={GRAD_CARD_GLOW}>
          <Text style={styles.cardTitle}>Stage Progress</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.stageLabel}>
            Stage {currentIdx + 1} of {PRODUCTION_STAGES.length}: {currentStageLabel}
          </Text>
          <View style={{ flexDirection: 'row', gap: SP.md, marginTop: SP.sm }}>
            <Text style={styles.dateText}>Start: {fmtDate(order.startDate)}</Text>
            <Text style={styles.dateText}>Est. done: {fmtDate(order.estimatedCompletionDate)}</Text>
          </View>
        </GradientCard>

        {/* ── 2. Cost Summary ───────────────────────────────────────────── */}
        <BrandthreadCard>
          <Text style={styles.cardTitle}>Cost Summary</Text>
          <View style={styles.costRow}>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Total</Text>
              <Text style={styles.costValue}>${order.totalCost.toFixed(2)}</Text>
            </View>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Deposit</Text>
              <Text style={styles.costValue}>${order.depositAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Paid</Text>
              <Text style={[styles.costValue, { color: SUCCESS }]}>${paidAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Remaining</Text>
              <Text style={[styles.costValue, { color: ORANGE }]}>${order.remainingBalance.toFixed(2)}</Text>
            </View>
          </View>

          {order.payments.length > 0 && (
            <View style={{ marginTop: SP.sm, gap: 6 }}>
              {order.payments.map(pay => (
                <View key={pay.id} style={styles.paymentRow}>
                  <Text style={styles.paymentType}>{pay.type.charAt(0).toUpperCase() + pay.type.slice(1)}</Text>
                  <Text style={styles.paymentAmount}>${pay.amount.toFixed(2)}</Text>
                  <StatusBadge label={pay.status.toUpperCase()} variant={paymentStatusVariant(pay.status)} small />
                  {pay.dueDate && <Text style={styles.paymentDue}>Due {fmtDate(pay.dueDate)}</Text>}
                </View>
              ))}
            </View>
          )}
        </BrandthreadCard>

        {/* ── 3. Production Stages ──────────────────────────────────────── */}
        <BrandthreadCard>
          <Text style={styles.cardTitle}>Production Stages</Text>
          <View style={{ gap: 8, marginTop: SP.sm }}>
            {PRODUCTION_STAGES.map((stage, idx) => {
              const stageData = order.stages.find(s => s.key === stage.key);
              const isCompleted = !!stageData?.completedAt;
              const isCurrent = stage.key === order.currentStage && !isCompleted;
              return (
                <View key={stage.key} style={styles.stageRow}>
                  <View style={[
                    styles.stageDot,
                    isCompleted && { backgroundColor: SUCCESS },
                    isCurrent && { backgroundColor: PURPLE },
                    !isCompleted && !isCurrent && { backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER },
                  ]}>
                    {isCompleted && <Feather name="check" size={10} color="#fff" />}
                    {isCurrent && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stageName, isCurrent && { color: PURPLE_LIGHT }, isCompleted && { color: SUCCESS }]}>
                      {stage.label}
                    </Text>
                    {isCompleted && <Text style={styles.stageDate}>{fmtDate(stageData?.completedAt)}</Text>}
                    {isCurrent && <Text style={[styles.stageDate, { color: PURPLE }]}>In progress</Text>}
                  </View>
                </View>
              );
            })}
          </View>

          {order.currentStage !== 'delivered' && (
            <SecondaryButton
              label="Advance to next stage (demo)"
              onPress={handleAdvance}
              icon="chevron-right"
              small
              style={{ marginTop: SP.md }}
            />
          )}
        </BrandthreadCard>

        {/* ── 4. Updates Feed ───────────────────────────────────────────── */}
        <BrandthreadCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm }}>
            <Text style={styles.cardTitle}>Updates</Text>
            <TouchableOpacity onPress={() => setUpdateMode(v => !v)}>
              <Text style={styles.actionLink}>{updateMode ? 'Cancel' : '+ Add update'}</Text>
            </TouchableOpacity>
          </View>

          {updateMode && (
            <View style={{ gap: SP.sm, marginBottom: SP.md, padding: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md }}>
              <FormInput
                label="Message"
                value={updateMsg}
                onChange={setUpdateMsg}
                placeholder="Describe the update…"
                multiline
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.switchLabel}>Delay notice</Text>
                <Switch
                  value={isDelayNotice}
                  onValueChange={setIsDelayNotice}
                  trackColor={{ true: ORANGE, false: BORDER }}
                  thumbColor={isDelayNotice ? ORANGE : SUBTLE}
                />
              </View>
              <PrimaryButton
                label="Submit update"
                onPress={handleSubmitUpdate}
                loading={submittingUpdate}
                small
              />
            </View>
          )}

          {order.updates.length === 0 && (
            <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm }}>No updates yet.</Text>
          )}
          <View style={{ gap: 8 }}>
            {[...order.updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(upd => (
              <View key={upd.id} style={styles.updateCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text style={styles.updateTime}>{fmtTime(upd.createdAt)}</Text>
                  {upd.isDelayNotice && <StatusBadge label="DELAY" variant="warning" small />}
                </View>
                <Text style={styles.updateMsg}>{upd.message}</Text>
              </View>
            ))}
          </View>
        </BrandthreadCard>

        {/* ── 5. Quality Control ────────────────────────────────────────── */}
        <BrandthreadCard>
          <Text style={styles.cardTitle}>Quality Control</Text>
          <Text style={styles.qcSummary}>
            {qcPassed} passed · {qcFailed} failed · {qcReview} need review
          </Text>
          <View style={{ gap: 10, marginTop: SP.sm }}>
            {order.qcChecklist.map(check => (
              <View key={check.id} style={styles.qcRow}>
                <Text style={styles.qcLabel}>{check.label}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['pass', 'fail', 'needs_review'] as QcResult[]).map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.qcBtn,
                        check.result === r && r === 'pass' && { backgroundColor: SUCCESS_DIM, borderColor: SUCCESS },
                        check.result === r && r === 'fail' && { backgroundColor: RED_DIM, borderColor: RED },
                        check.result === r && r === 'needs_review' && { backgroundColor: ORANGE_DIM, borderColor: ORANGE },
                      ]}
                      onPress={() => handleQc(check.id, r)}
                    >
                      <Text style={[
                        styles.qcBtnText,
                        check.result === r && r === 'pass' && { color: SUCCESS },
                        check.result === r && r === 'fail' && { color: RED },
                        check.result === r && r === 'needs_review' && { color: ORANGE },
                      ]}>
                        {r === 'pass' ? 'Pass' : r === 'fail' ? 'Fail' : 'Review'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </BrandthreadCard>

        {/* ── 6. Issues ─────────────────────────────────────────────────── */}
        <BrandthreadCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm }}>
            <Text style={styles.cardTitle}>Issues</Text>
            <TouchableOpacity onPress={() => setIssueMode(v => !v)}>
              <Text style={styles.actionLink}>{issueMode ? 'Cancel' : '+ Report issue'}</Text>
            </TouchableOpacity>
          </View>

          {issueMode && (
            <View style={{ gap: SP.sm, marginBottom: SP.md, padding: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md }}>
              <Text style={styles.formSectionLabel}>Issue Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {ISSUE_TYPES.map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.chip, issueType === t.key && styles.chipActive]}
                      onPress={() => setIssueType(t.key)}
                    >
                      <Text style={[styles.chipText, issueType === t.key && styles.chipTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.formSectionLabel}>Severity</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['low', 'medium', 'high', 'critical'] as IssueSeverity[]).map(sev => (
                  <TouchableOpacity
                    key={sev}
                    style={[styles.chip, issueSeverity === sev && { backgroundColor: severityColor(sev) + '30', borderColor: severityColor(sev) }]}
                    onPress={() => setIssueSeverity(sev)}
                  >
                    <Text style={[styles.chipText, issueSeverity === sev && { color: severityColor(sev) }]}>
                      {sev.charAt(0).toUpperCase() + sev.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <FormInput label="Title" value={issueTitle} onChange={setIssueTitle} placeholder="Brief issue title" />
              <FormInput label="Description" value={issueDesc} onChange={setIssueDesc} placeholder="Describe the issue…" multiline />
              <FormInput label="Requested Resolution" value={issueResolution} onChange={setIssueResolution} placeholder="What do you want done?" multiline />
              <PrimaryButton label="Submit Issue" onPress={handleSubmitIssue} loading={submittingIssue} small />
            </View>
          )}

          {order.issues.length === 0 && !issueMode && (
            <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm }}>No issues reported.</Text>
          )}
          <View style={{ gap: 10 }}>
            {order.issues.map(iss => (
              <View key={iss.id} style={styles.issueCard}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <StatusBadge label={iss.type.replace('_', ' ').toUpperCase()} variant="info" small />
                  <View style={[styles.sevBadge, { backgroundColor: severityColor(iss.severity) + '25' }]}>
                    <Text style={[styles.sevBadgeText, { color: severityColor(iss.severity) }]}>
                      {iss.severity.toUpperCase()}
                    </Text>
                  </View>
                  <StatusBadge
                    label={iss.status.toUpperCase()}
                    variant={iss.status === 'resolved' ? 'success' : iss.status === 'open' ? 'error' : 'warning'}
                    small
                  />
                </View>
                <Text style={styles.issueTitle}>{iss.title}</Text>
                <Text style={styles.issueDesc}>{iss.description}</Text>
                {iss.status === 'open' && (
                  <TouchableOpacity onPress={() => handleResolveIssue(iss.id)} style={styles.resolveBtn}>
                    <Text style={styles.resolveBtnText}>Resolve</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </BrandthreadCard>

        {/* ── 7. Shipping ───────────────────────────────────────────────── */}
        <BrandthreadCard>
          <Text style={styles.cardTitle}>Shipping</Text>
          <View style={{ gap: SP.sm, marginTop: SP.sm }}>
            <FormInput label="Tracking Number" value={trackingNum} onChange={setTrackingNum} placeholder="e.g. 1Z999AA1012345678" />
            <FormInput label="Carrier" value={carrier} onChange={setCarrier} placeholder="e.g. UPS, FedEx, DHL" />
            <FormInput label="Shipping Address" value={shippingAddress} onChange={setShippingAddress} placeholder="Delivery address" multiline />
            {canConfirmDelivery && (
              <PrimaryButton label="Confirm Delivery" onPress={handleConfirmDelivery} icon="check-circle" small />
            )}
          </View>
        </BrandthreadCard>

        {/* ── 8. Action Buttons ─────────────────────────────────────────── */}
        <View style={{ gap: SP.sm }}>
          <SecondaryButton
            label="Message Manufacturer"
            icon="message-circle"
            onPress={() => Alert.alert('Messages', 'Open manufacturer messages')}
          />
          <SecondaryButton
            label="Add Internal Note"
            icon="lock"
            onPress={() => Alert.alert('Note', 'Add an internal note')}
          />
          <SecondaryButton
            label="View Files"
            icon="file"
            onPress={() => Alert.alert('Files', 'File manager coming soon')}
          />
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SUBTLE_COLOR = 'rgba(244,244,255,0.28)';

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: SP.sm,
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: RADIUS.pill,
  },
  stageLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  dateText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  costItem: {
    alignItems: 'center',
    gap: 2,
  },
  costLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  costValue: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  paymentType: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
  },
  paymentAmount: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  paymentDue: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
  },
  stageDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stageName: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  stageDate: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginTop: 1,
  },
  updateCard: {
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  updateTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },
  updateMsg: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 18,
  },
  switchLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  qcSummary: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    marginBottom: SP.sm,
  },
  qcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.sm,
  },
  qcLabel: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
  },
  qcBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
  },
  qcBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  chipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  chipTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  formSectionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  issueCard: {
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md,
    padding: SP.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  issueTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: 2,
  },
  issueDesc: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 18,
  },
  resolveBtn: {
    marginTop: SP.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    borderColor: SUCCESS,
    backgroundColor: SUCCESS_DIM,
  },
  resolveBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: SUCCESS,
  },
  sevBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  sevBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    letterSpacing: 0.2,
  },
  actionLink: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
  },
});
