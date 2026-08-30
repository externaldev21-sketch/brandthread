/**
 * Sample Detail Screen — Brandthread Manufacturer Hub
 * Params: id (string)
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, Alert, Image,
  StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { formatCents } from '@/lib/money';
import { File as FSFile } from 'expo-file-system';

import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, StatusBadge, SectionHeader, FormInput,
  LoadingSkeleton,
} from '@/components/BrandthreadUI';

import {
  getSample, submitSampleReview, addSampleRevision,
  getOrCreateConversation,
  uploadSampleImage,
  createSampleCheckoutSession, confirmSamplePayment,
} from '@/services/manufacturerService';
import { Sample, SampleReview, SampleStatus } from '@/services/manufacturerTypes';

import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM,
  SUCCESS, RED, ORANGE,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

// ─── Constants ────────────────────────────────────────────────────────────────

const SAMPLE_STATUSES: SampleStatus[] = [
  'requested', 'awaiting_payment', 'paid', 'in_development',
  'shipped', 'delivered', 'review_needed', 'approved',
];

const STATUS_LABELS: Record<string, string> = {
  requested: 'Requested',
  awaiting_payment: 'Awaiting Payment',
  paid: 'Paid',
  in_development: 'In Development',
  revision_requested: 'Revision Requested',
  shipped: 'Shipped',
  delivered: 'Delivered',
  review_needed: 'Review Needed',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const TYPE_LABELS: Record<string, string> = {
  proto: 'Prototype',
  size_set: 'Size Set',
  pre_production: 'Pre-Production',
  production: 'Production',
};

const RATING_DIMENSIONS: { key: keyof RatingState; label: string }[] = [
  { key: 'overallRating', label: 'Overall' },
  { key: 'qualityRating', label: 'Quality' },
  { key: 'fitRating', label: 'Fit' },
  { key: 'materialRating', label: 'Material' },
  { key: 'colorRating', label: 'Color' },
  { key: 'printRating', label: 'Print' },
  { key: 'packagingRating', label: 'Packaging' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple' {
  if (status === 'approved') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'error';
  if (status === 'shipped' || status === 'delivered') return 'info';
  if (status === 'review_needed') return 'warning';
  if (status === 'in_development' || status === 'revision_requested') return 'purple';
  return 'neutral';
}

function priorityVariant(p: string): 'error' | 'warning' | 'neutral' {
  if (p === 'high') return 'error';
  if (p === 'medium') return 'warning';
  return 'neutral';
}

// ─── StarRow ──────────────────────────────────────────────────────────────────

function StarRow({
  rating,
  onRate,
  readonly,
}: {
  rating: number;
  onRate?: (r: number) => void;
  readonly?: boolean;
}) {
  return (
    <View style={sr.row}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity
          key={i}
          onPress={() => !readonly && onRate?.(i)}
          disabled={readonly}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <Feather
            name="star"
            size={ICON.md}
            color={i <= rating ? '#F59E0B' : BORDER}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const sr = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RatingState {
  overallRating: number;
  qualityRating: number;
  fitRating: number;
  materialRating: number;
  colorRating: number;
  printRating: number;
  packagingRating: number;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SampleDetailScreen() {
  const colors = useColors();
  const { id, paymentPrompt, paymentReturn } = useLocalSearchParams<{ id: string; paymentPrompt?: string; paymentReturn?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reviewSectionRef = useRef<ScrollView>(null);
  const paymentPromptConsumed = useRef(false);
  const paymentReturnConsumed = useRef(false);

  const [sample, setSample] = useState<Sample | null>(null);
  const [manufacturerName, setManufacturerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Review form state
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'revision_requested' | 'rejected'>('approved');
  const [ratings, setRatings] = useState<RatingState>({
    overallRating: 0, qualityRating: 0, fitRating: 0,
    materialRating: 0, colorRating: 0, printRating: 0, packagingRating: 0,
  });
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // Revision form state
  const [revisionMode, setRevisionMode] = useState(false);
  const [revTitle, setRevTitle] = useState('');
  const [revNotes, setRevNotes] = useState('');
  const [revPriority, setRevPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [revDeadline, setRevDeadline] = useState('');
  const [revSubmitting, setRevSubmitting] = useState(false);

  // Image upload state
  const [imageUploading, setImageUploading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const s = await getSample(id);
      if (s) {
        setSample(s);
        setManufacturerName(s.manufacturerName ?? 'Manufacturer');
      } else {
        setSample(null);
      }
    } catch {
      setSample(null);
      setLoadError('Could not load this sample. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const confirmHostedPayment = useCallback(async () => {
    if (!sample || paying) return false;
    setPaying(true);
    setPaymentError('');
    try {
      await confirmSamplePayment(sample.id);
      await load();
      return true;
    } catch (error: any) {
      setPaymentError(error?.message?.includes('not succeeded')
        ? 'Payment is still being confirmed. Refresh in a moment and try again.'
        : error?.message ?? 'Could not confirm payment. Please try again.');
      return false;
    } finally {
      setPaying(false);
    }
  }, [sample, paying, load]);

  const handlePaySecurely = useCallback(async () => {
    if (!sample || sample.status !== 'pending_payment' || paying || sample.manufacturerPayoutReady !== true) return;
    setPaying(true);
    setPaymentError('');
    try {
      const returnUrl = Linking.createURL('sample-detail', {
        queryParams: { id: sample.id, paymentReturn: '1' },
      });
      const session = await createSampleCheckoutSession(sample.id, returnUrl);
      if (!session.url) {
        // The idempotent backend can return no URL for a session that Stripe
        // already settled. Confirm before treating it as unavailable.
        setPaying(false);
        const confirmed = await confirmHostedPayment();
        if (!confirmed) setPaymentError('Secure checkout is unavailable and payment is not yet confirmed. Please try again.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(session.url, returnUrl);
      if (result.type === 'success') {
        setPaying(false);
        await confirmHostedPayment();
        return;
      }
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setPaymentError('Checkout was cancelled. Your order is still awaiting payment.');
        return;
      }
      setPaymentError('Secure checkout did not return a payment confirmation. Please try again.');
    } catch (error: any) {
      const message = String(error?.message ?? '');
      setPaymentError(
        message.includes('Manufacturer cannot receive') || message.includes('payouts are not ready')
          ? 'The manufacturer must finish Stripe payout setup before you can pay. Message them to complete verification, then refresh this order.'
          : message || 'Could not open secure checkout. Please try again.',
      );
    } finally {
      setPaying(false);
    }
  }, [sample, paying, confirmHostedPayment]);

  useEffect(() => {
    if (paymentPrompt === '1' && !paymentPromptConsumed.current && sample?.status === 'pending_payment' && sample.manufacturerPayoutReady === true && !paying) {
      paymentPromptConsumed.current = true;
      void handlePaySecurely();
    }
  }, [paymentPrompt, sample?.id, sample?.status, paying, handlePaySecurely]);

  // A Checkout redirect can recreate the app (cold return) or update route
  // params in place (warm return). Confirmation is idempotent server-side;
  // consume this marker locally and remove it from the route to avoid loops.
  useEffect(() => {
    if (paymentReturn !== '1' || paymentReturnConsumed.current || !sample || paying) return;
    paymentReturnConsumed.current = true;
    router.setParams({ paymentReturn: undefined, paymentPrompt: undefined } as never);
    void confirmHostedPayment();
  }, [paymentReturn, sample?.id, paying, confirmHostedPayment, router]);

  const setRating = (dim: keyof RatingState) => (val: number) =>
    setRatings(prev => ({ ...prev, [dim]: val }));

  const handleSubmitReview = async () => {
    if (!sample) return;
    if (ratings.overallRating === 0) {
      Alert.alert('Rating Required', 'Please provide an overall rating.');
      return;
    }
    setReviewSubmitting(true);
    try {
      await submitSampleReview(sample.id, {
        decision: reviewDecision,
        ...ratings,
        notes: reviewNotes,
        imageUris: [],
      });
      setReviewMode(false);
      await load();
    } catch {
      Alert.alert('Error', 'Failed to submit review.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleSubmitRevision = async () => {
    if (!sample) return;
    if (!revTitle.trim()) {
      Alert.alert('Title Required', 'Please enter a revision title.');
      return;
    }
    setRevSubmitting(true);
    try {
      await addSampleRevision(sample.id, {
        title: revTitle,
        notes: revNotes,
        priority: revPriority,
        deadline: revDeadline || undefined,
        imageUris: [],
        fileIds: [],
      });
      setRevisionMode(false);
      setRevTitle(''); setRevNotes(''); setRevDeadline('');
      await load();
    } catch {
      Alert.alert('Error', 'Failed to submit revision request.');
    } finally {
      setRevSubmitting(false);
    }
  };

  const handleAddImage = useCallback(async () => {
    if (!sample || imageUploading) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please allow access to your photo library to upload sample images.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
      allowsEditing: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp',
      heic: 'image/heic', heif: 'image/heif',
    };
    const contentType = asset.mimeType ?? mimeMap[ext] ?? 'image/jpeg';

    setImageUploading(true);
    try {
      // Read the file bytes so we can send them as the raw PUT body and report
      // an accurate size for server-side validation.
      const file = new FSFile(uri);
      const bytes = await file.bytes();
      // The authenticated API enforces the byte limit and validates image
      // signatures before it writes any object to private storage.
      await uploadSampleImage(sample.id, contentType, bytes);
      await load();
    } catch (err: any) {
      console.error('[SampleDetail] image upload error:', err);
      Alert.alert('Upload Failed', err?.message ?? 'Could not upload image. Please try again.');
    } finally {
      setImageUploading(false);
    }
  }, [sample, imageUploading, load]);

  const handleMessage = async () => {
    if (!sample) return;
    const threadId = sample.threadId ?? (await getOrCreateConversation(sample.manufacturerId, {
      sampleId: sample.id,
      contextLabel: `Sample: ${sample.productName}`,
    })).id;
    router.push({ pathname: '/manufacturer-messages', params: { threadId } } as any);
  };

  if (loading) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Sample Details" onBack={() => router.back()} />
        <View style={s.loadingContainer}>
          <LoadingSkeleton height={120} style={s.skeleton} />
          <LoadingSkeleton height={200} style={s.skeleton} />
          <LoadingSkeleton height={160} style={s.skeleton} />
        </View>
      </BrandthreadScreen>
    );
  }

  if (!sample) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Sample Details" onBack={() => router.back()} />
        <View style={s.centered}>
          <Text style={s.errorText}>{loadError ?? 'Sample not found.'}</Text>
          {loadError && (
            <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.8}>
              <Feather name="refresh-cw" size={14} color={ON_DARK} />
              <Text style={s.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          )}
        </View>
      </BrandthreadScreen>
    );
  }

  const canReview = sample.status === 'review_needed' || sample.status === 'delivered';
  const currentStatusIdx = SAMPLE_STATUSES.indexOf(sample.status as SampleStatus);

  return (
    <BrandthreadScreen>
      <BrandthreadHeader
        title="Sample Details"
        subtitle={manufacturerName}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={reviewSectionRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + COMP.buttonH + 24 }]}
        >
          {/* ── HEADER BADGES ────────────────────────────────────── */}
          <View style={s.badgeRow}>
            <StatusBadge label={STATUS_LABELS[sample.status] ?? sample.status} variant={statusVariant(sample.status)} />
            <StatusBadge label={TYPE_LABELS[sample.type] ?? sample.type} variant="neutral" />
          </View>
          {sample.status === 'pending_payment' && (
            <BrandthreadCard style={s.section} elevated>
              <Text style={s.paymentTitle}>Payment required</Text>
              <Text style={s.paymentText}>
                {sample.manufacturerPayoutReady !== true
                  ? 'Payment is unavailable until the manufacturer connects and verifies their Stripe payout account. Message them, then refresh this order.'
                  : 'Pay securely to send this sample into production. Funds are routed to the manufacturer through Stripe.'}
              </Text>
              {!!paymentError && <Text style={s.paymentError}>{paymentError}</Text>}
              <PrimaryButton
                label={sample.manufacturerPayoutReady !== true ? 'Manufacturer payout setup required' : 'Pay securely'}
                onPress={handlePaySecurely}
                loading={paying}
                disabled={sample.manufacturerPayoutReady !== true}
                icon={sample.manufacturerPayoutReady !== true ? 'alert-circle' : 'lock'}
              />
              {sample.manufacturerPayoutReady !== true && (
                <TouchableOpacity onPress={handleMessage} style={{ marginTop: SP.sm }}>
                  <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold, textAlign: 'center' }}>
                    Message manufacturer
                  </Text>
                </TouchableOpacity>
              )}
            </BrandthreadCard>
          )}

          {/* ── STATUS TIMELINE ──────────────────────────────────── */}
          <SectionHeader title="Progress" style={s.sectionHeader} />
          <BrandthreadCard style={s.section}>
            {SAMPLE_STATUSES.map((st, idx) => {
              const isCompleted = idx < currentStatusIdx;
              const isCurrent = idx === currentStatusIdx;
              const isFuture = idx > currentStatusIdx;
              return (
                <View key={st} style={s.timelineRow}>
                  <View style={s.timelineLeft}>
                    <View style={[
                      s.timelineDot,
                      isCurrent && s.timelineDotCurrent,
                      isCompleted && s.timelineDotCompleted,
                    ]}>
                      {isCompleted
                        ? <Feather name="check" size={10} color={ON_DARK} />
                        : isCurrent
                          ? null
                          : null
                      }
                    </View>
                    {idx < SAMPLE_STATUSES.length - 1 && (
                      <View style={[s.timelineLine, isCompleted && s.timelineLineCompleted]} />
                    )}
                  </View>
                  <Text style={[
                    s.timelineLabel,
                    isCurrent && s.timelineLabelCurrent,
                    isCompleted && s.timelineLabelCompleted,
                    isFuture && s.timelineLabelFuture,
                  ]}>
                    {STATUS_LABELS[st]}
                  </Text>
                </View>
              );
            })}
          </BrandthreadCard>

          {/* ── DETAILS ──────────────────────────────────────────── */}
          <SectionHeader title="Details" style={s.sectionHeader} />
          <BrandthreadCard style={s.section}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Product</Text>
              <Text style={s.infoValue}>{sample.productName}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Manufacturer</Text>
              <Text style={s.infoValue}>{manufacturerName}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Type</Text>
              <Text style={s.infoValue}>{TYPE_LABELS[sample.type]}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Cost</Text>
              <Text style={s.infoValue}>{formatCents(sample.costCents)}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Payment</Text>
              <Text style={[s.infoValue, sample.paymentStatus === 'paid' && s.paidText]}>
                {sample.paymentStatus.charAt(0).toUpperCase() + sample.paymentStatus.slice(1)}
              </Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Est. Completion</Text>
              <Text style={s.infoValue}>{formatDate(sample.estimatedCompletionDate)}</Text>
            </View>
            {sample.trackingNumber && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Tracking</Text>
                <Text style={s.infoValue}>
                  {sample.trackingNumber}{sample.trackingCarrier ? ` · ${sample.trackingCarrier}` : ''}
                </Text>
              </View>
            )}
            {sample.notes && (
              <>
                <View style={s.separator} />
                <Text style={s.notesLabel}>Notes</Text>
                <Text style={s.notesText}>{sample.notes}</Text>
              </>
            )}
          </BrandthreadCard>

          {/* ── IMAGES ───────────────────────────────────────────── */}
          <SectionHeader
            title="Images"
            action={imageUploading ? undefined : { label: 'Add Image', onPress: handleAddImage }}
            style={s.sectionHeader}
          />
          {imageUploading && (
            <View style={s.uploadingRow}>
              <ActivityIndicator size="small" color={colors.accentForeground} />
              <Text style={s.uploadingText}>Uploading…</Text>
            </View>
          )}
          {sample.imageUris.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.imageScroll} contentContainerStyle={s.imageScrollContent}>
              {sample.imageUris.map((uri, i) => (
                <Image key={i} source={{ uri }} style={s.sampleImage} />
              ))}
            </ScrollView>
          ) : (
            <TouchableOpacity onPress={handleAddImage} disabled={imageUploading} activeOpacity={0.75}>
              <GradientCard style={[s.section, s.imagePlaceholder]}>
                <Feather name="camera" size={ICON.xl} color={colors.accentForeground} style={{ marginBottom: SP.sm }} />
                <Text style={s.imagePlaceholderText}>No images yet</Text>
                <Text style={s.imagePlaceholderSub}>Tap to add a sample progress photo</Text>
              </GradientCard>
            </TouchableOpacity>
          )}

          {/* ── REVISION HISTORY ─────────────────────────────────── */}
          {sample.revisions.length > 0 && (
            <>
              <SectionHeader title={`Revision History (${sample.revisions.length})`} style={s.sectionHeader} />
              {sample.revisions.map(rev => (
                <BrandthreadCard key={rev.id} style={s.section}>
                  <View style={s.revHeader}>
                    <Text style={s.revTitle}>{rev.title}</Text>
                    <View style={s.revBadges}>
                      <StatusBadge
                        label={rev.priority.charAt(0).toUpperCase() + rev.priority.slice(1)}
                        variant={priorityVariant(rev.priority)}
                        small
                      />
                      <StatusBadge
                        label={rev.status.replace(/_/g, ' ')}
                        variant={rev.status === 'completed' ? 'success' : rev.status === 'in_progress' ? 'purple' : 'neutral'}
                        small
                      />
                    </View>
                  </View>
                  {rev.notes ? <Text style={s.revNotes}>{rev.notes}</Text> : null}
                  {rev.deadline && <Text style={s.revDeadline}>Deadline: {formatDate(rev.deadline)}</Text>}
                </BrandthreadCard>
              ))}
            </>
          )}

          {/* ── REVIEW SECTION ───────────────────────────────────── */}
          {(canReview || sample.review) && (
            <>
              <SectionHeader title="Review" style={s.sectionHeader} />
              {sample.review ? (
                <BrandthreadCard style={s.section} elevated>
                  <View style={s.reviewHeader}>
                    <Text style={s.reviewDecisionLabel}>Decision</Text>
                    <StatusBadge
                      label={sample.review.decision === 'approved' ? 'Approved' : sample.review.decision === 'rejected' ? 'Rejected' : 'Revision Requested'}
                      variant={sample.review.decision === 'approved' ? 'success' : sample.review.decision === 'rejected' ? 'error' : 'warning'}
                    />
                  </View>
                  {RATING_DIMENSIONS.map(dim => (
                    <View key={dim.key} style={s.ratingRow}>
                      <Text style={s.ratingLabel}>{dim.label}</Text>
                      <StarRow rating={(sample.review as any)[dim.key]} readonly />
                    </View>
                  ))}
                  {sample.review.notes ? (
                    <>
                      <View style={s.separator} />
                      <Text style={s.notesLabel}>Notes</Text>
                      <Text style={s.notesText}>{sample.review.notes}</Text>
                    </>
                  ) : null}
                </BrandthreadCard>
              ) : canReview && reviewMode ? (
                <BrandthreadCard style={s.section} elevated>
                  <Text style={s.reviewFormTitle}>Write a Review</Text>

                  {/* Decision chips */}
                  <Text style={s.chipGroupLabel}>Decision</Text>
                  <View style={s.chipRow}>
                    {(
                      [
                        { key: 'approved', label: 'Approve ✓', variant: 'success' },
                        { key: 'revision_requested', label: 'Request Revision ↺', variant: 'warning' },
                        { key: 'rejected', label: 'Reject ✗', variant: 'error' },
                      ] as const
                    ).map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => setReviewDecision(opt.key)}
                        style={[s.chip, reviewDecision === opt.key && s.chipActive]}
                      >
                        <Text style={[s.chipText, reviewDecision === opt.key && s.chipTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Star ratings */}
                  {RATING_DIMENSIONS.map(dim => (
                    <View key={dim.key} style={s.ratingRow}>
                      <Text style={s.ratingLabel}>{dim.label}</Text>
                      <StarRow rating={ratings[dim.key]} onRate={setRating(dim.key)} />
                    </View>
                  ))}

                  {/* Notes */}
                  <View style={s.formGap}>
                    <FormInput
                      label="Notes"
                      value={reviewNotes}
                      onChange={setReviewNotes}
                      placeholder="Share detailed feedback for the manufacturer…"
                      multiline
                    />
                    <PrimaryButton
                      label="Submit Review"
                      onPress={handleSubmitReview}
                      loading={reviewSubmitting}
                      icon="send"
                    />
                    <SecondaryButton
                      label="Cancel"
                      onPress={() => setReviewMode(false)}
                    />
                  </View>
                </BrandthreadCard>
              ) : canReview && !reviewMode ? (
                <View style={s.section}>
                  <SecondaryButton
                    label="Write Review"
                    onPress={() => setReviewMode(true)}
                    icon="star"
                  />
                </View>
              ) : null}
            </>
          )}

          {/* ── REVISION REQUEST FORM ────────────────────────────── */}
          {revisionMode && (
            <>
              <SectionHeader title="Request Revision" style={s.sectionHeader} />
              <BrandthreadCard style={s.section} elevated>
                <View style={s.formGap}>
                  <FormInput
                    label="Title"
                    value={revTitle}
                    onChange={setRevTitle}
                    placeholder="e.g. Adjust collar width"
                  />
                  <FormInput
                    label="Detailed Notes"
                    value={revNotes}
                    onChange={setRevNotes}
                    placeholder="Describe the change needed in detail…"
                    multiline
                  />
                  <Text style={s.chipGroupLabel}>Priority</Text>
                  <View style={s.chipRow}>
                    {(['low', 'medium', 'high'] as const).map(p => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setRevPriority(p)}
                        style={[s.chip, revPriority === p && s.chipActive]}
                      >
                        <Text style={[s.chipText, revPriority === p && s.chipTextActive]}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <FormInput
                    label="Deadline (YYYY-MM-DD)"
                    value={revDeadline}
                    onChange={setRevDeadline}
                    placeholder="2025-06-01"
                  />
                  <PrimaryButton
                    label="Submit Revision"
                    onPress={handleSubmitRevision}
                    loading={revSubmitting}
                    icon="edit-3"
                  />
                  <SecondaryButton
                    label="Cancel"
                    onPress={() => setRevisionMode(false)}
                  />
                </View>
              </BrandthreadCard>
            </>
          )}
        </ScrollView>

        {/* ── ACTION BAR ───────────────────────────────────────────── */}
        <View style={[s.actionBar, { paddingBottom: insets.bottom + SP.sm }]}>
          {(sample.status === 'delivered' || sample.status === 'review_needed') && !sample.review && (
            <PrimaryButton
              label="Write Review"
              onPress={() => { setReviewMode(true); }}
              icon="star"
              style={s.actionBtn}
            />
          )}
          {(sample.status === 'review_needed' || sample.status === 'delivered') && (
            <SecondaryButton
              label="Request Revision"
              onPress={() => setRevisionMode(true)}
              icon="edit-3"
              style={s.actionBtn}
            />
          )}
          <SecondaryButton
            label="Message Manufacturer"
            onPress={handleMessage}
            icon="message-square"
            style={s.actionBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: {
    paddingTop: SP.sm,
  },
  section: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  sectionHeader: {
    marginTop: SP.sm,
  },
  paymentTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: SP.xs },
  paymentText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.md },
  paymentError: { fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE, marginBottom: SP.sm },
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
  retryBtn: {
    marginTop: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    backgroundColor: PURPLE,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.sm,
  },
  retryBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: ON_DARK,
  },

  // Badge row
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginBottom: SP.sm,
  },

  // Timeline
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    minHeight: 32,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 20,
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  timelineDotCurrent: {
    backgroundColor: PURPLE,
    borderColor: PURPLE,
  },
  timelineDotCompleted: {
    backgroundColor: SUCCESS,
    borderColor: SUCCESS,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 2,
    minHeight: 14,
  },
  timelineLineCompleted: {
    backgroundColor: SUCCESS + '66',
  },
  timelineLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: SUBTLE,
    paddingTop: 2,
    flex: 1,
    lineHeight: 20,
  },
  timelineLabelCurrent: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  timelineLabelCompleted: {
    color: MUTED,
    fontFamily: FONT.medium,
  },
  timelineLabelFuture: {
    color: SUBTLE,
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
    flex: 1,
  },
  paidText: {
    color: SUCCESS,
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.sm,
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

  // Images
  imageScroll: {
    marginBottom: SP.sm,
  },
  imageScrollContent: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  sampleImage: {
    width: 180,
    height: 180,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
  },
  imagePlaceholder: {
    alignItems: 'center',
    paddingVertical: SP.xl,
  },
  imagePlaceholderText: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginBottom: SP.xs,
  },
  imagePlaceholderSub: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textAlign: 'center',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  uploadingText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Revision
  revHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SP.xs,
    gap: SP.sm,
  },
  revTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    flex: 1,
  },
  revBadges: {
    flexDirection: 'row',
    gap: SP.xs,
    flexShrink: 0,
  },
  revNotes: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 18,
    marginTop: SP.xs,
  },
  revDeadline: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
    marginTop: SP.xs,
  },

  // Review
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.md,
  },
  reviewDecisionLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
  reviewFormTitle: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: SP.md,
    letterSpacing: -0.2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.xs,
  },
  ratingLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
    flex: 1,
  },

  // Chips
  chipGroupLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginBottom: SP.sm,
    marginTop: SP.sm,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  chip: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  chipActive: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
  },
  chipText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  chipTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },

  // Form
  formGap: {
    gap: SP.md,
  },

  // Action bar
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  actionBtn: {
    width: '100%',
  },
});
