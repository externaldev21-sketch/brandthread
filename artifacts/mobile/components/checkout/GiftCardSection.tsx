/**
 * GIFT CARD: an additive checkout section under Promo code. A store gift card
 * only pays for ITS store's items, so each card is tied to that seller's group.
 *  - a card already applied shows the store, the last 4 and what it covers
 *    (from the server's quote), with Remove;
 *  - the buyer's wallet cards for stores in this cart are offered to Apply;
 *  - a code field adds a card to the wallet (rate limited by the server) and
 *    applies it when it belongs to a store in this cart.
 * Same flat look as PromoCodeSection (no cards, hairline-bordered field).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { giftCardMask, spendableCards, type GiftCard } from '@/lib/giftCards';
import { FONT, FS, SP } from '@/lib/theme';
import { CheckoutField, CheckoutSection, TextAction, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

export type GiftCardSectionGroup = { sellerId: string; sellerName: string };

export function GiftCardSection({
  groups, applied, coveredCents, onApply, onRemove,
}: {
  groups: GiftCardSectionGroup[];
  /** Card chosen per seller. */
  applied: Record<string, { cardId: string; last4: string | null }>;
  /** What each card covers, per seller, from the server's quote. */
  coveredCents: Record<string, number>;
  onApply: (sellerId: string, card: { cardId: string; last4: string | null }) => void;
  onRemove: (sellerId: string) => void;
}) {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const api = useApi();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sellerName = (sellerId: string) => groups.find(group => group.sellerId === sellerId)?.sellerName ?? 'this store';

  const load = useCallback(() => {
    api.giftCards.mine().then(result => setCards(result.cards)).catch(() => {});
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const offered = groups.flatMap(group =>
    applied[group.sellerId] ? [] : spendableCards(cards, group.sellerId).slice(0, 2));

  async function add() {
    const trimmed = code.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      const { card, storeName } = await api.giftCards.claim(trimmed);
      setCode('');
      load();
      const group = groups.find(g => g.sellerId === card.sellerId);
      if (!group) setError(`That gift card is for ${storeName || 'another store'}. It’s saved in your gift cards and works on that store’s items.`);
      else if (card.status !== 'active') setError('That gift card has no balance to use.');
      else onApply(group.sellerId, { cardId: card.id, last4: card.last4 });
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'We couldn’t check that code. Check your connection and try again.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <CheckoutSection title="Gift card" testID="checkout-gift-card">
      {Object.entries(applied).map(([sellerId, card]) => (
        <View key={sellerId} style={styles.row} testID="checkout-gift-card-applied">
          <Icon name="check-circle" size={18} color={ck.text} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{giftCardMask({ last4: card.last4 })} applied</Text>
            <Text style={styles.sub} numberOfLines={2}>
              {coveredCents[sellerId] ? `Covers ${formatCents(coveredCents[sellerId])} of ${sellerName(sellerId)}’s items` : sellerName(sellerId)}
            </Text>
          </View>
          <TextAction label="Remove" accessibilityLabel="Remove gift card" onPress={() => onRemove(sellerId)} />
        </View>
      ))}

      {offered.map(card => (
        <View key={card.id} style={styles.row}>
          <Icon name="gift" size={18} color={ck.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{card.storeName || sellerName(card.sellerId)} {giftCardMask(card)}</Text>
            <Text style={styles.sub}>{formatCents(card.balanceCents)} balance</Text>
          </View>
          <TextAction
            label="Apply"
            accessibilityLabel={`Apply gift card ${giftCardMask(card)}`}
            onPress={() => onApply(card.sellerId, { cardId: card.id, last4: card.last4 })}
          />
        </View>
      ))}

      <View style={styles.codeRow}>
        <CheckoutField
          label="Code"
          value={code}
          onChangeText={next => { setCode(next.toUpperCase()); if (error) setError(null); }}
          error={error ?? undefined}
          showError
          placeholder="Enter gift card code"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          style={{ flex: 1, marginBottom: 0 }}
          accessibilityLabel="Gift card code"
          testID="checkout-gift-card-input"
        />
        <Button
          label="Add"
          variant="secondary"
          size="small"
          loading={adding}
          disabled={!code.trim()}
          onPress={() => void add()}
          style={styles.add}
          accessibilityLabel="Add gift card"
          testID="checkout-gift-card-add"
        />
      </View>
    </CheckoutSection>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.xs + 2, marginBottom: SP.xs },
    title: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    sub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, color: ck.muted },
    codeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.xs },
    add: { marginTop: 25, minWidth: 84 },
  });
}
