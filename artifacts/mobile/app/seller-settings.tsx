/**
 * Seller Settings Hub — its own screen, separate from Buyer Settings.
 *
 * Rebuilt 1:1 on Instagram's "Settings and activity" screen (Mobbin:
 * https://mobbin.com/flows/7e2af19b-f042-4697-a0f8-6eaf8f3b6a15), reskinned
 * in Brandthread's black/white/silver palette: a real search field, a flat
 * (unboxed) grouped list with sentence-case section headers, single-line
 * rows with no per-row subtitle, and an account row that opens straight
 * into Edit profile. This intentionally does NOT touch
 * components/settings/SettingsKit.tsx (shared with app/buyer-settings.tsx)
 * — the rebuild lives entirely in this file's own local components so the
 * buyer settings screen is unaffected.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { previewSellerBrandName } from '@/lib/previewIdentity';
import { isSellerDevPreview } from '@/lib/devPreview';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { getInitials } from '@/lib/format';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { useApi } from '@/hooks/useApi';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { SELLER_SETTINGS_CATALOG, SettingsCatalogItem } from '@/services/settingsCatalog';
import { ConfirmSheet } from '@/components/settings/SettingsKit';
import { PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import StripeConnectWarning from '@/components/StripeConnectWarning';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { WEB_INPUT_RESET } from '@/lib/inputReset';

export default function SellerSettingsScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const api = useApi();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();

  const [query, setQuery] = useState('');
  const [isModerator, setIsModerator] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [scopeVisible, setScopeVisible] = useState(false);
  const [accountScope, setAccountScope] = useState<'global' | 'us' | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState<'global' | 'us' | null>(null);
  const [scopeSaveError, setScopeSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isSellerDevPreview()) {
      setIsModerator(false);
      return;
    }
    let active = true;
    api.moderation.me()
      .then((result) => { if (active) setIsModerator(result.isModerator); })
      .catch(() => { if (active) setIsModerator(false); });
    return () => { active = false; };
  }, [api]);

  const profileName = previewSellerBrandName() ?? (user?.fullName || user?.username || 'Your Brandthread store');
  // Initials are derived from the exact same `profileName` string shown next
  // to the avatar (not a separate first/last-name pair that may be blank),
  // so the avatar and the name text can never disagree.
  const profileInitials = getInitials(profileName, 'BT');
  const tabBarInset = useTabBarMetrics(2).occupiedHeight;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = SELLER_SETTINGS_CATALOG
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.requiresModerator || isModerator) }))
      .filter((group) => group.items.length > 0);
    if (!q) return visible;
    return visible
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.description} ${item.aliases.join(' ')}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [query, isModerator]);

  async function openAccountScope() {
    setScopeVisible(true);
    setScopeLoading(true);
    setAccountScope(null);
    setScopeSaveError(null);
    try {
      const data = await api.seller.getSettings();
      setAccountScope(data.settings?.accountScope === 'us' ? 'us' : 'global');
    } catch {
      // Leave both choices unselected; saving one still requires a successful request.
    } finally {
      setScopeLoading(false);
    }
  }

  async function chooseAccountScope(nextScope: 'global' | 'us') {
    if (scopeLoading || scopeSaving) return;
    if (nextScope === accountScope) { setScopeVisible(false); return; }
    hapticLight();
    setScopeSaving(nextScope);
    setScopeSaveError(null);
    try {
      await api.seller.updateSettings({ accountScope: nextScope });
      setAccountScope(nextScope);
      setScopeVisible(false);
    } catch {
      setScopeSaveError('Your choice was not saved. Check your connection.');
    } finally {
      setScopeSaving(null);
    }
  }

  async function handleItem(item: SettingsCatalogItem) {
    hapticLight();
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      item.requiresGrowth &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(item.label);
      return;
    }
    if (item.action === 'sign-out') { setSignOutVisible(true); return; }
    if (item.action === 'delete-account') { router.push('/delete-account' as never); return; }
    if (item.action === 'account-scope') { await openAccountScope(); return; }
    if (item.route) router.push(item.route as never);
  }

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      hapticSuccess();
      router.replace('/sign-in' as never);
    } finally {
      setSigningOut(false);
      setSignOutVisible(false);
    }
  }

  return (
    <View style={s.page}>
      <ScreenHeader
        title="Settings"
        variant="modal"
        onBack={() => { hapticLight(); goBackOr(router); }}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: tabBarInset + SP.xl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <AccountRow
          name={profileName}
          initials={profileInitials}
          onPress={() => router.push('/edit-profile' as never)}
        />

        <SearchField value={query} onChangeText={setQuery} />

        <View style={{ marginBottom: 18 }}>
          <StripeConnectWarning />
        </View>

        {groups.map((group) => (
          <SettingsGroup key={group.title} title={group.title}>
            {group.items.map((item, i) => (
              <SettingsRow
                key={item.label}
                icon={item.icon}
                label={item.label}
                testID={item.action === 'account-scope' ? 'account-reach' : undefined}
                destructive={item.destructive}
                soon={item.soon}
                badge={item.requiresGrowth && GROWTH_PLAN_ENFORCEMENT_ENABLED && !planLoading && !hasPlan('growth') ? 'Growth' : item.route === '/ai-credits' && !planLoading && !planError && hasPlan('pro') ? 'Unlimited' : undefined}
                last={i === group.items.length - 1}
                onPress={() => handleItem(item)}
              />
            ))}
          </SettingsGroup>
        ))}

        <Text style={s.version}>Brandthread v1.0.0</Text>
      </ScrollView>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => { setUpsellFeature(null); router.push('/subscription' as never); }}
      />

      <ConfirmSheet
        visible={signOutVisible}
        title="Sign out?"
        message="You can sign back in to this Brandthread account anytime."
        confirmLabel="Sign out"
        loading={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutVisible(false)}
      />

      <AccountScopeSheet
        visible={scopeVisible}
        loading={scopeLoading}
        saving={scopeSaving}
        saveError={scopeSaveError}
        value={accountScope}
        onChoose={chooseAccountScope}
        onClose={() => { if (!scopeSaving) setScopeVisible(false); }}
      />
    </View>
  );
}

// ─── Account row ────────────────────────────────────────────────────────────
// Avatar + store name (bold, allowed to wrap rather than truncate) + a fixed
// "Seller account" line underneath, the whole row opening Edit profile — no
// separate Edit pill.

function AccountRow({ name, initials, onPress }: { name: string; initials: string; onPress: () => void }) {
  const colors = useColors();
  const s = useMemo(() => makeListStyles(colors), [colors]);
  return (
    <PressableScale style={s.accountRow} onPress={() => { hapticLight(); onPress(); }} accessibilityRole="button" accessibilityLabel="Edit profile">
      <View style={[s.accountAvatar, { backgroundColor: colors.primary }]}>
        <Text style={[s.accountAvatarText, { color: colors.primaryForeground }]}>{initials}</Text>
      </View>
      <View style={s.accountCopy}>
        <Text style={s.accountName}>{name}</Text>
        <Text style={s.accountEyebrow}>Seller account</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

// ─── Search ─────────────────────────────────────────────────────────────────
// A real field: black fill, thin silver outline, silver placeholder — not
// the borderless grey-pill "looks like plain text" search row this replaces.

function SearchField({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const colors = useColors();
  const s = useMemo(() => makeListStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.searchField, { borderColor: focused ? colors.mutedForeground : colors.border }]}>
      <Icon name="search" size={16} color={colors.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search"
        placeholderTextColor={colors.mutedForeground}
        style={[s.searchInput, WEB_INPUT_RESET]}
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="x-circle" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Group / row ────────────────────────────────────────────────────────────
// Flat, unboxed list — sentence-case silver section headers, generous gap
// between sections, hairline dividers only between rows inside a group (not
// a bordered card around it).

function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const colors = useColors();
  const s = useMemo(() => makeListStyles(colors), [colors]);
  return (
    <View style={s.group}>
      {title ? <Text style={s.groupTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

interface SettingsRowProps {
  icon: IconName;
  label: string;
  testID?: string;
  onPress?: () => void;
  destructive?: boolean;
  soon?: boolean;
  badge?: string;
  last?: boolean;
}

function SettingsRow({ icon, label, testID, onPress, destructive, soon, badge, last }: SettingsRowProps) {
  const colors = useColors();
  const s = useMemo(() => makeListStyles(colors), [colors]);
  const inert = !!soon;
  const labelColor = destructive ? colors.destructive : inert ? colors.mutedForeground : colors.foreground;
  const iconTint = inert ? colors.mutedForeground : destructive ? colors.destructive : colors.foreground;

  const content = (
    <View style={[s.row, !last && s.rowDivider]}>
      <Icon name={icon} size={22} color={iconTint} style={s.rowIcon} />
      <Text style={[s.rowLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
      {badge ? (
        <View style={s.rowBadge}>
          <Text style={s.rowBadgeText}>{badge}</Text>
        </View>
      ) : null}
      {soon ? (
        <View style={s.rowSoonBadge}>
          <Text style={s.rowSoonBadgeText}>Soon</Text>
        </View>
      ) : null}
      {onPress && !inert ? <Icon name="chevron-right" size={17} color={colors.mutedForeground} /> : null}
    </View>
  );

  if (!onPress || inert) return <View>{content}</View>;

  return (
    <TouchableOpacity testID={testID} activeOpacity={0.65} onPress={() => { hapticLight(); onPress(); }} accessibilityRole="button" accessibilityLabel={label}>
      {content}
    </TouchableOpacity>
  );
}

function AccountScopeSheet({
  visible, loading, saving, saveError, value, onChoose, onClose,
}: {
  visible: boolean;
  loading: boolean;
  saving: 'global' | 'us' | null;
  saveError: string | null;
  value: 'global' | 'us' | null;
  onChoose: (v: 'global' | 'us') => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const s = useMemo(() => makeScopeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close account reach options" />
        <View style={[s.card, { paddingBottom: insets.bottom + 32 }]}>
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Account reach</Text>
              <Text style={s.subtitle}>Choose where your seller account is available.</Text>
            </View>
            <TouchableOpacity style={s.close} onPress={onClose} disabled={!!saving} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          {loading ? (
            <View style={{ minHeight: 150, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={{ gap: 10 }} accessibilityRole="radiogroup">
                {([
                  { value: 'global' as const, label: 'Global account', description: 'Make your account available worldwide.', icon: 'globe' as const },
                  { value: 'us' as const, label: 'United States only', description: 'Limit your account to the United States.', icon: 'map-pin' as const },
                ]).map((option) => {
                  const selected = value === option.value;
                  const isSaving = saving === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      testID={`account-reach-${option.value}`}
                      activeOpacity={0.75}
                      disabled={!!saving}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: !!saving }}
                      onPress={() => onChoose(option.value)}
                      style={[s.option, { borderColor: selected ? colors.primary : colors.border }, selected && { backgroundColor: colors.secondary }]}
                    >
                      <View style={s.optionIcon}>
                        <Icon name={option.icon} size={18} color={colors.foreground} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.optionTitle}>{option.label}</Text>
                        <Text style={s.optionDescription}>{option.description}</Text>
                      </View>
                      {isSaving ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Icon name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? colors.primary : colors.mutedForeground} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {saveError && <Text accessibilityRole="alert" style={s.saveNotice}>{saveError}</Text>}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    version: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },
  });
}

function makeListStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    // Account row
    accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 18 },
    accountAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    accountAvatarText: { fontSize: 18, fontFamily: FONT.bold },
    accountCopy: { flex: 1, minWidth: 0 },
    accountName: { fontSize: 17, fontFamily: FONT.bold, color: colors.foreground },
    accountEyebrow: { fontSize: 13, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },

    // Search field — a real field, not a borderless pill.
    searchField: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      height: 40, borderRadius: RADIUS.md, borderWidth: 1,
      backgroundColor: colors.background, paddingHorizontal: 12, marginBottom: 20,
    },
    searchInput: { flex: 1, height: '100%', fontSize: FS.sm, fontFamily: FONT.regular, color: colors.foreground },

    // Group / section header
    group: { marginBottom: 28 },
    groupTitle: { fontSize: 13, fontFamily: FONT.semibold, color: colors.mutedForeground, marginBottom: 4, marginLeft: 2 },

    // Row — flat, unboxed, single line
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingVertical: 8 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowIcon: { width: 22, flexShrink: 0 },
    rowLabel: { flex: 1, minWidth: 0, fontSize: 16, fontFamily: FONT.regular },
    rowBadge: { backgroundColor: colors.destructive, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 2, minWidth: 18, alignItems: 'center' },
    rowBadgeText: { fontSize: 11, lineHeight: 13, fontFamily: FONT.bold, color: colors.text },
    rowSoonBadge: { borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.border },
    rowSoonBadgeText: { fontSize: 11, lineHeight: 13, fontFamily: FONT.semibold, color: colors.mutedForeground, letterSpacing: 0.3 },
  });
}

function makeScopeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: (colors as any).overlay ?? 'rgba(0,0,0,0.68)' },
    card: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 18 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 18 },
    title: { fontSize: 20, fontFamily: FONT.bold, color: colors.foreground },
    subtitle: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 4 },
    saveNotice: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center' },
    close: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    option: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
    optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
    optionTitle: { fontSize: 15, fontFamily: FONT.semibold, color: colors.foreground },
    optionDescription: { fontSize: 12, lineHeight: 17, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  });
}
