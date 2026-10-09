/**
 * Gift cards in the buyer's wallet: what they own and can spend (each at its
 * own store), the ones they bought for someone else, and a field to add a
 * code. Reached from Menu, Gift cards. Balances come only from the server.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BrandthreadScreen, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { CheckoutField, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { GiftCardFace } from '@/components/giftCards/GiftCardFace';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { PREVIEW_CARDS } from '@/lib/giftCardsPreview';
import { giftCardMask, giftCardStatusLabel, type GiftCard, type GiftCardHistoryEntry } from '@/lib/giftCards';

const HISTORY_LABEL: Record<GiftCardHistoryEntry['type'], string> = {
  issue: 'Added', redeem: 'Held at checkout', settle: 'Used on an order', release: 'Returned, checkout not completed',
  refund: 'Returned from a refund', adjust: 'Adjustment', void: 'Voided by the store',
};

export default function BuyerGiftCardsScreen() {
  const router = useRouter();
  const api = useApi();
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const preview = isBuyerDevPreview();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<GiftCardHistoryEntry[]>([]);

  const load = useCallback(async () => {
    setFailed(false);
    if (preview) {
      // No backend in the web preview; samples only with &demo=1.
      setCards(isPreviewDemoMode() ? PREVIEW_CARDS : []);
      setLoading(false);
      return;
    }
    try {
      const result = await api.giftCards.mine();
      setCards(result.cards);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, preview]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function add() {
    const trimmed = code.trim();
    if (!trimmed || adding || preview) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.giftCards.claim(trimmed);
      setCode('');
      await load();
    } catch (err) {
      setAddError(err instanceof ApiError && err.status < 500 ? err.message : 'We couldn’t check that code. Check your connection and try again.');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(card: GiftCard) {
    if (openId === card.id) { setOpenId(null); return; }
    setOpenId(card.id);
    setHistory([]);
    if (preview) return;
    api.giftCards.get(card.id).then(result => setHistory(result.history)).catch(() => {});
  }

  const owned = cards.filter(card => card.role === 'owner');
  const sent = cards.filter(card => card.role === 'purchaser');
  const total = owned.filter(card => card.status === 'active').reduce((sum, card) => sum + card.balanceCents, 0);

  const renderCard = (card: GiftCard) => (
    <View key={card.id} style={s.cardWrap}>
      <PressableScale onPress={() => void toggle(card)} accessibilityRole="button" accessibilityLabel={`${card.storeName ?? 'Store'} gift card ${giftCardMask(card)}`}>
        <GiftCardFace
          compact
          storeName={card.storeName ?? 'Gift card'}
          amountText={formatCents(card.role === 'owner' ? card.balanceCents : card.initialCents)}
          caption={`${giftCardMask(card)} · ${card.role === 'owner' ? giftCardStatusLabel(card) : `Sent to ${card.recipientName || card.recipientEmail || 'a friend'}`}`}
        />
      </PressableScale>
      {openId === card.id ? (
        <View style={s.history}>
          {card.role === 'owner' ? <Text style={s.fine}>Works only at {card.storeName}. {formatCents(card.initialCents)} to start.</Text> : null}
          {history.map(entry => (
            <View key={entry.id} style={s.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.historyLabel}>{HISTORY_LABEL[entry.type]}</Text>
                <Text style={s.fine}>{new Date(entry.createdAt).toLocaleDateString()}</Text>
              </View>
              <Text style={s.historyAmount}>{entry.amountCents === 0 ? '' : `${entry.amountCents > 0 ? '+' : '−'}${formatCents(Math.abs(entry.amountCents))}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <BrandthreadScreen scrollable noSafeTop>
      <ScreenHeader title="Gift cards" onBack={() => goBackOr(router)} />
      <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
        <View style={s.addRow}>
          <CheckoutField
            label="Add a gift card"
            value={code}
            onChangeText={next => { setCode(next.toUpperCase()); if (addError) setAddError(null); }}
            error={addError ?? undefined}
            showError
            placeholder="Enter code"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void add()}
            style={{ flex: 1, marginBottom: 0 }}
            testID="gift-cards-code"
          />
          <Button label="Add" variant="secondary" size="small" loading={adding} disabled={!code.trim() || preview} onPress={() => void add()} style={s.add} />
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator /></View>
        ) : failed ? (
          <RetryRow label="Couldn’t load your gift cards" onRetry={() => void load()} />
        ) : cards.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyTitle}>No gift cards yet</Text>
            <Text style={s.fine}>Add a code above, or buy one from a store’s profile menu.</Text>
          </View>
        ) : (
          <>
            {owned.length > 0 ? (
              <>
                <Text style={s.label}>Your cards</Text>
                <Text style={s.total}>{formatCents(total)}</Text>
                <Text style={s.fine}>Available across {owned.filter(card => card.status === 'active').length} {owned.filter(card => card.status === 'active').length === 1 ? 'card' : 'cards'}, each at its own store</Text>
                {owned.map(renderCard)}
              </>
            ) : null}
            {sent.length > 0 ? (
              <>
                <Text style={[s.label, { marginTop: SP.lg }]}>Sent</Text>
                {sent.map(renderCard)}
              </>
            ) : null}
          </>
        )}
      </View>
    </BrandthreadScreen>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.lg },
    add: { marginTop: 25, minWidth: 84 },
    center: { alignItems: 'center', paddingTop: SP.xl, gap: SP.xs },
    emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
    label: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1, textTransform: 'uppercase', color: ck.muted },
    total: { fontFamily: FONT.bold, fontSize: 34, color: ck.text, marginTop: SP.xs },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted },
    cardWrap: { marginTop: SP.md },
    history: { paddingTop: SP.sm, gap: SP.sm },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs },
    historyLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
    historyAmount: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
  });
}
