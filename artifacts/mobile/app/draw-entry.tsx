/**
 * Enter a draw (Nike SNKRS purchase sheet, 1:1): the product photo on top,
 * then Size, Ship to, Payment and Total rows and one pill button. Entering
 * authorises the card for the exact total and charges nothing; the server
 * captures it only if this entry is picked (lib/productDraws.ts).
 *
 * Once entered the same sheet shows the entry read-only with Withdraw.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import type { ProductDrawEntry } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { hapticSuccess } from '@/lib/haptics';
import { friendlyError } from '@/lib/friendlyError';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { CardEntry, PaymentController, StripePaymentProvider, stripePaymentAvailable } from '@/components/checkout/StripePayment';
import type { PaymentControllerApi } from '@/components/checkout/stripePaymentTypes';
import { closesLabel } from '@/lib/drawPhase';

type Variant = { id: string; label: string; stock: number; priceCents: number };
type Address = { id: string; recipientName: string; street: string; line2?: string | null; city: string; state: string; postalCode: string; country: string; phone?: string | null; isDefault?: boolean };
type Card = { id: string; brand: string; last4: string; isDefault?: boolean };
type Row = 'size' | 'ship' | 'pay' | null;

const NEW_CARD = 'new';

export default function DrawEntryScreen() {
  const { productId, variantId: presetVariant } = useLocalSearchParams<{ productId: string; variantId?: string }>();
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const controllerRef = useRef<PaymentControllerApi>(null);
  const enteringRef = useRef(false);

  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [entry, setEntry] = useState<ProductDrawEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const [variantId, setVariantId] = useState<string | null>(presetVariant ?? null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [notifyResult, setNotifyResult] = useState(false);
  const [open, setOpen] = useState<Row>(null);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) return;
    const [row, state, mine, addr, pms] = await Promise.all([
      api.publicProducts.get(productId).catch(() => null),
      api.productDraws.state(productId).catch(() => null),
      api.productDraws.entry(productId).catch(() => ({ entry: null })),
      api.buyer.addresses.list().catch(() => [] as any[]),
      api.reviews.paymentMethods().catch(() => ({ paymentMethods: [] as any[] })),
    ]);
    if (row) {
      setName(row.name ?? '');
      setImage((row.images ?? [])[0] ?? null);
      setVariants(((row.variants ?? []) as any[]).map((v) => ({
        id: v.id, label: [v.size, v.color].filter(Boolean).join(' / ') || 'One size', stock: v.stock ?? 0, priceCents: v.priceCents ?? 0,
      })));
    }
    setClosesAt(state?.draw?.closesAt ?? null);
    setEntry(mine.entry && mine.entry.status !== 'pending' ? mine.entry : null);
    const list = (addr ?? []) as Address[];
    setAddresses(list);
    setAddressId((cur) => cur ?? (list.find((a) => a.isDefault) ?? list[0])?.id ?? null);
    const saved = ((pms?.paymentMethods ?? []) as any[]).map((pm) => ({ id: pm.id, brand: pm.brand, last4: pm.last4, isDefault: pm.isDefault }));
    setCards(saved);
    setCardId((cur) => cur ?? (saved.find((c) => c.isDefault) ?? saved[0])?.id ?? NEW_CARD);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Reload on focus too: "Add address" pushes /buyer-addresses, and the new
  // address must be here when the buyer comes back.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const variant = variants.find((v) => v.id === variantId) ?? null;
  const address = addresses.find((a) => a.id === addressId) ?? null;
  const card = cards.find((c) => c.id === cardId) ?? null;

  // The exact amount the card will be authorised for, once size + address are known.
  useEffect(() => {
    setTotalCents(null);
    if (!productId || !variantId || !addressId || entry) return;
    let active = true;
    api.productDraws.quote(productId, { variantId, addressId })
      .then((q) => { if (active) setTotalCents(q.totalCents); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, variantId, addressId, entry]);

  const canEnter = !!variant && !!address && (cardId === NEW_CARD ? cardComplete : !!card) && !busy && stripePaymentAvailable();

  async function enter() {
    if (!productId || !variant || !address || !canEnter || enteringRef.current) return;
    const controller = controllerRef.current;
    if (!controller) return;
    // Synchronous guard: a second tap can land before `busy` re-renders.
    enteringRef.current = true;
    setBusy(true);
    setError(null);
    const getClientSecret = async () => {
      try {
        const r = await api.productDraws.enter(productId, { variantId: variant.id, addressId: address.id, notifyResult });
        setTotalCents(r.amountCents);
        return r.clientSecret;
      } catch (e: any) {
        setError(friendlyError(e, 'Couldn’t enter. Try again.'));
        return null;
      }
    };
    try {
      const outcome = cardId === NEW_CARD
        ? await controller.confirmCard(getClientSecret, {
          name: address.recipientName, email: '', phone: address.phone ?? '',
          address: { line1: address.street, line2: address.line2 ?? null, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country || 'US' },
        })
        : await controller.confirmSaved(getClientSecret, card!.id);
      if (!outcome) return; // getClientSecret already said why
      if (outcome.status === 'canceled') return;
      if (outcome.status === 'failed') { setError(outcome.message); return; }
      await api.productDraws.confirm(productId);
      hapticSuccess();
      const mine = await api.productDraws.entry(productId).catch(() => null);
      setEntry(mine?.entry ?? null);
    } catch (e: any) {
      setError(friendlyError(e, 'Couldn’t enter. Try again.'));
    } finally {
      enteringRef.current = false;
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!productId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.productDraws.withdraw(productId);
      setEntry(null);
    } catch (e: any) {
      setError(friendlyError(e, 'Couldn’t withdraw. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const priceFrom = variant?.priceCents ?? (variants.length ? Math.min(...variants.map((v) => v.priceCents)) : 0);
  const totalText = entry
    ? formatCents(entry.amountCents)
    : totalCents != null ? formatCents(totalCents) : `${formatCents(priceFrom)} plus shipping & tax`;

  const s = useMemo(() => styles(colors), [colors]);

  if (loading) {
    return <View style={[s.screen, s.center]}><ActivityIndicator color={colors.foreground} /></View>;
  }

  const sheet = (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} bounces={false}>
        <View style={s.hero}>
          {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <Pressable
            onPress={() => router.back()}
            style={[s.close, { top: insets.top + SP.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            testID="draw-entry-close"
          >
            <Feather name="x" size={ICON.md} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={s.panel}>
          <Text style={s.title} numberOfLines={2}>{name}</Text>
          <Text style={s.sub}>{entry ? 'Entered' : closesAt ? closesLabel(closesAt) : 'Draw'}</Text>

          <SheetRow
            label="Size"
            value={entry ? entry.variantLabel : variant?.label ?? 'Select'}
            expanded={open === 'size'}
            onPress={entry ? undefined : () => setOpen(open === 'size' ? null : 'size')}
            s={s}
            testID="draw-row-size"
          />
          {open === 'size' && !entry ? (
            <View style={s.grid}>
              {variants.map((v) => {
                const soldOut = v.stock <= 0;
                const on = v.id === variantId;
                return (
                  <Pressable
                    key={v.id}
                    disabled={soldOut}
                    onPress={() => { setVariantId(v.id); setOpen(null); }}
                    style={[s.cell, on && s.cellOn, soldOut && s.cellOff]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: soldOut }}
                  >
                    <Text style={[s.cellText, on && s.cellTextOn, soldOut && s.cellTextOff]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <SheetRow
            label="Ship to"
            value={address ? `${address.recipientName}, ${address.street}` : 'Add address'}
            expanded={open === 'ship'}
            onPress={entry ? undefined : () => (addresses.length ? setOpen(open === 'ship' ? null : 'ship') : router.push('/buyer-addresses' as never))}
            s={s}
            testID="draw-row-ship"
          />
          {open === 'ship' && !entry ? addresses.map((a) => (
            <Pressable key={a.id} onPress={() => { setAddressId(a.id); setOpen(null); }} style={s.option} accessibilityRole="button" accessibilityState={{ selected: a.id === addressId }}>
              <Text style={s.optionText} numberOfLines={1}>{a.recipientName}, {a.street}, {a.city}</Text>
              {a.id === addressId ? <Feather name="check" size={ICON.sm} color={colors.foreground} /> : null}
            </Pressable>
          )) : null}

          <SheetRow
            label="Payment"
            value={entry ? 'On hold' : card ? `${cap(card.brand)} •••• ${card.last4}` : 'New card'}
            expanded={open === 'pay'}
            onPress={entry ? undefined : () => setOpen(open === 'pay' ? null : 'pay')}
            s={s}
            testID="draw-row-pay"
          />
          {open === 'pay' && !entry ? (
            <>
              {cards.map((c) => (
                <Pressable key={c.id} onPress={() => { setCardId(c.id); setOpen(null); }} style={s.option} accessibilityRole="button" accessibilityState={{ selected: c.id === cardId }}>
                  <Text style={s.optionText}>{cap(c.brand)} •••• {c.last4}</Text>
                  {c.id === cardId ? <Feather name="check" size={ICON.sm} color={colors.foreground} /> : null}
                </Pressable>
              ))}
              <Pressable onPress={() => setCardId(NEW_CARD)} style={s.option} accessibilityRole="button" accessibilityState={{ selected: cardId === NEW_CARD }}>
                <Text style={s.optionText}>New card</Text>
                {cardId === NEW_CARD ? <Feather name="check" size={ICON.sm} color={colors.foreground} /> : null}
              </Pressable>
            </>
          ) : null}
          {cardId === NEW_CARD && !entry && stripePaymentAvailable() ? (
            <View style={s.cardEntry}><CardEntry onCompleteChange={setCardComplete} /></View>
          ) : null}

          <View style={s.row}>
            <Text style={s.rowLabel}>Total</Text>
            <Text style={s.rowValue} testID="draw-total">{totalText}</Text>
          </View>

          {!entry ? (
            <View style={s.row}>
              <Text style={s.rowLabel}>Notify me of the result</Text>
              <HapticSwitch value={notifyResult} onValueChange={setNotifyResult} accessibilityLabel="Notify me of the result" testID="draw-notify-result" />
            </View>
          ) : null}

          <Text style={s.fine}>
            {entry
              ? 'Your card is only charged if you get it.'
              : 'You’re only charged if you get it.'}
          </Text>
          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          {!stripePaymentAvailable() && !entry ? <Text style={s.error}>Payments aren’t available in this build.</Text> : null}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + SP.sm }]}>
        {entry ? (
          <Pressable onPress={withdraw} disabled={busy} style={s.withdraw} accessibilityRole="button" testID="draw-withdraw">
            {busy ? <ActivityIndicator color={colors.foreground} /> : <Text style={s.withdrawText}>Withdraw entry</Text>}
          </Pressable>
        ) : (
          <Pressable
            onPress={enter}
            disabled={!canEnter}
            style={[s.cta, !canEnter && s.ctaOff]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canEnter }}
            testID="draw-enter"
          >
            {busy ? <ActivityIndicator color={colors.background} /> : <Text style={s.ctaText}>Enter Draw</Text>}
          </Pressable>
        )}
      </View>
      <PaymentController ref={controllerRef} />
    </View>
  );

  return <StripePaymentProvider amountCents={totalCents ?? priceFrom} manualCapture>{sheet}</StripePaymentProvider>;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function SheetRow({ label, value, expanded, onPress, s, testID }: {
  label: string; value: string; expanded: boolean; onPress?: () => void; s: ReturnType<typeof styles>; testID?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={s.row} accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} testID={testID}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowRight}>
        <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
        {onPress ? <Feather name={expanded ? 'minus' : 'plus'} size={ICON.sm} color={s.icon.color} /> : null}
      </View>
    </Pressable>
  );
}

function styles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { alignItems: 'center', justifyContent: 'center' },
    hero: { height: 340, backgroundColor: c.card },
    close: { position: 'absolute', right: SP.md, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    panel: { marginTop: -SP.lg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, backgroundColor: c.background, paddingHorizontal: SP.md, paddingTop: SP.lg },
    title: { fontFamily: FONT.semibold, fontSize: FS.lg, color: c.foreground, textAlign: 'center' },
    sub: { fontFamily: FONT.regular, fontSize: FS.sm, color: c.mutedForeground, textAlign: 'center', marginTop: SP.xs, marginBottom: SP.md, fontVariant: ['tabular-nums'] },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    rowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: c.foreground },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexShrink: 1 },
    rowValue: { fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
    icon: { color: c.foreground },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingBottom: SP.md },
    cell: { width: '31.5%', minHeight: 44, borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center' },
    cellOn: { backgroundColor: c.foreground, borderColor: c.foreground },
    cellOff: { opacity: 0.3 },
    cellText: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.foreground },
    cellTextOn: { color: c.background },
    cellTextOff: { textDecorationLine: 'line-through' },
    option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: SP.md },
    optionText: { fontFamily: FONT.regular, fontSize: FS.sm, color: c.foreground, flexShrink: 1 },
    cardEntry: { paddingBottom: SP.md },
    fine: { fontFamily: FONT.regular, fontSize: FS.meta, color: c.mutedForeground, textAlign: 'center', marginTop: SP.md },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.foreground, textAlign: 'center', marginTop: SP.sm },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: c.background },
    cta: { minHeight: 52, borderRadius: RADIUS.pill, backgroundColor: c.foreground, alignItems: 'center', justifyContent: 'center' },
    ctaOff: { opacity: 0.3 },
    ctaText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.background },
    withdraw: { minHeight: 52, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    withdrawText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  });
}
