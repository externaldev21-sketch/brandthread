/**
 * Buyer and seller profiles of one login.
 *
 * Opened from Settings: "Start selling" (buyer) and "Shop as a buyer"
 * (seller). One login holds at most one buyer profile and one seller
 * profile; the other one is created under the same login (no new email or
 * password) and opens straight into onboarding after the account step.
 * Each profile keeps its own @username, followers, posts, store and messages.
 *
 * Reference: Instagram Accounts Center → Profiles (a plain list of your
 * profiles, then one "add" row), reskinned per BRANDTHREAD_DESIGN.md.
 * Replaces the old flip-your-role cards, which merged a buyer and a brand into
 * one public account.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, Icon, ListRow, SectionHeader } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';
import { useLinkedProfiles } from '@/hooks/useLinkedProfiles';
import { useRole } from '@/contexts/RoleContext';
import { SP, TEXT } from '@/lib/theme';
import {
  addProfileLabel, otherRole, roleExistsMessage, type ProfileRole,
} from '@/lib/linkedProfiles';

function roleLabel(role: ProfileRole | null): string {
  return role === 'seller' ? 'Seller' : role === 'buyer' ? 'Buyer' : '';
}

export default function AccountProfilesScreen() {
  const colors = useColors();
  const router = useRouter();
  const bottomInset = useScreenBottomInset();
  const { isSignedIn } = useAuth();
  const { role: localRole } = useRole();
  const params = useLocalSearchParams<{ add?: string; handoff?: string }>();
  // Arrived here because this profile was deleted while the login's other
  // profile lives on: just pick the profile to continue with.
  const handoff = params.handoff === '1';
  const { data, loading, busy, preview, switchTo, startProfile } = useLinkedProfiles();

  const current = data?.profiles.find((p) => p.isCurrent) ?? null;
  const currentRole: ProfileRole = current?.role ?? (localRole === 'seller' ? 'seller' : 'buyer');
  const wanted: ProfileRole = params.add === 'seller' || params.add === 'buyer' ? params.add : otherRole(currentRole);
  const holder = data?.profiles.find((p) => p.role === wanted && !p.isCurrent) ?? null;
  const canAdd = data ? data.canAdd[wanted] && current?.role !== wanted : false;
  const title = handoff ? 'Profiles' : addProfileLabel(wanted);

  async function handleStart() {
    const outcome = await startProfile(wanted);
    if (outcome.kind === 'exists') {
      Alert.alert(roleExistsMessage(wanted), undefined, [
        { text: 'Cancel', style: 'cancel' },
        ...(outcome.profileClerkId
          ? [{ text: 'Switch to it', onPress: () => { void switchTo(outcome.profileClerkId!); } }]
          : []),
      ]);
    } else if (outcome.kind === 'finish-setup') {
      Alert.alert('Finish setting up this account first.');
    } else if (outcome.kind === 'error' && outcome.message) {
      Alert.alert(outcome.message);
    }
  }

  async function handleSwitch(clerkId: string) {
    try {
      await switchTo(clerkId);
    } catch {
      Alert.alert("Couldn't switch accounts. Try again.");
    }
  }

  const s = styles(colors);

  return (
    <View style={s.root}>
      <ScreenHeader title={title} onBack={() => goBackOr(router, '/buyer-settings-menu')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: bottomInset + SP.xl }}>
        {handoff ? (
          <View style={s.block}>
            <Text style={s.headline}>This profile was deleted.</Text>
            <Text style={s.body}>Your other profile on this login still works.</Text>
          </View>
        ) : holder ? (
          <View style={s.block}>
            <Text style={s.headline}>{roleExistsMessage(wanted)}</Text>
            <Button
              label="Switch to it"
              onPress={() => handleSwitch(holder.clerkId)}
              loading={busy === holder.clerkId}
              disabled={!!busy}
              fullWidth
              testID="profiles-switch-to-existing"
            />
          </View>
        ) : canAdd ? (
          <View style={s.block}>
            <Text style={s.headline}>{wanted === 'seller' ? 'Open a store on this login.' : 'Shop with this login.'}</Text>
            <Text style={s.body}>
              No new email or password. Your {wanted === 'seller' ? 'store' : 'buyer profile'} gets its own @username, followers, posts and messages, separate from @{current?.username ?? 'you'}.
            </Text>
            <Button
              label={title}
              onPress={handleStart}
              loading={busy === `new:${wanted}`}
              disabled={!!busy}
              fullWidth
              testID="profiles-start"
            />
          </View>
        ) : null}

        {data && data.profiles.length > 0 ? (
          <>
            <SectionHeader title="Profiles on this login" />
            {data.profiles.map((profile, index) => (
              <ListRow
                key={profile.clerkId}
                avatar={{ uri: profile.avatarUrl, name: profile.displayName ?? profile.username ?? '' }}
                title={profile.username ? `@${profile.username}` : (profile.displayName ?? roleLabel(profile.role))}
                subtitle={roleLabel(profile.role)}
                divider={index < data.profiles.length - 1}
                disabled={!!busy}
                onPress={profile.isCurrent ? undefined : () => handleSwitch(profile.clerkId)}
                right={profile.isCurrent
                  ? <Icon name="check" size={20} color={colors.foreground} />
                  : undefined}
                chevron={!profile.isCurrent}
                testID={`profiles-row-${profile.clerkId}`}
              />
            ))}
          </>
        ) : null}

        {(!isSignedIn && !preview) || (!loading && !data) ? null : (
          <Text style={s.footnote}>
            To delete one profile, use Delete account while on it. The other profile keeps working. Delete login removes both.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    block: { gap: SP.md, marginBottom: SP.xl },
    headline: { ...TEXT.title2, color: colors.foreground },
    body: { ...TEXT.body, color: colors.mutedForeground },
    footnote: { ...TEXT.footnote, color: colors.mutedForeground, marginTop: SP.lg },
  });
}
