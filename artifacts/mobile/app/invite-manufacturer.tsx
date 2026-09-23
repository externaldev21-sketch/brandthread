/**
 * Invite your own manufacturer.
 *
 * Creates a private signup link for a factory the seller already works with.
 * The manufacturer signs up on the Brandthread manufacturer portal through the
 * link, stays out of the public directory, and lands in a private
 * conversation with this seller.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, ICON, MUTED, ORANGE, RADIUS, SP, SUBTLE, SUCCESS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FormInput, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { createInvitation, getInvitations } from '@/services/manufacturerService';
import type { ManufacturerInvitation } from '@/services/manufacturerTypes';
import { getEntitlementRejection } from '@/lib/entitlementError';

function inviteMessage(companyName: string, link: string) {
  return `Hi${companyName ? ` ${companyName}` : ''} — I'd like to manage our production on Brandthread. It's free for you: sign up with this private link and we'll have one place for messages, samples, orders and payments.\n\n${link}`;
}

export default function InviteManufacturerScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ companyName?: string; email?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ManufacturerInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState<ManufacturerInvitation[] | null>(null);
  const [invitesError, setInvitesError] = useState(false);

  const loadInvites = useCallback(async () => {
    try {
      setInvitesError(false);
      setInvites(await getInvitations());
    } catch {
      setInvitesError(true);
    }
  }, []);
  useEffect(() => { void loadInvites(); }, [loadInvites]);

  function validate() {
    const next: typeof errors = {};
    if (!companyName.trim()) next.companyName = 'Add the factory or company name.';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email, or leave it blank.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleCreate() {
    if (submitting || !validate()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const invitation = await createInvitation({
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim().toLowerCase(),
        notes: notes.trim() || undefined,
        productIds: [],
      });
      setCreated(invitation);
      setCopied(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void loadInvites();
    } catch (error) {
      const rejection = getEntitlementRejection(error);
      if (rejection) {
        Alert.alert(`Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Pro'}`, rejection.message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'View plans', onPress: () => router.push('/subscription' as never) },
        ]);
        return;
      }
      Alert.alert('Invite not created', 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink(link: string) {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function shareLink(invite: ManufacturerInvitation) {
    if (!invite.inviteLink) return;
    try {
      await Share.share({ message: inviteMessage(invite.companyName, invite.inviteLink), url: Platform.OS === 'ios' ? invite.inviteLink : undefined });
    } catch {
      await copyLink(invite.inviteLink);
    }
  }

  function startAnother() {
    setCreated(null);
    setCompanyName(''); setContactName(''); setEmail(''); setNotes('');
  }

  const pendingInvites = (invites ?? []).filter((invite) => invite.status !== 'accepted');
  const joinedInvites = (invites ?? []).filter((invite) => invite.status === 'accepted');

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Back">
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Invite a manufacturer</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl, gap: SP.md }} keyboardShouldPersistTaps="handled">
          {created ? (
            <View style={s.card} testID="invite-created">
              <View style={s.successIcon}><Feather name="check" size={26} color={SUCCESS} /></View>
              <Text style={s.title}>Your private link is ready</Text>
              <Text style={s.body}>Send it to {created.companyName} on WhatsApp, WeChat or email. When they sign up, you'll get a notification and a private conversation opens in Messages.</Text>
              <View style={s.linkBox}>
                <Text style={s.linkText} numberOfLines={2} selectable testID="invite-link">{created.inviteLink}</Text>
              </View>
              <View style={s.row}>
                <TouchableOpacity style={[s.primaryBtn, { backgroundColor: theme.accent }]} onPress={() => void shareLink(created)} testID="invite-share">
                  <Feather name="share" size={16} color={theme.onAccent} />
                  <Text style={[s.primaryText, { color: theme.onAccent }]}>Share link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => created.inviteLink && void copyLink(created.inviteLink)} testID="invite-copy">
                  <Feather name={copied ? 'check' : 'copy'} size={16} color={FG} />
                  <Text style={s.secondaryText}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.fine}>The link works once. Their profile stays private: only you can see and work with them.</Text>
              <SecondaryButton label="Invite another manufacturer" icon="plus" onPress={startAnother} />
            </View>
          ) : (
            <>
              <View style={s.card}>
                <Text style={s.title}>Bring your own factory</Text>
                <Text style={s.body}>Already working with a manufacturer? Send them a private signup link. It's free for them, they won't appear in the public directory, and everything with them — chat, samples, bulk orders and payment — moves into Brandthread.</Text>
                <View style={s.points}>
                  {[
                    ['lock', 'Private: only you can see their profile'],
                    ['message-circle', 'One ongoing conversation for the whole job'],
                    ['credit-card', 'Pay their sample and bulk cards by card or Apple Pay'],
                  ].map(([icon, label]) => (
                    <View key={label} style={s.point}><Feather name={icon as any} size={14} color={FG} /><Text style={s.pointText}>{label}</Text></View>
                  ))}
                </View>
              </View>
              <View style={s.card}>
                <FormInput label="Factory or company name *" value={companyName} onChange={(value: string) => { setCompanyName(value); setErrors((current) => ({ ...current, companyName: undefined })); }} placeholder="e.g. Saigon Knit Co." />
                {errors.companyName ? <Text style={s.error}>{errors.companyName}</Text> : null}
                <FormInput label="Contact name" value={contactName} onChange={setContactName} placeholder="Who you usually talk to" />
                <FormInput label="Email (optional)" value={email} onChange={(value: string) => { setEmail(value); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="production@factory.com" keyboardType="email-address" />
                {errors.email ? <Text style={s.error}>{errors.email}</Text> : null}
                <FormInput label="Note for yourself (optional)" value={notes} onChange={setNotes} placeholder="e.g. Makes our fleece hoodies" multiline />
                <PrimaryButton label={submitting ? 'Creating link…' : 'Create private invite link'} icon="link" onPress={() => void handleCreate()} loading={submitting} disabled={submitting} />
              </View>
            </>
          )}

          <View style={s.card} testID="invite-history">
            <Text style={s.section}>Your invites</Text>
            {invites === null && !invitesError ? (
              <ActivityIndicator color={FG} style={{ marginVertical: SP.md }} />
            ) : invitesError ? (
              <TouchableOpacity onPress={() => void loadInvites()}><Text style={[s.body, { color: ORANGE }]}>Invites couldn't be loaded. Tap to retry.</Text></TouchableOpacity>
            ) : invites!.length === 0 ? (
              <Text style={s.body}>No invites yet. Links you create show up here with their status.</Text>
            ) : (
              [...joinedInvites, ...pendingInvites].map((invite) => (
                <View key={invite.id} style={s.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.inviteName}>{(invite as any).manufacturerName ?? (invite.companyName || 'Unnamed factory')}</Text>
                    <Text style={s.fine}>Created {new Date(invite.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                  </View>
                  {invite.status === 'accepted' ? (
                    <StatusBadge label="Joined" variant="success" small />
                  ) : (
                    <TouchableOpacity onPress={() => void shareLink(invite)} style={s.resend} accessibilityLabel={`Share invite for ${invite.companyName}`}>
                      <Text style={s.resendText}>Share again</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, height: 56, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: SP.sm },
  title: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  fine: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 16 },
  section: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUBTLE, letterSpacing: 1, textTransform: 'uppercase' },
  points: { gap: 8, marginTop: 4 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pointText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  error: { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE, marginTop: -6 },
  successIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(16,185,129,0.14)', alignItems: 'center', justifyContent: 'center' },
  linkBox: { backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.sm + 2 },
  linkText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  row: { flexDirection: 'row', gap: SP.sm },
  primaryBtn: { flex: 2, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: RADIUS.md },
  primaryText: { fontSize: FS.base, fontFamily: FONT.bold },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  secondaryText: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: BORDER },
  inviteName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  resend: { paddingHorizontal: 12, height: 32, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER, justifyContent: 'center' },
  resendText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
});
