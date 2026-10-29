import { radius as ControlRadius } from '@/constants/radii';
/**
 * Buy a store gift card. Reached from a store's profile menu ("Gift cards").
 * Layout follows the Blue Apron / Givingli gift flows (Mobbin): the card on
 * top, amount chips, recipient name + email, message, then pay with Stripe's
 * own card field. The code goes to the recipient by email and is never stored
 * in readable form; the buyer sees it once after paying so they can share it.
 * Sending by text follows Starbucks' eGift: an "Email | Text message" choice on
 * the recipient step; after paying, either "Sent to •••1234" (the server texted
 * it) or "Send by Messages", which opens the composer with the note filled in.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth, useUser } from '@clerk/expo';
import { BrandthreadScreen, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, SegmentedControl } from '@/components/ui';
import { ErrorState } from '@/components/ui/ErrorState';
import { CheckoutField, CheckoutSection, useCheckoutColors, GUTTER, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { CardEntry, PaymentController, StripePaymentProvider, stripePaymentAvailable } from '@/components/checkout/StripePayment';
import type { PaymentControllerApi } from '@/components/checkout/stripePaymentTypes';
import { GiftCardFace } from '@/components/giftCards/GiftCardFace';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { PREVIEW_STORE_INFO } from '@/lib/giftCardsPreview';
import { amountTextToCents, giftCardPurchaseIssue, giftCardTextBody, toE164, type GiftCardStoreInfo } from '@/lib/giftCards';
import { openSmsComposer } from '@/lib/openSmsComposer';

type Done = {
  cardId: string; code: string | null; email: string; storeName: string; amountCents: number;
  /** E.164 when sent by text; textedTo is its last 4 when the server already texted it. */
  phone?: string | null; textedTo?: string | null;
};
type Channel = 'email' | 'text';
const CHANNEL_OPTIONS = [{ id: 'email', label: 'Email' }, { id: 'text', label: 'Text message' }];

export default function GiftCardBuyScreen() {
  const params = useLocalSearchParams<{ sellerId?: string; name?: string; done?: string }>();
  const sellerId = String(params.sellerId ?? '');
  const api = useApi();
  const { isSignedIn } = useAuth();
  const preview = isBuyerDevPreview();
  const [info, setInfo] = useState<GiftCardStoreInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    if (preview) {
      // No backend in the web preview; samples only with &demo=1.
      if (isPreviewDemoMode()) setInfo({ ...PREVIEW_STORE_INFO, sellerId });
      else setLoadFailed(true);
      return;
    }
    api.giftCards.store(sellerId).then(result => { if (active) setInfo(result); }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [api, preview, sellerId, reloadKey]);

  const body = !info
    ? (loadFailed
      ? <ErrorState message="We couldn’t load this store’s gift cards." onRetry={() => setReloadKey(k => k + 1)} />
      : <View style={styles.center}><ActivityIndicator /></View>)
    : !info.enabled
      ? <View style={styles.center}><Text style={styles.plain}>{info.storeName || params.name || 'This store'} doesn’t sell gift cards right now.</Text></View>
      : <BuyForm
          info={{ ...info, storeName: info.storeName || String(params.name ?? '') }} signedIn={!!isSignedIn || preview} preview={preview}
          previewDone={preview && isPreviewDemoMode() ? params.done : undefined}
        />;

  return (
    <BrandthreadScreen scrollable noSafeTop>
      <ScreenHeader title="Gift card" />
      {body}
    </BrandthreadScreen>
  );
}

