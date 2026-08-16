/**
 * Brandthread Buyer Checkout — Multi-step flow
 * Contact → Shipping → Delivery → Discounts → Payment → Review → Confirmation
 * All payment is demo-mode. No raw card data stored.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  getCart, createCheckoutSession, getCheckoutSession, saveCheckoutProgress,
  clearCheckoutSession, clearCart, applyDiscount, removeDiscount,
  getDemoPaymentMethods, calculateDemoTax, getDemoShippingMethods,
  calculateCartSummary,
} from '@/services/cartService';
import * as WebBrowser from 'expo-web-browser';
import { useApi } from '@/hooks/useApi';
import {
  CheckoutSession, CheckoutStep, CheckoutContact, CheckoutAddress,
  CheckoutDeliveryGroup, CheckoutDiscount, CheckoutPaymentMethod,
  CartItem, CHECKOUT_STEPS,
} from '@/services/cartTypes';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GRAD_PRIMARY,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) { return '$' + n.toFixed(2); }

const STEP_ORDER: CheckoutStep[] = ['contact', 'shipping', 'delivery', 'discounts', 'payment', 'review', 'confirmation'];
function stepIndex(s: CheckoutStep) { return STEP_ORDER.indexOf(s); }

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionTitle({ label }: { label: string }) {
  return <Text style={sc.title}>{label}</Text>;
}
function InputField({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry, error }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: any; autoCapitalize?: any;
  secureTextEntry?: boolean; error?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={inp.root}>
      <Text style={inp.label}>{label}</Text>
      <TextInput
        style={[inp.input, focused && inp.inputFocused, !!error && inp.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={SUBTLE}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        secureTextEntry={secureTextEntry}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {!!error && <Text style={inp.error}>{error}</Text>}
    </View>
  );
}
const inp = StyleSheet.create({
  root: { marginBottom: SP.sm },
  label: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    height: COMP.inputH, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
  },
  inputFocused: { borderColor: PURPLE },
  inputError: { borderColor: RED },
  error: { fontSize: FS.xs, fontFamily: FONT.regular, color: RED, marginTop: 2 },
});

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[card.root, style]}>{children}</View>;
}
const card = StyleSheet.create({ root: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md } });

const sc = StyleSheet.create({
  title: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
});

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: CheckoutStep }) {
  const steps = STEP_ORDER.filter(s => s !== 'confirmation');
  const idx = stepIndex(step);
  const confirmed = step === 'confirmation';
  return (
    <View style={pb.root}>
      {steps.map((s, i) => (
        <View key={s} style={[pb.seg, i === 0 && { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }, i === steps.length - 1 && { borderTopRightRadius: 4, borderBottomRightRadius: 4 }, (confirmed || i <= idx) && pb.segFilled]} />
      ))}
    </View>
  );
}
const pb = StyleSheet.create({
  root: { flexDirection: 'row', height: 3, gap: 2, marginBottom: SP.md },
  seg: { flex: 1, backgroundColor: BORDER },
  segFilled: { backgroundColor: PURPLE },
});

// ─── ─── Step: Contact ─────────────────────────────────────────────────────────

function ContactStep({ contact, onChange }: {
  contact: Partial<CheckoutContact>;
  onChange: (c: Partial<CheckoutContact>) => void;
}) {
  return (
    <View>
      <Card>
        <SectionTitle label="Contact Information" />
        <InputField label="Email address" value={contact.email ?? ''} onChangeText={v => onChange({ ...contact, email: v })} keyboardType="email-address" autoCapitalize="none" />
        <InputField label="Phone (optional)" value={contact.phone ?? ''} onChangeText={v => onChange({ ...contact, phone: v })} keyboardType="phone-pad" />
      </Card>
      <Card>
        <SectionTitle label="Order Updates" />
        {(['email', 'sms', 'both', 'none'] as const).map(opt => (
          <TouchableOpacity key={opt} style={cs.optRow} onPress={() => onChange({ ...contact, orderUpdates: opt })} activeOpacity={0.7}>
            <View style={[cs.radio, contact.orderUpdates === opt && cs.radioSelected]}>
              {contact.orderUpdates === opt && <View style={cs.radioDot} />}
            </View>
            <Text style={cs.optLabel}>{opt === 'both' ? 'Email & SMS' : opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </Card>
      <Card>
        <View style={cs.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={cs.switchLabel}>Marketing emails</Text>
            <Text style={cs.switchSub}>Get early access to drops and exclusive offers. You can unsubscribe at any time.</Text>
          </View>
          <Switch
            value={contact.marketingConsent ?? false}
            onValueChange={v => onChange({ ...contact, marketingConsent: v })}
            trackColor={{ true: PURPLE, false: BORDER }}
            thumbColor={FG}
          />
        </View>
      </Card>
    </View>
  );
}
const cs = StyleSheet.create({
  optRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: PURPLE },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE },
  optLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  switchSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },
});

// ─── Step: Shipping ───────────────────────────────────────────────────────────

function ShippingStep({ address, savedAddresses, onChange }: {
  address: Partial<CheckoutAddress>;
  savedAddresses: CheckoutAddress[];
  onChange: (a: Partial<CheckoutAddress>) => void;
}) {
  return (
    <View>
      {savedAddresses.length > 0 && (
        <Card>
          <SectionTitle label="Saved Addresses" />
          {savedAddresses.map((addr, i) => (
            <TouchableOpacity key={i} style={ss.savedRow} onPress={() => onChange(addr)} activeOpacity={0.7}>
              <Feather name="map-pin" size={14} color={PURPLE_LIGHT} />
              <View style={{ flex: 1 }}>
                <Text style={ss.savedName}>{addr.firstName} {addr.lastName}</Text>
                <Text style={ss.savedLine}>{addr.line1}, {addr.city} {addr.state}</Text>
              </View>
              {address.line1 === addr.line1 && <Feather name="check-circle" size={14} color={SUCCESS} />}
            </TouchableOpacity>
          ))}
        </Card>
      )}
      <Card>
        <SectionTitle label="Shipping Address" />
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <View style={{ flex: 1 }}><InputField label="First Name" value={address.firstName ?? ''} onChangeText={v => onChange({ ...address, firstName: v })} autoCapitalize="words" /></View>
          <View style={{ flex: 1 }}><InputField label="Last Name" value={address.lastName ?? ''} onChangeText={v => onChange({ ...address, lastName: v })} autoCapitalize="words" /></View>
        </View>
        <InputField label="Address" value={address.line1 ?? ''} onChangeText={v => onChange({ ...address, line1: v })} autoCapitalize="words" />
        <InputField label="Apt, suite, etc. (optional)" value={address.line2 ?? ''} onChangeText={v => onChange({ ...address, line2: v })} autoCapitalize="words" />
        <InputField label="City" value={address.city ?? ''} onChangeText={v => onChange({ ...address, city: v })} autoCapitalize="words" />
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <View style={{ flex: 1 }}><InputField label="State" value={address.state ?? ''} onChangeText={v => onChange({ ...address, state: v })} autoCapitalize="characters" /></View>
          <View style={{ flex: 1 }}><InputField label="Postal Code" value={address.postalCode ?? ''} onChangeText={v => onChange({ ...address, postalCode: v })} keyboardType="number-pad" autoCapitalize="none" /></View>
        </View>
        <InputField label="Country" value={address.country ?? 'US'} onChangeText={v => onChange({ ...address, country: v })} autoCapitalize="characters" />
        <InputField label="Phone" value={address.phone ?? ''} onChangeText={v => onChange({ ...address, phone: v })} keyboardType="phone-pad" />
      </Card>
      <Text style={ss.note}>Address validation is not active in demo mode. Verify your address is correct before proceeding.</Text>
    </View>
  );
}
const ss = StyleSheet.create({
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  savedName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  savedLine: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginBottom: SP.md, lineHeight: 17 },
});

// ─── Step: Delivery ───────────────────────────────────────────────────────────

function DeliveryStep({ groups, onSelect }: {
  groups: CheckoutDeliveryGroup[];
  onSelect: (sellerId: string, methodId: string) => void;
}) {
  return (
    <View>
      {groups.map(group => (
        <Card key={group.sellerId}>
          <View style={ds.groupHeader}>
            <View style={ds.avatar}><Text style={ds.avatarText}>{group.sellerName.charAt(0)}</Text></View>
            <Text style={ds.groupName}>{group.sellerName}</Text>
          </View>
          {group.hasPreOrder && (
            <View style={ds.preOrderNote}>
              <Feather name="clock" size={12} color={CYAN} />
              <Text style={ds.preOrderNoteText}>Contains pre-order items. Shipping occurs after production.</Text>
            </View>
          )}
          {group.availableMethods.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[ds.methodRow, group.selectedMethodId === m.id && ds.methodSelected]}
              onPress={() => { Haptics.selectionAsync(); onSelect(group.sellerId, m.id); }}
              activeOpacity={0.8}
            >
              <View style={[ds.radio, group.selectedMethodId === m.id && ds.radioSelected]}>
                {group.selectedMethodId === m.id && <View style={ds.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={ds.methodTop}>
                  <Text style={ds.carrier}>{m.carrier}</Text>
                  <Text style={ds.service}>{m.service}</Text>
                  {m.isRecommended && <View style={ds.recBadge}><Text style={ds.recText}>Recommended</Text></View>}
                </View>
                <Text style={ds.estDelivery}>{m.estimatedDelivery}</Text>
                {m.isPreOrderEstimate && <Text style={ds.preOrderEst}>Date is estimated after production</Text>}
              </View>
              <Text style={ds.price}>{fmtPrice(m.price)}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      ))}
      <Text style={ss.note}>Demo shipping rates shown. Final rates may vary.</Text>
    </View>
  );
}
const ds = StyleSheet.create({
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  groupName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  preOrderNote: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CYAN_DIM, borderRadius: RADIUS.xs, padding: 8, marginBottom: SP.sm },
  preOrderNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: CYAN, flex: 1 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderRadius: RADIUS.sm, paddingHorizontal: 6, marginBottom: 4 },
  methodSelected: { backgroundColor: PURPLE_DIM },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: PURPLE },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  methodTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  carrier: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  service: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  recBadge: { backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 2 },
  recText: { fontSize: 10, fontFamily: FONT.semibold, color: SUCCESS },
  estDelivery: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  preOrderEst: { fontSize: FS.xs, fontFamily: FONT.regular, color: CYAN, marginTop: 1 },
  price: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
});

// ─── Step: Discounts ──────────────────────────────────────────────────────────

function DiscountsStep({ discounts, subtotal, onApply, onRemove }: {
  discounts: CheckoutDiscount[];
  subtotal: number;
  onApply: (code: string) => Promise<void>;
  onRemove: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleApply() {
    if (!code.trim()) return;
    setLoading(true);
    await onApply(code.trim());
    setCode('');
    setLoading(false);
  }

  return (
    <View>
      <Card>
        <SectionTitle label="Discount Code" />
        <View style={disc.inputRow}>
          <TextInput
            style={[inp.input, { flex: 1 }]}
            value={code}
            onChangeText={setCode}
            placeholder="Enter code"
            placeholderTextColor={SUBTLE}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={disc.applyBtn} onPress={handleApply} activeOpacity={0.8} disabled={loading}>
            {loading ? <ActivityIndicator color={PURPLE_LIGHT} size="small" /> : <Text style={disc.applyText}>Apply</Text>}
          </TouchableOpacity>
        </View>
        {discounts.length === 0 && (
          <Text style={disc.hint}>Try: THREAD10, FREESHIP, FIRST20</Text>
        )}
      </Card>
      {discounts.length > 0 && (
        <Card>
          <SectionTitle label="Applied Discounts" />
          {discounts.map(d => (
            <View key={d.code} style={disc.appliedRow}>
              <View style={{ flex: 1 }}>
                {d.isValid ? (
                  <>
                    <Text style={disc.appliedCode}>{d.code}</Text>
                    <Text style={disc.appliedDesc}>{d.description}</Text>
                  </>
                ) : (
                  <>
                    <Text style={[disc.appliedCode, { color: RED }]}>{d.code}</Text>
                    <Text style={disc.appliedError}>{d.errorMessage}</Text>
                  </>
                )}
              </View>
              {d.isValid && <Text style={disc.savings}>–{fmtPrice(d.appliedAmount)}</Text>}
              <TouchableOpacity style={disc.removeBtn} onPress={() => onRemove(d.code)} activeOpacity={0.7}>
                <Feather name="x" size={14} color={MUTED} />
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}
const disc = StyleSheet.create({
  inputRow: { flexDirection: 'row', gap: SP.sm },
  applyBtn: { height: COMP.inputH, paddingHorizontal: SP.md, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  hint: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: SP.sm },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 6 },
  appliedCode: { fontSize: FS.sm, fontFamily: FONT.bold, color: SUCCESS },
  appliedDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  appliedError: { fontSize: FS.xs, fontFamily: FONT.regular, color: RED },
  savings: { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS },
  removeBtn: { padding: 4 },
});

// ─── Step: Payment ────────────────────────────────────────────────────────────

function PaymentStep({ method, onSelect, total, cardLast4, onCardLast4Change }: {
  method?: CheckoutPaymentMethod;
  onSelect: (m: CheckoutPaymentMethod) => void;
  total: number;
  cardLast4: string;
  onCardLast4Change: (v: string) => void;
}) {
  const methods = getDemoPaymentMethods();

  return (
    <View>
      <Card>
        <SectionTitle label="Payment Method" />
        {methods.map(m => (
          <TouchableOpacity
            key={m.type}
            style={[pay.methodRow, !m.isAvailable && pay.methodDisabled, method?.type === m.type && pay.methodSelected]}
            onPress={() => { if (m.isAvailable) { Haptics.selectionAsync(); onSelect(m); } }}
            activeOpacity={0.8}
            disabled={!m.isAvailable}
          >
            <View style={[pay.radio, method?.type === m.type && pay.radioSelected]}>
              {method?.type === m.type && <View style={pay.radioDot} />}
            </View>
            <Feather
              name={m.type === 'card' ? 'credit-card' : m.type === 'apple_pay' ? 'smartphone' : 'smartphone'}
              size={18}
              color={m.isAvailable ? FG : SUBTLE}
            />
            <View style={{ flex: 1 }}>
              <Text style={[pay.methodLabel, !m.isAvailable && { color: SUBTLE }]}>{m.label}</Text>
              {!m.isAvailable && <Text style={pay.notAvail}>Not available in demo mode</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </Card>

      {method?.type === 'card' && (
        <Card>
          <SectionTitle label="Card Details (Demo)" />
          <View style={pay.demoWarning}>
            <Feather name="shield" size={14} color={PURPLE_LIGHT} />
            <Text style={pay.demoWarningText}>
              Demo mode — no real card data is processed or stored. Enter any number to test.
            </Text>
          </View>
          <InputField
            label="Last 4 digits (demo)"
            value={cardLast4}
            onChangeText={onCardLast4Change}
            placeholder="e.g. 4242"
            keyboardType="number-pad"
            autoCapitalize="none"
          />
          <Text style={pay.testNote}>Test failure: enter 0002 (declined) or 0003 (insufficient funds)</Text>
          <View style={{ marginTop: SP.sm }}>
            <Text style={pay.securityNote}>
              <Feather name="lock" size={11} color={SUBTLE} /> Your payment is secured by Brandthread. We never store raw card data.
            </Text>
          </View>
        </Card>
      )}

      <Card>
        <SectionTitle label="Payment Summary" />
        <View style={pay.summaryRow}>
          <Text style={pay.summaryLabel}>Total to charge</Text>
          <Text style={pay.summaryValue}>{fmtPrice(total)}</Text>
        </View>
        <View style={pay.secureRow}>
          <Feather name="shield" size={13} color={SUCCESS} />
          <Text style={pay.secureText}>Payment protected while your order is fulfilled</Text>
        </View>
      </Card>
    </View>
  );
}
const pay = StyleSheet.create({
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 10, borderRadius: RADIUS.sm, paddingHorizontal: 6, marginBottom: 4 },
  methodSelected: { backgroundColor: PURPLE_DIM },
  methodDisabled: { opacity: 0.5 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: PURPLE },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  methodLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  notAvail: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  demoWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, padding: 10, marginBottom: SP.sm },
  demoWarningText: { fontSize: FS.xs, fontFamily: FONT.regular, color: PURPLE_LIGHT, flex: 1, lineHeight: 17 },
  testNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 4 },
  securityNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  summaryValue: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  secureText: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUCCESS },
});

// ─── Step: Review ─────────────────────────────────────────────────────────────

function ReviewStep({ session, onEdit, onAcknowledge, placing }: {
  session: CheckoutSession;
  onEdit: (step: CheckoutStep) => void;
  onAcknowledge: (key: string, val: boolean) => void;
  placing: boolean;
}) {
  const allItems = session.deliveryGroups.flatMap(g => g.items);
  const hasPreOrder = allItems.some(i => i.isPreOrder);
  const addr = session.shippingAddress;

  function EditBtn({ step }: { step: CheckoutStep }) {
    return (
      <TouchableOpacity style={rv.editBtn} onPress={() => onEdit(step)} activeOpacity={0.7}>
        <Text style={rv.editText}>Edit</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View>
      {/* Contact */}
      <Card>
        <View style={rv.sectionHead}><SectionTitle label="Contact" /><EditBtn step="contact" /></View>
        <Text style={rv.infoText}>{session.contact?.email ?? '—'}</Text>
        {session.contact?.phone ? <Text style={rv.infoText}>{session.contact.phone}</Text> : null}
      </Card>

      {/* Shipping */}
      <Card>
        <View style={rv.sectionHead}><SectionTitle label="Ship To" /><EditBtn step="shipping" /></View>
        {addr ? (
          <>
            <Text style={rv.infoText}>{addr.firstName} {addr.lastName}</Text>
            <Text style={rv.infoText}>{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}</Text>
            <Text style={rv.infoText}>{addr.city}, {addr.state} {addr.postalCode}</Text>
            <Text style={rv.infoText}>{addr.country}</Text>
          </>
        ) : <Text style={rv.infoText}>—</Text>}
      </Card>

      {/* Products */}
      <Card>
        <View style={rv.sectionHead}><SectionTitle label={`Items (${allItems.length})`} /></View>
        {allItems.map((item, idx) => (
          <View key={idx} style={[rv.itemRow, idx > 0 && { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={rv.itemName}>{item.productName}</Text>
              <Text style={rv.itemVariant}>{item.variantTitle}</Text>
              {item.isPreOrder && <Text style={rv.itemPre}>Pre-order · est. {item.preOrderEstShipDate ? new Date(item.preOrderEstShipDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'TBD'}</Text>}
            </View>
            <Text style={rv.itemPrice}>{item.quantity} × {fmtPrice(item.price)}</Text>
          </View>
        ))}
      </Card>

      {/* Delivery */}
      <Card>
        <View style={rv.sectionHead}><SectionTitle label="Delivery" /><EditBtn step="delivery" /></View>
        {session.deliveryGroups.map(g => {
          const m = g.availableMethods.find(m => m.id === g.selectedMethodId);
          return (
            <View key={g.sellerId} style={rv.deliveryRow}>
              <Text style={rv.deliveryName}>{g.sellerName}</Text>
              <Text style={rv.deliveryMethod}>{m ? `${m.carrier} ${m.service} · ${fmtPrice(m.price)}` : '—'}</Text>
            </View>
          );
        })}
      </Card>

      {/* Payment */}
      <Card>
        <View style={rv.sectionHead}><SectionTitle label="Payment" /><EditBtn step="payment" /></View>
        <Text style={rv.infoText}>{session.paymentMethod?.label ?? '—'}</Text>
      </Card>

      {/* Order summary */}
      <Card>
        <SectionTitle label="Order Summary" />
        <SummaryRow label="Subtotal" value={fmtPrice(session.summary.subtotal)} />
        {session.summary.discountTotal > 0 && <SummaryRow label="Discounts" value={`–${fmtPrice(session.summary.discountTotal)}`} accent={SUCCESS} />}
        <SummaryRow label="Shipping" value={fmtPrice(session.summary.shippingTotal)} />
        <SummaryRow label="Est. tax" value={fmtPrice(session.summary.taxTotal)} />
        <View style={rv.totalDivider} />
        <SummaryRow label="Total" value={fmtPrice(session.summary.total)} bold />
      </Card>

      {/* Pre-order notice */}
      {hasPreOrder && (
        <Card style={{ borderColor: 'rgba(34,211,238,0.3)', backgroundColor: CYAN_DIM }}>
          <View style={rv.preRow}><Feather name="clock" size={14} color={CYAN} /><Text style={rv.preTitle}>Pre-Order Notice</Text></View>
          <Text style={rv.preText}>Your cart includes pre-order items. These will ship after production is complete. Items may ship separately. Production and ship dates are estimates.</Text>
        </Card>
      )}

      {/* Acknowledgments */}
      {session.acknowledgments.map(ack => (
        <TouchableOpacity key={ack.key} style={rv.ackRow} onPress={() => onAcknowledge(ack.key, !ack.acknowledged)} activeOpacity={0.7}>
          <View style={[rv.checkbox, ack.acknowledged && rv.checkboxChecked]}>
            {ack.acknowledged && <Feather name="check" size={12} color={ON_DARK} />}
          </View>
          <Text style={rv.ackText}>{ack.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SummaryRow({ label, value, accent, bold }: { label: string; value: string; accent?: string; bold?: boolean }) {
  return (
    <View style={rv.sumRow}>
      <Text style={[rv.sumLabel, bold && rv.sumBold]}>{label}</Text>
      <Text style={[rv.sumValue, bold && rv.sumBold, !!accent && { color: accent }]}>{value}</Text>
    </View>
  );
}

const rv = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  editText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  infoText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 21 },
  itemRow: { paddingBottom: 8 },
  itemName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  itemPre: { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN, marginTop: 2 },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  deliveryRow: { marginBottom: 6 },
  deliveryName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  deliveryMethod: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  sumLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  sumValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sumBold: { fontFamily: FONT.bold, color: FG, fontSize: FS.base },
  totalDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  preRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  preTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN },
  preText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm, paddingHorizontal: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: PURPLE, borderColor: PURPLE },
  ackText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
});

// ─── Step: Confirmation ───────────────────────────────────────────────────────

function ConfirmationStep({ orderNumbers, total, sellerNames, address, hasPreOrder, session }: {
  orderNumbers: string[]; total: number; sellerNames: string[]; address?: Partial<CheckoutAddress>; hasPreOrder: boolean; session: CheckoutSession;
}) {
  const router = useRouter();
  const allItems = session.deliveryGroups.flatMap(g => g.items);

  return (
    <View style={conf.root}>
      {/* Success icon */}
      <View style={conf.iconCircle}>
        <Feather name="check" size={36} color={ON_DARK} />
      </View>
      <Text style={conf.headline}>Order Confirmed!</Text>
      <Text style={conf.sub}>Thank you for your purchase.</Text>

      {/* Order numbers */}
      <Card>
        <SectionTitle label="Order Numbers" />
        {orderNumbers.map((num, i) => (
          <View key={num} style={conf.orderNumRow}>
            <Text style={conf.sellerLabel}>{sellerNames[i] ?? 'Order'}</Text>
            <Text style={conf.orderNum}>{num}</Text>
          </View>
        ))}
      </Card>

      {/* Products */}
      <Card>
        <SectionTitle label="Your Items" />
        {allItems.map((item, idx) => (
          <Text key={idx} style={conf.itemText}>{item.productName} · {item.variantTitle} × {item.quantity}</Text>
        ))}
      </Card>

      {/* Payment & address */}
      <Card>
        <SectionTitle label="Payment" />
        <Text style={conf.detail}>{fmtPrice(total)} charged via {session.paymentMethod?.label ?? 'card'} (demo)</Text>
        <View style={conf.heldFundsBox}>
          <Feather name="shield" size={14} color={PURPLE_LIGHT} />
          <Text style={conf.heldFundsText}>Your payment is protected while the order moves through fulfillment.</Text>
        </View>
      </Card>

      {address?.city && (
        <Card>
          <SectionTitle label="Shipping To" />
          <Text style={conf.detail}>{address.firstName} {address.lastName}</Text>
          <Text style={conf.detail}>{address.line1}, {address.city} {address.state}</Text>
        </Card>
      )}

      {hasPreOrder && (
        <Card style={{ borderColor: 'rgba(34,211,238,0.3)', backgroundColor: CYAN_DIM }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Feather name="clock" size={14} color={CYAN} />
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN }}>Pre-Order Status</Text>
          </View>
          <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 }}>
            Your pre-order items will ship after production. You'll receive updates as they progress through each stage.
          </Text>
        </Card>
      )}

      {/* Milestones */}
      <Card>
        <SectionTitle label="What happens next" />
        {[
          { icon: 'check-circle', label: 'Payment confirmed', done: true },
          { icon: 'package', label: 'Seller processing your order', done: false },
          { icon: 'truck', label: 'Shipped', done: false },
          { icon: 'home', label: 'Delivered', done: false },
        ].map((m, i) => (
          <View key={i} style={conf.milestoneRow}>
            <Feather name={m.icon as any} size={14} color={m.done ? SUCCESS : MUTED} />
            <Text style={[conf.milestoneText, m.done && { color: SUCCESS }]}>{m.label}</Text>
          </View>
        ))}
      </Card>

      {/* Actions */}
      <TouchableOpacity style={conf.btn} onPress={() => router.replace('/(buyer)/orders' as never)} activeOpacity={0.85}>
        <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={conf.btnGrad}>
          <Feather name="package" size={16} color={ON_DARK} />
          <Text style={conf.btnText}>View My Orders</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity style={conf.btnSecondary} onPress={() => router.replace('/(buyer)/discover' as never)} activeOpacity={0.8}>
        <Text style={conf.btnSecondaryText}>Continue Shopping</Text>
      </TouchableOpacity>
    </View>
  );
}

