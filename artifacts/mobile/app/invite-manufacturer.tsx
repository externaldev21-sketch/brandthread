/**
 * Invite Manufacturer Screen
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Animated, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  SUCCESS, BLUE, ORANGE, RED, GOLD, ON_DARK,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  FormInput, SectionHeader,
} from '@/components/BrandthreadUI';

import { createInvitation } from '@/services/manufacturerService';
import { ManufacturerInvitation } from '@/services/manufacturerTypes';
import { getEntitlementRejection } from '@/lib/entitlementError';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InviteManufacturerScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Form fields
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ companyName?: string; email?: string }>({});
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showCopiedToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastVisible(true);
    Animated.timing(toastOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      setToastVisible(false);
    }, 2000);
  }

  function validate(): boolean {
    const errors: { companyName?: string; email?: string } = {};
    if (!companyName.trim()) errors.companyName = 'Company name is required';
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!email.includes('@')) {
      errors.email = 'Enter a valid email address';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const productIds = products
        .split(/[,\n]/)
        .map(p => p.trim())
        .filter(Boolean);

      const invitation = await createInvitation({
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        country: country.trim() || undefined,
        website: website.trim() || undefined,
        notes: notes.trim() || undefined,
        productIds,
      });

      setInviteLink(invitation.inviteLink ?? '');
      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const rejection = getEntitlementRejection(e);
      if (rejection) {
        Alert.alert(
          `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Pro'}`,
          rejection.message,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'View plans', onPress: () => router.push('/subscription' as never) },
          ],
        );
        return;
      }
      Alert.alert('Error', 'Failed to create invitation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyLink() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(inviteLink);
    showCopiedToast();
  }

  async function handleShareLink() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({ message: inviteLink });
    } catch { /* user cancelled the share sheet */ }
  }

  // ── Success state ────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Invite Manufacturer</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          contentContainerStyle={[s.successContainer, { paddingBottom: insets.bottom + SP.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.successIconWrap}>
            <Feather name="check-circle" size={64} color={SUCCESS} />
          </View>
          <Text style={s.successTitle}>Invitation Created!</Text>
          <Text style={s.successDesc}>
            Your invitation for{' '}
            <Text style={{ color: theme.accentLight, fontFamily: FONT.semibold }}>{companyName}</Text>
            {' '}has been created.
          </Text>

          <GradientCard
            colors={[theme.secondaryDim, theme.secondaryDim] as const}
            style={s.linkCard}
          >
            <View style={s.linkCardHeader}>
              <Feather name="link" size={ICON.sm} color={theme.secondary} />
              <Text style={[s.linkCardTitle, { color: theme.secondary }]}>Invitation Link</Text>
            </View>
            <Text style={s.linkText} numberOfLines={2}>{inviteLink}</Text>
            <Text style={s.linkNote}>
              Share this link with {companyName || 'the manufacturer'} so they can join.
            </Text>
          </GradientCard>

          <PrimaryButton
            label="Copy link"
            onPress={handleCopyLink}
            icon="copy"
            style={{ marginTop: SP.sm }}
          />
          <SecondaryButton
            label="Share link"
            onPress={handleShareLink}
            icon="share"
            style={{ marginTop: SP.sm }}
          />
          <SecondaryButton
            label="Done"
            onPress={() => router.back()}
            style={{ marginTop: SP.sm }}
          />
        </ScrollView>

        {/* Copy toast */}
        <Animated.View pointerEvents="none" style={[s.toast, { opacity: toastOpacity }]}>
          <Feather name="check-circle" size={14} color={theme.onAccent} />
          <Text style={s.toastText}>Link copied</Text>
        </Animated.View>
      </View>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Invite Manufacturer</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Demo notice */}
        <GradientCard
          colors={[theme.secondaryDim, theme.secondaryDim] as const}
          style={s.demoNotice}
        >
          <View style={s.demoNoticeRow}>
            <Feather name="info" size={ICON.md} color={theme.secondary} />
            <Text style={[s.demoNoticeTitle, { color: theme.secondary }]}>Invitation link</Text>
          </View>
          <Text style={s.demoNoticeText}>
            Your invitation link will be generated so you can share it directly with the manufacturer via any channel.
          </Text>
        </GradientCard>

        {/* Form */}
        <BrandthreadCard style={s.formCard}>
          <Text style={s.formSection}>Manufacturer details</Text>

          <FormInput
            label="Company / manufacturer name *"
            value={companyName}
            onChange={setCompanyName}
            placeholder="e.g. Apex Apparel Co."
          />
          {fieldErrors.companyName && (
            <Text style={s.errorText}>{fieldErrors.companyName}</Text>
          )}

          <FormInput
            label="Contact name *"
            value={contactName}
            onChange={setContactName}
            placeholder="e.g. Maria Santos"
          />

          <FormInput
            label="Email *"
            value={email}
            onChange={setEmail}
            placeholder="e.g. contact@factory.com"
            keyboardType="email-address"
          />
          {fieldErrors.email && (
            <Text style={s.errorText}>{fieldErrors.email}</Text>
          )}

          <FormInput
            label="Phone"
            value={phone}
            onChange={setPhone}
            placeholder="e.g. +1 555 000 1234"
            keyboardType="default"
          />
        </BrandthreadCard>

        <BrandthreadCard style={s.formCard}>
          <Text style={s.formSection}>Additional information</Text>

          <FormInput
            label="Country"
            value={country}
            onChange={setCountry}
            placeholder="e.g. Portugal"
          />

          <FormInput
            label="Website"
            value={website}
            onChange={setWebsite}
            placeholder="e.g. https://factory.com"
            keyboardType="url"
          />

          <FormInput
            label="Notes"
            value={notes}
            onChange={setNotes}
            placeholder="Any details about this manufacturer, how you found them, etc."
            multiline
          />

          <FormInput
            label="Products to collaborate on"
            value={products}
            onChange={setProducts}
            placeholder="Separate with commas or new lines&#10;e.g. Heavyweight Hoodie, Classic Tee"
            multiline
          />
        </BrandthreadCard>

        <PrimaryButton
          label="Create invite link"
          onPress={handleSubmit}
          loading={submitting}
          icon="link"
          style={s.submitBtn}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    minHeight: COMP.headerH,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.md, fontFamily: FONT.bold, color: FG,
  },
  content: {
    padding: SP.md, gap: SP.md,
  },
  demoNotice: {
    gap: SP.sm, padding: SP.md,
  },
  demoNoticeRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  demoNoticeTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold,
  },
  demoNoticeText: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20,
  },
  formCard: {
    gap: SP.md,
  },
  formSection: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  errorText: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: RED,
    marginTop: -SP.xs,
  },
  submitBtn: {
    marginTop: SP.sm,
  },
  // Success state
  successContainer: {
    padding: SP.md, gap: SP.md, alignItems: 'center',
  },
  successIconWrap: {
    marginTop: SP.xl,
    marginBottom: SP.sm,
  },
  successTitle: {
    fontSize: FS.xxl, fontFamily: FONT.bold, color: FG, textAlign: 'center',
  },
  successDesc: {
    fontSize: FS.base, fontFamily: FONT.regular, color: MUTED,
    textAlign: 'center', lineHeight: 22,
  },
  linkCard: {
    width: '100%', gap: SP.sm, padding: SP.md,
  },
  linkCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  linkCardTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold,
  },
  linkText: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: BORDER,
    padding: SP.sm,
  },
  linkNote: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18,
  },
  toast: {
    position: 'absolute', top: 56, alignSelf: 'center', zIndex: 99,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SUCCESS, borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  toastText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: ON_DARK },
});