function BuyForm({ info, signedIn, preview, previewDone }: { info: GiftCardStoreInfo; signedIn: boolean; preview: boolean; previewDone?: string }) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const api = useApi();
  const router = useRouter();
  // Billing details describe the buyer (the card holder), never the
  // recipient and never a made-up name: the signed-in account's real name
  // and email when Clerk has them, otherwise left blank for Stripe.
  const { user } = useUser();
  const buyerName = (user?.fullName ?? '').trim();
  const buyerEmail = (user?.primaryEmailAddress?.emailAddress ?? '').trim();
  const controllerRef = useRef<PaymentControllerApi>(null);
  const keyRef = useRef(`gc_${randomUUID()}`);
  const [amountCents, setAmountCents] = useState<number | null>(info.denominations[1] ?? info.denominations[0] ?? null);
  const [custom, setCustom] = useState('');
  const [customOn, setCustomOn] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [cardComplete, setCardComplete] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Demo preview only (&demo=1&done=text|texted): the confirmation states.
  const [done, setDone] = useState<Done | null>(() => (previewDone === 'text' || previewDone === 'texted' ? {
    cardId: 'preview', code: 'K7QX-M4TP-9WHR-2CZN', email: '', storeName: info.storeName, amountCents: 2500,
    phone: '+14155552671', textedTo: previewDone === 'texted' ? '2671' : null,
  } : null));

  // The server reuses the PaymentIntent (and the pending card, with its old
  // recipient) for a repeated key, and Stripe rejects a reused key with a new
  // amount. So a retry after a cancelled 3DS / closed sheet only shares the key
  // when nothing about the purchase changed.
  useEffect(() => {
    keyRef.current = `gc_${randomUUID()}`;
  }, [amountCents, channel, email, phone, name, message]);

  const texting = channel === 'text';
  const issue = giftCardPurchaseIssue({ amountCents, info, email, phone: texting ? phone : null });
  const cardReady = preview || cardComplete;
  const canPay = signedIn && !issue && cardReady && !paying;

  const pay = useCallback(async () => {
    if (!amountCents || issue) return;
    setError(null);
    setPaying(true);
    try {
      const controller = controllerRef.current;
      if (!controller) { setError('Card payments aren’t available on this device yet.'); return; }
      let giftCardId = '';
      const outcome = await controller.confirmCard(async () => {
        try {
          const started = await api.giftCards.purchase({
            sellerId: info.sellerId, amountCents,
            ...(texting ? { recipientPhone: toE164(phone) ?? phone.trim() } : { recipientEmail: email.trim() }),
            ...(name.trim() ? { recipientName: name.trim() } : {}),
            ...(message.trim() ? { message: message.trim() } : {}),
            clientIdempotencyKey: keyRef.current,
          });
          giftCardId = started.giftCardId;
          return started.clientSecret;
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'We couldn’t start your payment. You haven’t been charged.');
          return null;
        }
      }, {
        name: buyerName, email: buyerEmail, phone: '',
        address: { line1: '', line2: null, city: '', state: '', postalCode: '', country: 'US' },
      });
      if (!outcome || outcome.status === 'canceled') return;
      if (outcome.status === 'failed') {
        keyRef.current = `gc_${randomUUID()}`;
        setError(outcome.message);
        return;
      }
      // Paid. Activate the card (the webhook may already have) and show the code once.
      let confirmed: Awaited<ReturnType<typeof api.giftCards.confirmPurchase>> | null = null;
      for (let attempt = 0; attempt < 6 && giftCardId; attempt++) {
        confirmed = await api.giftCards.confirmPurchase(giftCardId).catch(() => null);
        if (confirmed?.status === 'paid') break;
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      setDone({
        cardId: giftCardId, code: confirmed?.code ?? null, email: email.trim(), storeName: info.storeName, amountCents,
        phone: texting ? toE164(phone) : null, textedTo: confirmed?.textedTo ?? null,
      });
    } finally {
      setPaying(false);
    }
  }, [amountCents, api, buyerEmail, buyerName, email, info.sellerId, info.storeName, issue, message, name, phone, texting]);

  if (done) {
    return (
      <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
        <GiftCardFace storeName={done.storeName} amountText={formatCents(done.amountCents)} />
        <Text style={s.doneTitle}>{done.phone && !done.textedTo ? 'Gift card ready' : 'Gift card sent'}</Text>
        <Text style={s.plain}>
          {done.textedTo ? `Sent to •••${done.textedTo}.` : done.phone ? 'Send it by text.' : `We emailed it to ${done.email}.`}
          {' '}They can add it under Menu, Gift cards, or enter the code at checkout.
        </Text>
        {done.code ? (
          <View style={s.codeBox}>
            <Text style={s.codeLabel}>Code (shown once)</Text>
            <Text style={s.code} selectable>{done.code}</Text>
            {done.phone && !done.textedTo ? (
              <Button
                label="Send by Messages"
                icon="message-circle"
                onPress={() => void openSmsComposer(
                  giftCardTextBody({ storeName: done.storeName, amountCents: done.amountCents, code: done.code! }), done.phone,
                ).catch(() => {})}
                testID="gift-card-send-sms"
              />
            ) : null}
            <Button
              label="Share code"
              variant="secondary"
              icon="share"
              onPress={() => void Share.share({ message: `Your ${done.storeName} gift card code: ${done.code}` }).catch(() => {})}
            />
          </View>
        ) : null}
        <Button label="Done" onPress={() => goBackOr(router)} fullWidth style={{ marginTop: SP.lg }} />
      </View>
    );
  }

  return (
    <StripePaymentProvider amountCents={amountCents ?? info.minCents}>
    <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
      <GiftCardFace storeName={info.storeName} amountText={amountCents ? formatCents(amountCents) : '$0'} />

      <CheckoutSection title="Amount" first style={s.section}>
        <View style={s.chips}>
          {info.denominations.map(cents => (
            <Chip key={cents} label={formatCents(cents)} selected={!customOn && amountCents === cents} ck={ck}
              onPress={() => { setCustomOn(false); setAmountCents(cents); }} />
          ))}
          {info.allowCustom ? (
            <Chip label="Custom" selected={customOn} ck={ck} onPress={() => { setCustomOn(true); setAmountCents(amountTextToCents(custom)); }} />
          ) : null}
        </View>
        {customOn ? (
          <CheckoutField
            label="Amount"
            value={custom}
            onChangeText={next => { setCustom(next); setAmountCents(amountTextToCents(next)); }}
            keyboardType="decimal-pad"
            placeholder={`${formatCents(info.minCents)} to ${formatCents(info.maxCents)}`}
            style={{ marginTop: SP.sm + 4 }}
          />
        ) : null}
      </CheckoutSection>

      <CheckoutSection title="Recipient" style={s.section}>
        <SegmentedControl options={CHANNEL_OPTIONS} selectedId={channel} onChange={id => setChannel(id as Channel)} testID="gift-card-channel" style={{ marginBottom: SP.sm }} />
        <CheckoutField label="Name" value={name} onChangeText={setName} placeholder="Maya Chen" maxLength={80} autoCapitalize="words" autoComplete="name" textContentType="name" />
        {texting ? (
          <CheckoutField
            label="Phone number" value={phone} onChangeText={setPhone} placeholder="Enter phone number"
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={20} testID="gift-card-phone"
          />
        ) : (
        <CheckoutField
          label="Email" value={email} onChangeText={setEmail} placeholder="maya@brand.co"
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" testID="gift-card-email"
        />
        )}
        <CheckoutField
          label="Message" value={message} onChangeText={setMessage} placeholder="Happy birthday, Maya" maxLength={300}
          hint={`${message.length}/300`} multiline
        />
      </CheckoutSection>

      <CheckoutSection title="Payment" style={s.section}>
        {stripePaymentAvailable() ? (
          <>
            <PaymentController ref={controllerRef} />
            <CardEntry onCompleteChange={setCardComplete} disabled={paying} />
          </>
        ) : preview ? (
          <Text style={s.plain}>Card entry appears here on a device with payments enabled.</Text>
        ) : (
          <Text style={s.plain}>Card payments aren’t available on this device yet.</Text>
        )}
        <Text style={s.fine}>The gift card works only at {info.storeName}. Brandthread holds the payment until it’s used.</Text>
      </CheckoutSection>

      {error ? (
        <View style={s.errorRow} accessibilityRole="alert">
          <Icon name="alert-circle" size={16} color={ck.text} />
          <Text style={s.error}>{error}</Text>
        </View>
      ) : null}
      {!signedIn ? <Text style={s.fine}>Sign in to buy a gift card.</Text> : null}
      {signedIn && issue && ((texting ? phone : email).length > 0 || amountCents === null) ? <Text style={s.fine}>{issue}</Text> : null}

      <Button
        label={amountCents ? `Pay ${formatCents(amountCents)}` : 'Pay'}
        onPress={() => void pay()}
        disabled={!canPay}
        loading={paying}
        fullWidth
        style={{ marginTop: SP.md }}
        testID="gift-card-pay"
      />
    </View>
    </StripePaymentProvider>
  );
}

function Chip({ label, selected, onPress, ck }: { label: string; selected: boolean; onPress: () => void; ck: CheckoutColors }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        minHeight: 44, paddingHorizontal: SP.md, borderRadius: ControlRadius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
        borderColor: selected ? ck.text : ck.fieldBorder, backgroundColor: selected ? ck.text : 'transparent',
      }}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: FS.base, color: selected ? ck.bg : ck.text }}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  center: { paddingHorizontal: GUTTER, paddingTop: SP.xl, alignItems: 'center' },
  plain: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: '#8A8A8A', textAlign: 'center' },
});

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    section: { marginTop: SP.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    plain: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: ck.muted, marginTop: SP.sm },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: ck.muted, marginTop: SP.sm },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.md },
    error: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 18, color: ck.text },
    doneTitle: { fontFamily: FONT.bold, fontSize: FS.xl, color: ck.text, marginTop: SP.lg },
    codeBox: { marginTop: SP.lg, gap: SP.sm, padding: SP.md, borderRadius: 12, borderWidth: 1, borderColor: ck.fieldBorder },
    codeLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: ck.muted },
    code: { fontFamily: FONT.bold, fontSize: FS.lg, color: ck.text, marginBottom: SP.xs },
  });
}