const conf = StyleSheet.create({
  root: { alignItems: 'center', paddingBottom: SP.xl },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md, ...SHADOW_PURPLE },
  headline: { fontSize: FS.xxl, fontFamily: FONT.bold, color: FG, marginBottom: 4 },
  sub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.lg },
  orderNumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  sellerLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  orderNum: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  itemText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 22 },
  detail: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 22 },
  heldFundsBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, padding: 10, marginTop: SP.sm },
  heldFundsText: { fontSize: FS.xs, fontFamily: FONT.regular, color: PURPLE_LIGHT, flex: 1, lineHeight: 17 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 5 },
  milestoneText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  btn: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden', marginTop: SP.md },
  btnGrad: { height: COMP.buttonH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  btnText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
  btnSecondary: { marginTop: SP.sm, paddingVertical: 12 },
  btnSecondaryText: { fontSize: FS.base, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BuyerCheckoutScreen() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const api = useApi();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState<Partial<CheckoutContact>>({ orderUpdates: 'email', marketingConsent: false });
  const [address, setAddress] = useState<Partial<CheckoutAddress>>({ country: 'US' });
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod | undefined>();
  const [cardLast4, setCardLast4] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placedOrderNumbers, setPlacedOrderNumbers] = useState<string[]>([]);
  const [placedTotal, setPlacedTotal] = useState(0);
  const [failureMessage, setFailureMessage] = useState('');
  /** Set when the API confirms the seller's Stripe Connect account isn't ready. */
  const [sellerPaymentError, setSellerPaymentError] = useState<{ sellerName: string; sellerId: string } | null>(null);

  /**
   * Tracks which seller groups have already been charged this checkout session.
   * Maps sellerId → { stripeSessionId, orderNumber, amountTotalCents (from Stripe) }.
   * Persists across re-renders (and is also persisted to AsyncStorage after each
   * payment) so a retry or component remount never re-charges a paid seller.
   */
  const paidGroupsRef = useRef<Map<string, { stripeSessionId: string; orderNumber: string; amountTotalCents: number }>>(new Map());

  const placeOrderIdempotencyRef = useRef<string>('');

  useEffect(() => {
    (async () => {
      let s = await getCheckoutSession();
      if (!s) {
        const cart = await getCart();
        if (cart.items.length === 0) { router.back(); return; }
        s = await createCheckoutSession(cart, source === 'buynow');
      }
      setSession(s);
      if (s.contact) setContact(s.contact);
      if (s.shippingAddress) setAddress(s.shippingAddress);
      if (s.paymentMethod) setPaymentMethod(s.paymentMethod);
      placeOrderIdempotencyRef.current = s.idempotencyKey;

      // Restore any durably-persisted group-payment state from AsyncStorage so
      // that a component remount between seller A paid and seller B paid will
      // correctly skip re-charging seller A.
      if (s.paidGroups) {
        for (const [sid, entry] of Object.entries(s.paidGroups)) {
          paidGroupsRef.current.set(sid, entry);
        }
      }

      setLoading(false);
    })();
  }, []);

  if (loading || !session) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  const step = session.step;
  const isConfirmed = step === 'confirmation';
  const allItems = session.deliveryGroups.flatMap(g => g.items);

  // Non-null session alias used in closures (safe — we guard above with early return)
  const sess = session as CheckoutSession;

  async function persistAndNext(updates: Partial<CheckoutSession>, nextStep: CheckoutStep) {
    const updated = { ...sess, ...updates, step: nextStep } as CheckoutSession;
    setSession(updated);
    await saveCheckoutProgress(updated);
  }

  function validateContact(): boolean {
    if (!contact.email || !contact.email.includes('@')) {
      Alert.alert('Missing Info', 'Please enter a valid email address.');
      return false;
    }
    return true;
  }

  function validateAddress(): boolean {
    if (!address.firstName || !address.lastName || !address.line1 || !address.city || !address.state || !address.postalCode) {
      Alert.alert('Missing Info', 'Please fill in all required address fields.');
      return false;
    }
    return true;
  }

  function validatePayment(): boolean {
    if (!paymentMethod) { Alert.alert('No Payment', 'Please select a payment method.'); return false; }
    return true;
  }

  function validateAcknowledgments(): boolean {
    const unacked = sess.acknowledgments.filter(a => a.required && !a.acknowledged);
    if (unacked.length > 0) {
      Alert.alert('Acknowledgment Required', 'Please check all required acknowledgments before placing your order.');
      return false;
    }
    return true;
  }

  async function handleContinue() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (step === 'contact') {
      if (!validateContact()) return;
      const fullContact: CheckoutContact = {
        email: contact.email!,
        phone: contact.phone ?? '',
        marketingConsent: contact.marketingConsent ?? false,
        orderUpdates: contact.orderUpdates ?? 'email',
      };
      const tax = address.state ? calculateDemoTax(sess.summary.subtotal, address.state) : undefined;
      const discountTotal = sess.discounts.filter(d => d.isValid).reduce((s, d) => s + d.appliedAmount, 0);
      const shippingTotal = sess.deliveryGroups.reduce((s, g) => {
        const m = g.availableMethods.find(m => m.id === g.selectedMethodId);
        return s + (m?.price ?? 12.40);
      }, 0);
      const summary = calculateCartSummary(allItems, discountTotal, shippingTotal);
      await persistAndNext({ contact: fullContact, tax, summary }, 'shipping');
    } else if (step === 'shipping') {
      if (!validateAddress()) return;
      const fullAddress: CheckoutAddress = {
        firstName: address.firstName!, lastName: address.lastName!,
        line1: address.line1!, line2: address.line2 ?? '',
        city: address.city!, state: address.state!,
        postalCode: address.postalCode!, country: address.country ?? 'US',
        phone: address.phone ?? '',
      };
      const existing = sess.savedAddresses.find(a => a.line1 === fullAddress.line1);
      const savedAddresses = existing ? sess.savedAddresses : [...sess.savedAddresses, fullAddress];
      const tax = calculateDemoTax(sess.summary.subtotal, fullAddress.state);
      const summary = { ...sess.summary, taxTotal: tax.amount, total: Math.max(0, +(sess.summary.subtotal + sess.summary.shippingTotal - sess.summary.discountTotal + tax.amount).toFixed(2)) };
      await persistAndNext({ shippingAddress: fullAddress, savedAddresses, tax, summary }, 'delivery');
    } else if (step === 'delivery') {
      await persistAndNext({}, 'discounts');
    } else if (step === 'discounts') {
      await persistAndNext({}, 'payment');
    } else if (step === 'payment') {
      if (!validatePayment()) return;
      await persistAndNext({ paymentMethod }, 'review');
    } else if (step === 'review') {
      if (!validateAcknowledgments()) return;
      setPlacing(true);
      setFailureMessage('');
      setSellerPaymentError(null);
      // Tracks which group was active when an error occurred so the catch block
      // can identify the seller and show a targeted error message.
      let currentGroup: (typeof sess.deliveryGroups)[0] | null = null;
      try {
        // Split checkout by seller — the server enforces single-seller per session.
        // paidGroupsRef persists across retries so a failed-then-retried session
        // never creates a duplicate Stripe charge for a seller already paid.
        for (const group of sess.deliveryGroups) {
          currentGroup = group;
          // Skip groups already successfully paid in a prior attempt this session
          if (paidGroupsRef.current.has(group.sellerId)) continue;

          // Seller-scoped items only
          const groupItems = group.items.map(i => ({
            variantId: i.variantId,
            productId: i.productId,
            quantity:  i.quantity,
          }));

          // Map the mobile CheckoutAddress → server shipping DTO
          const sa = sess.shippingAddress;
          const serverShipping = sa
            ? {
                name:    [sa.firstName, sa.lastName].filter(Boolean).join(' ') || undefined,
                street:  [sa.line1, sa.line2].filter(Boolean).join(', '),
                city:    sa.city,
                state:   sa.state,
                zip:     sa.postalCode,
                country: sa.country ?? 'US',
              }
            : undefined;

          // Derive a stable per-attempt key: checkoutId + sellerId.
          // Changes when a new checkout session is created (cart edit → fresh idempotencyKey).
          // Stable on retries within the same checkout → server returns the existing session.
          const clientIdempotencyKey = `${sess.idempotencyKey}_${group.sellerId}`;

          const { sessionId, url } = await api.buyer.checkout.createSession(groupItems, {
            contactEmail:        contact.email ?? undefined,
            shippingAddress:     serverShipping,
            clientIdempotencyKey,
          });

          // Open Stripe Checkout in the in-app browser
          const browserResult = await WebBrowser.openAuthSessionAsync(url, 'mobile://checkout/return');

          if (browserResult.type === 'cancel') {
            setFailureMessage('Checkout was cancelled. Tap "Place Order" to try again.');
            setPlacing(false);
            return;
          }

          // Parse session_id from the redirect URL if Stripe returned it
          let verifyId = sessionId;
          if (browserResult.type === 'success' && browserResult.url) {
            try {
              const parsed = new URL(browserResult.url);
              const sid = parsed.searchParams.get('session_id');
              if (sid) verifyId = sid;
            } catch {}
          }

          // Verify payment status for this seller
          const verification = await api.buyer.checkout.verifySession(verifyId);
          if (verification.paymentStatus !== 'paid') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setFailureMessage(
              verification.paymentStatus === 'unpaid'
                ? `Payment for ${group.sellerName} was not completed. Please try again.`
                : `Payment for ${group.sellerName} is pending. Check your Orders for updates.`,
            );
            setPlacing(false);
            return;
          }

          // Record this seller as paid and immediately persist to AsyncStorage so
          // that the state survives a component remount between seller payments.
          paidGroupsRef.current.set(group.sellerId, {
            stripeSessionId: verifyId,
            orderNumber: verification.orderNumber ?? '',
            amountTotalCents: verification.amountTotal ?? 0,
          });
          // Durably persist paidGroups so a remount can restore paidGroupsRef
          // and avoid re-charging sellers already confirmed via Stripe.
          const durablePaidGroups: CheckoutSession['paidGroups'] = {};
          for (const [sid, entry] of paidGroupsRef.current.entries()) {
            durablePaidGroups[sid] = entry;
          }
          await saveCheckoutProgress({ ...sess, paidGroups: durablePaidGroups } as CheckoutSession);
        }

        // All sellers paid — poll for webhook-created order numbers before
        // showing the confirmation screen. The webhook may be slightly behind.
        const MAX_POLL_ATTEMPTS = 6;
        const POLL_INTERVAL_MS  = 2000;
        for (const [, entry] of paidGroupsRef.current.entries()) {
          if (entry.orderNumber) continue; // already have it
          for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            try {
              const polled = await api.buyer.checkout.verifySession(entry.stripeSessionId);
              if (polled.orderNumber) {
                entry.orderNumber = polled.orderNumber;
                break;
              }
            } catch { /* continue polling */ }
          }
        }

        // Collect final order numbers and Stripe totals from the ref
        const allOrderNumbers = [...paidGroupsRef.current.values()]
          .map(v => v.orderNumber)
          .filter(Boolean);

        // Use the sum of Stripe's authoritative amountTotal values (in cents → dollars)
        // so the confirmation screen shows the exact amount charged, not a local estimate.
        const stripeChargedTotal = [...paidGroupsRef.current.values()]
          .reduce((s, v) => s + v.amountTotalCents, 0) / 100;
        const confirmedTotal = stripeChargedTotal > 0 ? stripeChargedTotal : sess.summary.total;

        // All sellers paid successfully
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPlacedOrderNumbers(allOrderNumbers);
        setPlacedTotal(confirmedTotal);
        if (!sess.isBuyNow) await clearCart();
        await clearCheckoutSession();
        setSession({ ...sess, step: 'confirmation' } as CheckoutSession);
      } catch (err: any) {
        // Try to extract the JSON body embedded in "API 400: {\"error\":\"...\"}"
        const rawMsg: string = err?.message ?? '';
        let apiError = '';
        try {
          const jsonStart = rawMsg.indexOf('{');
          if (jsonStart !== -1) {
            const parsed = JSON.parse(rawMsg.slice(jsonStart));
            apiError = parsed?.error ?? '';
          }
        } catch { /* ignore parse errors */ }

        // Detect seller-payment-account errors by matching the server's exact phrases
        const isSellerPaymentError =
          apiError.includes('payment account') ||
          apiError.includes('payment account not yet active') ||
          apiError.includes('has not set up a payment account');

        if (isSellerPaymentError && currentGroup) {
          setSellerPaymentError({ sellerName: currentGroup.sellerName, sellerId: currentGroup.sellerId });
          setFailureMessage('');
        } else {
          setFailureMessage(apiError || rawMsg || 'Something went wrong. Please try again.');
        }
      }
      setPlacing(false);
    }
  }

  async function handleBack() {
    if (step === 'contact') { router.back(); return; }
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      const prev = STEP_ORDER[idx - 1];
      const updated = { ...sess, step: prev } as CheckoutSession;
      setSession(updated);
      await saveCheckoutProgress(updated);
    }
  }

  function handleEditStep(targetStep: CheckoutStep) {
    const updated = { ...sess, step: targetStep } as CheckoutSession;
    setSession(updated);
    saveCheckoutProgress(updated);
  }

  async function handleApplyDiscount(code: string) {
    const discount = await applyDiscount(code, sess.summary.subtotal, sess.discounts);
    const discounts = [...sess.discounts.filter(d => d.code !== discount.code), discount];
    const discountTotal = discounts.filter(d => d.isValid).reduce((s, d) => s + d.appliedAmount, 0);
    const shippingFree = discounts.some(d => d.isValid && d.type === 'free_shipping');
    const shippingTotal = shippingFree ? 0 : sess.summary.shippingTotal;
    const taxTotal = sess.tax?.amount ?? 0;
    const total = Math.max(0, +(sess.summary.subtotal - discountTotal + shippingTotal + taxTotal).toFixed(2));
    const updated = { ...sess, discounts, summary: { ...sess.summary, discountTotal, shippingTotal, total } } as CheckoutSession;
    setSession(updated);
    await saveCheckoutProgress(updated);
  }

  async function handleRemoveDiscount(code: string) {
    const discounts = await removeDiscount(code, sess.discounts);
    const discountTotal = discounts.filter(d => d.isValid).reduce((s, d) => s + d.appliedAmount, 0);
    const shippingFree = discounts.some(d => d.isValid && d.type === 'free_shipping');
    const shippingTotal = shippingFree ? 0 : 12.40;
    const taxTotal = sess.tax?.amount ?? 0;
    const total = Math.max(0, +(sess.summary.subtotal - discountTotal + shippingTotal + taxTotal).toFixed(2));
    const updated = { ...sess, discounts, summary: { ...sess.summary, discountTotal, shippingTotal, total } } as CheckoutSession;
    setSession(updated);
    await saveCheckoutProgress(updated);
  }

  function handleSelectDelivery(sellerId: string, methodId: string) {
    const deliveryGroups = sess.deliveryGroups.map(g =>
      g.sellerId === sellerId ? { ...g, selectedMethodId: methodId } : g
    );
    const shippingTotal = deliveryGroups.reduce((s, g) => {
      const m = g.availableMethods.find(m => m.id === g.selectedMethodId);
      return s + (m?.price ?? 0);
    }, 0);
    const discountTotal = sess.discounts.filter(d => d.isValid).reduce((s, d) => s + d.appliedAmount, 0);
    const taxTotal = sess.tax?.amount ?? 0;
    const total = Math.max(0, +(sess.summary.subtotal - discountTotal + shippingTotal + taxTotal).toFixed(2));
    const updated = { ...sess, deliveryGroups, summary: { ...sess.summary, shippingTotal, total } } as CheckoutSession;
    setSession(updated);
    saveCheckoutProgress(updated);
  }

  function handleAcknowledge(key: string, val: boolean) {
    const acknowledgments = sess.acknowledgments.map(a => a.key === key ? { ...a, acknowledged: val } : a);
    const updated = { ...sess, acknowledgments } as CheckoutSession;
    setSession(updated);
    saveCheckoutProgress(updated);
  }

  const stepLabel = CHECKOUT_STEPS.find(s => s.key === step)?.label ?? '';
  const hasPreOrder = allItems.some(i => i.isPreOrder);
  const sellerNames = sess.deliveryGroups.map(g => g.sellerName);

  const continueLabel = step === 'review' ? (placing ? 'Placing Order…' : `Place Order · ${fmtPrice(session.summary.total)}`) : 'Continue';
  const showContinue = !isConfirmed;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      {!isConfirmed && (
        <View style={[co.header, { paddingTop: insets.top + SP.xs }]}>
          <TouchableOpacity style={co.backBtn} onPress={handleBack} activeOpacity={0.7}>
            <Feather name="chevron-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={co.stepLabel}>{stepLabel}</Text>
            <ProgressBar step={step} />
          </View>
          <View style={{ width: 40 }} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SP.md,
          paddingTop: SP.sm,
          paddingBottom: insets.bottom + (showContinue ? 100 : SP.xl),
        }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'contact' && <ContactStep contact={contact} onChange={setContact} />}
        {step === 'shipping' && <ShippingStep address={address} savedAddresses={session.savedAddresses} onChange={setAddress} />}
        {step === 'delivery' && <DeliveryStep groups={session.deliveryGroups} onSelect={handleSelectDelivery} />}
        {step === 'discounts' && (
          <DiscountsStep
            discounts={session.discounts}
            subtotal={session.summary.subtotal}
            onApply={handleApplyDiscount}
            onRemove={handleRemoveDiscount}
          />
        )}
        {step === 'payment' && (
          <PaymentStep
            method={paymentMethod}
            onSelect={setPaymentMethod}
            total={session.summary.total}
            cardLast4={cardLast4}
            onCardLast4Change={setCardLast4}
          />
        )}
        {step === 'review' && (
          <ReviewStep
            session={session}
            onEdit={handleEditStep}
            onAcknowledge={handleAcknowledge}
            placing={placing}
          />
        )}
        {step === 'confirmation' && (
          <ConfirmationStep
            orderNumbers={placedOrderNumbers}
            total={placedTotal}
            sellerNames={sellerNames}
            address={address}
            hasPreOrder={hasPreOrder}
            session={session}
          />
        )}

        {!!sellerPaymentError && (
          <View style={co.sellerPaymentErrorCard}>
            <View style={co.sellerPaymentErrorHeader}>
              <Feather name="alert-triangle" size={16} color={ORANGE} />
              <Text style={co.sellerPaymentErrorTitle}>Payment Not Available</Text>
            </View>
            <Text style={co.sellerPaymentErrorBody}>
              <Text style={{ fontFamily: FONT.semibold }}>{sellerPaymentError.sellerName}</Text>
              {' '}hasn't finished setting up their payment account yet, so we can't process your order right now.{'\n\n'}Try again later, or reach out to the seller directly.
            </Text>
            <TouchableOpacity
              style={co.contactSellerBtn}
              activeOpacity={0.8}
              onPress={() =>
                router.push(
                  `/buyer-conversation?participantId=${encodeURIComponent(sellerPaymentError.sellerId)}&participantName=${encodeURIComponent(sellerPaymentError.sellerName)}&participantAccountType=seller` as never,
                )
              }
            >
              <Feather name="message-circle" size={14} color={ORANGE} />
              <Text style={co.contactSellerBtnText}>Message {sellerPaymentError.sellerName}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!failureMessage && (
          <View style={co.errorBanner}>
            <Feather name="alert-circle" size={16} color={RED} />
            <Text style={co.errorText}>{failureMessage}</Text>
          </View>
        )}
      </ScrollView>

      {/* Continue / Place Order bar */}
      {showContinue && (
        <View style={[co.bottomBar, { paddingBottom: insets.bottom + SP.sm }]}>
          <TouchableOpacity
            style={co.continueBtn}
            onPress={handleContinue}
            activeOpacity={0.88}
            disabled={placing}
          >
            <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={co.continueGrad}>
              {placing ? (
                <ActivityIndicator color={ON_DARK} size="small" />
              ) : (
                <>
                  {step === 'review' && <Feather name="lock" size={15} color={ON_DARK} />}
                  <Text style={co.continueText}>{continueLabel}</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const co = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md,
    paddingBottom: SP.sm, gap: SP.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 6 },
  bottomBar: {
    paddingHorizontal: SP.md, paddingTop: SP.md,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  continueBtn: { borderRadius: RADIUS.lg, overflow: 'hidden', ...SHADOW_PURPLE },
  continueGrad: { height: COMP.buttonH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  continueText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: RED_DIM, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  errorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: RED, lineHeight: 20 },
  sellerPaymentErrorCard: { backgroundColor: ORANGE_DIM, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md, borderWidth: 1, borderColor: 'rgba(251,146,60,0.35)' },
  sellerPaymentErrorHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 8 },
  sellerPaymentErrorTitle: { fontSize: FS.sm, fontFamily: FONT.bold, color: ORANGE },
  sellerPaymentErrorBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20, marginBottom: SP.md },
  contactSellerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(251,146,60,0.12)', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: 'rgba(251,146,60,0.35)' },
  contactSellerBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: ORANGE },
});
