/**
 * Seller: store gift cards. Turn selling on or off, choose the amounts buyers
 * can pick, issue a card directly, and see / void the cards for this store.
 * Reached from More, Store, Gift cards.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BrandthreadScreen, HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { CheckoutField, CheckoutSection, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_SELLER_CARDS, PREVIEW_SETTINGS } from '@/lib/giftCardsPreview';
import {
  EMAIL_PATTERN, amountTextToCents, giftCardMask, giftCardStatusLabel, type GiftCard, type GiftCardSettings,
} from '@/lib/giftCards';

export default function GiftCardsManageScreen() {
  const router = useRouter();
  const api = useApi();
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const preview = isSellerDevPreview();
  const [settings, setSettings] = useState<GiftCardSettings | null>(null);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issueAmount, setIssueAmount] = useState('');
  const [issueEmail, setIssueEmail] = useState('');
  const [issueName, setIssueName] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; emailed: boolean } | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    if (preview) {
      const demo = isPreviewDemoMode();
      setSettings(demo ? PREVIEW_SETTINGS : { ...PREVIEW_SETTINGS, enabled: false });
      setCards(demo ? PREVIEW_SELLER_CARDS : []);
      setOutstanding(demo ? PREVIEW_SELLER_CARDS.reduce((sum, card) => sum + card.balanceCents, 0) : 0);
      setLoading(false);
      return;
    }
    try {
      const [st, list] = await Promise.all([api.giftCards.seller.settings(), api.giftCards.seller.cards()]);
      setSettings(st);
      setCards(list.cards);
      setOutstanding(list.outstandingCents);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, preview]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save(patch: Parameters<typeof api.giftCards.seller.saveSettings>[0]) {
    if (!settings) return;
    setSaveError(null);
    const before = settings;
    setSettings({ ...settings, ...patch } as GiftCardSettings);
    if (preview) return;
    try {
      setSettings(await api.giftCards.seller.saveSettings(patch));
    } catch (err) {
      setSettings(before);
      setSaveError(err instanceof ApiError && err.status < 500 ? err.message : 'We couldn’t save that. Try again.');
    }
  }

  function addAmount() {
    const cents = amountTextToCents(amountText);
    if (!settings || !cents) { setSaveError('Enter an amount like 25 or 50.00'); return; }
    setAmountText('');
    void save({ denominations: [...new Set([...settings.denominations, cents])] });
  }

  async function issue() {
    const cents = amountTextToCents(issueAmount);
    if (!cents) { setIssueError('Enter an amount like 25 or 50.00'); return; }
    if (!EMAIL_PATTERN.test(issueEmail.trim())) { setIssueError('Enter the recipient’s email'); return; }
    if (preview) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const result = await api.giftCards.seller.issue({
        amountCents: cents, recipientEmail: issueEmail.trim(), ...(issueName.trim() ? { recipientName: issueName.trim() } : {}),
      });
      setIssued({ code: result.code, emailed: result.emailed });
      setIssueAmount(''); setIssueEmail(''); setIssueName('');
      await load();
    } catch (err) {
      setIssueError(err instanceof ApiError && err.status < 500 ? err.message : 'We couldn’t issue that card. Try again.');
    } finally {
      setIssuing(false);
    }
  }

  function confirmVoid(card: GiftCard) {
    Alert.alert('Void this gift card?', `${giftCardMask(card)} has ${formatCents(card.balanceCents)} left. Voiding removes it and can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: () => {
          if (preview) return;
          void api.giftCards.seller.void(card.id).then(load).catch(() => Alert.alert('Couldn’t void the card', 'Try again in a moment.'));
        },
      },
    ]);
  }

  return (
    <BrandthreadScreen scrollable noSafeTop>
      <ScreenHeader title="Gift cards" onBack={() => goBackOr(router)} />
      <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
        {loading ? (
          <View style={s.center}><ActivityIndicator /></View>
        ) : failed || !settings ? (
          <RetryRow label="Couldn’t load gift cards" onRetry={() => void load()} />
        ) : (
          <>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Sell gift cards</Text>
                <Text style={s.fine}>Buyers can buy and send a gift card for your store. It only works on your products.</Text>
              </View>
              <HapticSwitch value={settings.enabled} onValueChange={value => void save({ enabled: value })} />
            </View>

            <CheckoutSection title="Amounts" style={s.section}>
              <View style={s.chips}>
                {settings.denominations.map(cents => (
                  <PressableScale
                    key={cents}
                    style={s.chip}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${formatCents(cents)}`}
                    onPress={() => settings.denominations.length > 1 && void save({ denominations: settings.denominations.filter(d => d !== cents) })}
                  >
                    <Text style={s.chipText}>{formatCents(cents)}  ×</Text>
                  </PressableScale>
                ))}
              </View>
              <View style={s.inlineRow}>
                <CheckoutField
                  label="Add an amount" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
                  placeholder="25" style={{ flex: 1, marginBottom: 0 }} onSubmitEditing={addAmount}
                />
                <Button label="Add" variant="secondary" size="small" onPress={addAmount} disabled={!amountText.trim()} style={s.inlineButton} />
              </View>
              <View style={[s.switchRow, { marginTop: SP.md }]}>
                <Text style={[s.title, { flex: 1 }]}>Allow custom amounts</Text>
                <HapticSwitch value={settings.allowCustom} onValueChange={value => void save({ allowCustom: value })} />
              </View>
              {saveError ? <Text style={s.error}>{saveError}</Text> : null}
            </CheckoutSection>

            <CheckoutSection title="Issue a gift card" style={s.section}>
              {issued ? (
                <View style={s.codeBox}>
                  <Text style={s.fine}>{issued.emailed ? 'Emailed to the recipient. The code is shown once.' : 'The email didn’t send. Share the code yourself. It’s shown once.'}</Text>
                  <Text style={s.code} selectable>{issued.code}</Text>
                  <Button label="Share code" variant="secondary" icon="share" onPress={() => void Share.share({ message: `Your gift card code: ${issued.code}` }).catch(() => {})} />
                </View>
              ) : null}
              <CheckoutField label="Amount" value={issueAmount} onChangeText={setIssueAmount} keyboardType="decimal-pad" placeholder="25" />
              <CheckoutField label="Recipient email" value={issueEmail} onChangeText={setIssueEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="Enter email" />
              <CheckoutField label="Recipient name" value={issueName} onChangeText={setIssueName} placeholder="Enter name" autoCapitalize="words" />
              {issueError ? <Text style={s.error}>{issueError}</Text> : null}
              <Button label="Issue gift card" onPress={() => void issue()} loading={issuing} fullWidth />
            </CheckoutSection>

            <CheckoutSection title="Issued cards" style={s.section}>
              <Text style={s.total}>{formatCents(outstanding)}</Text>
              <Text style={[s.fine, { marginBottom: SP.sm }]}>Outstanding balance on active cards</Text>
              {cards.length === 0 ? (
                <Text style={s.fine}>Cards bought or issued for your store appear here.</Text>
              ) : cards.map(card => (
                <View key={card.id} style={s.cardRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.title}>{giftCardMask(card)} · {formatCents(card.balanceCents)} of {formatCents(card.initialCents)}</Text>
                    <Text style={s.fine} numberOfLines={1}>{card.recipientName || card.recipientEmail || 'Unassigned'} · {giftCardStatusLabel(card)}</Text>
                  </View>
                  {card.status === 'active' ? (
                    <PressableScale onPress={() => confirmVoid(card)} accessibilityRole="button" accessibilityLabel={`Void gift card ${giftCardMask(card)}`}>
                      <Text style={s.void}>Void</Text>
                    </PressableScale>
                  ) : null}
                </View>
              ))}
            </CheckoutSection>
          </>
        )}
      </View>
    </BrandthreadScreen>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    center: { alignItems: 'center', paddingTop: SP.xl },
    section: { marginTop: SP.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm },
    title: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 2 },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text, marginVertical: SP.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md },
    chip: { minHeight: 40, paddingHorizontal: SP.md, borderRadius: 20, borderWidth: 1, borderColor: ck.fieldBorder, justifyContent: 'center' },
    chipText: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    inlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
    inlineButton: { marginTop: 25, minWidth: 84 },
    total: { fontFamily: FONT.bold, fontSize: 30, color: ck.text },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm + 2, borderTopWidth: 1, borderTopColor: ck.divider },
    void: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline', color: ck.text },
    codeBox: { gap: SP.sm, padding: SP.md, borderRadius: 14, borderWidth: 1, borderColor: ck.fieldBorder, marginBottom: SP.md },
    code: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: 2, color: ck.text },
  });
}
