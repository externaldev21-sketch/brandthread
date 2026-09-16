/**
 * Seller Reviews — view received reviews and post public replies.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BG, CARD, SURFACE, BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';

type Review = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id?: string;
  order_id?: string;
  rating: number;
  body?: string;
  seller_reply?: string;
  seller_replied_at?: string;
  created_at: string;
  product_name?: string;
  buyer_name?: string;
  buyer_display_name?: string;
  buyer_avatar?: string;
};

function Stars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Feather
          key={i}
          name="star"
          size={13}
          color={i <= rating ? '#F59E0B' : SUBTLE}
          style={i <= rating ? { opacity: 1 } : { opacity: 0.3 }}
        />
      ))}
    </View>
  );
}

function ReviewCard({ review, onReplySubmitted }: { review: Review; onReplySubmitted: () => void }) {
  const api = useApi();
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReply = async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await api.reviews.reply(review.id, replyText.trim());
      setReplying(false);
      setReplyText('');
      onReplySubmitted();
    } catch {
      Alert.alert('Error', 'Could not post reply. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const buyerLabel = review.buyer_display_name || review.buyer_name || 'Buyer';
  const dateStr = new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <View style={s.reviewCard}>
      {/* Header row */}
      <View style={s.reviewHeader}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{buyerLabel.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.buyerName}>{buyerLabel}</Text>
          {review.product_name ? (
            <Text style={s.productName} numberOfLines={1}>on {review.product_name}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Stars rating={review.rating} />
          <Text style={s.dateText}>{dateStr}</Text>
        </View>
      </View>

      {/* Review body */}
      {review.body ? <Text style={s.reviewBody}>{review.body}</Text> : null}

      {/* Existing reply */}
      {review.seller_reply ? (
        <View style={s.replyBox}>
          <View style={s.replyHeader}>
            <Feather name="corner-down-right" size={13} color={PURPLE_LIGHT} />
            <Text style={s.replyLabel}>Your reply</Text>
          </View>
          <Text style={s.replyText}>{review.seller_reply}</Text>
        </View>
      ) : null}

      {/* Reply form or button */}
      {!review.seller_reply && !replying && (
        <TouchableOpacity
          style={s.replyBtn}
          onPress={() => setReplying(true)}
          activeOpacity={0.8}
        >
          <Feather name="message-square" size={13} color={PURPLE_LIGHT} />
          <Text style={s.replyBtnText}>Reply publicly</Text>
        </TouchableOpacity>
      )}

      {replying && (
        <View style={s.replyForm}>
          <TextInput
            style={s.replyInput}
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Write a public reply visible to all buyers..."
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
            maxLength={500}
            autoFocus
          />
          <View style={s.replyActions}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => { setReplying(false); setReplyText(''); }}
              activeOpacity={0.8}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.submitBtn, (!replyText.trim() || submitting) && s.submitBtnDisabled]}
              onPress={handleSubmitReply}
              disabled={!replyText.trim() || submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={s.submitText}>Post Reply</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default function SellerReviewsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { user, isLoaded: clerkLoaded } = useUser();
  const requestGeneration = useRef(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestGeneration.current += 1;
    setReviews([]);
    setError(null);
    setLoading(!clerkLoaded);
  }, [clerkLoaded, user?.id]);

  const load = useCallback(async () => {
    if (!clerkLoaded || !user?.id) return;
    const generation = ++requestGeneration.current;
    try {
      setError(null);
      const data = await api.reviews.mine();
      if (requestGeneration.current !== generation) return;
      if (Array.isArray(data)) setReviews(data);
    } catch {
      if (requestGeneration.current !== generation) return;
      setError('unavailable');
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [api, clerkLoaded, user?.id]);

  useFocusEffect(useCallback(() => {
    if (!clerkLoaded || !user?.id) {
      setReviews([]);
      setLoading(!clerkLoaded);
      return;
    }
    setLoading(true);
    load();
  }, [load, clerkLoaded, user?.id]));

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  const replied = reviews.filter((r) => r.seller_reply).length;

  return (
    <View style={[s.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Reviews</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Stats strip */}
      {reviews.length > 0 && (
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statVal}>{avgRating ?? '—'}</Text>
            <Text style={s.statLabel}>Avg rating</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statVal}>{reviews.length}</Text>
            <Text style={s.statLabel}>Total</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statVal}>{replied}</Text>
            <Text style={s.statLabel}>Replied</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statVal}>{reviews.length - replied}</Text>
            <Text style={s.statLabel}>Pending</Text>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={PURPLE} />
          </View>
        )}
        {!loading && reviews.length === 0 && (
          <View style={s.center}>
            <Feather name="star" size={40} color={MUTED} />
            <Text style={s.emptyTitle}>No reviews yet</Text>
            <Text style={s.emptyBody}>Reviews from buyers will appear here. Complete orders to start collecting feedback.</Text>
          </View>
        )}
        {!loading && reviews.map((r) => (
          <ReviewCard key={r.id} review={r} onReplySubmitted={load} />
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: 'transparent' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },

  statsRow:   { flexDirection: 'row', padding: 16, gap: 0, borderBottomWidth: 1, borderBottomColor: BORDER },
  stat:       { flex: 1, alignItems: 'center', gap: 2 },
  statVal:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  statLabel:  { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  statDivider: { width: 1, backgroundColor: BORDER, marginVertical: 4 },

  scroll:     { padding: 16, paddingBottom: 100, gap: 12 },

  reviewCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 12 },
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar:     { width: 38, height: 38, borderRadius: 19, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: PURPLE_LIGHT },
  buyerName:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  productName: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  dateText:   { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  reviewBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 20 },

  replyBox:   { backgroundColor: PURPLE_DIM, borderRadius: 10, padding: 12, gap: 6 },
  replyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  replyLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: PURPLE_LIGHT, textTransform: 'uppercase', letterSpacing: 0.5 },
  replyText:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 19 },

  replyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: PURPLE + '44' },
  replyBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: PURPLE_LIGHT },

  replyForm:  { gap: 10 },
  replyInput: { backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 12, fontSize: 13, fontFamily: 'Inter_400Regular', color: FG, minHeight: 80, textAlignVertical: 'top' },
  replyActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cancelBtn:  { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: BORDER },
  cancelText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED },
  submitBtn:  { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8, backgroundColor: PURPLE, minWidth: 90, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#000' },

  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  errorText:  { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  retryBtn:   { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: BORDER },
  retryText:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  emptyBody:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});
