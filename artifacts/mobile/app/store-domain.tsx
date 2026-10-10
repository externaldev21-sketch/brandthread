import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/BrandthreadUI';
import { getStorefront, updateDomain } from '@/services/storeService';
import { useApi } from '@/lib/api';
import type { StoreAddress } from '@/lib/storeAddress.types';
import { isBuyerDevPreview as isBuyerPreview, isSellerDevPreview as isSellerPreview } from '@/lib/devPreview';
import { StoreDomain } from '@/services/storeTypes';
import { isSellerSetupOrigin, leaveSetupFlow } from '@/lib/setupNavigation';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';

type MergedDomain = StoreDomain & { dnsToken?: string };

export default function StoreDomainScreen() {
  const { theme } = useAppTheme();
  const dm = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const api = useApi();
  const [domains, setDomains] = useState<MergedDomain[]>([]);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [subdomainInput, setSubdomainInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  // What the server says is actually switched on (BT-307/317/318): nothing is
  // shown as live or verified until it really serves the store.
  const [address, setAddress] = useState<StoreAddress | null>(null);
  const hosting = {
    subdomainsLive: address?.subdomainsLive === true,
    customDomainsLive: address?.customDomainsLive === true,
    cnameTarget: address?.cnameTarget ?? null,
  };

  const leaveSetupDestination = () => {
    // Pop to the exact screen underneath (dashboard / setup checklist / tab);
    // only a cold deep link with no history falls back to the `from` origin.
    leaveSetupFlow(router, params.from);
  };

  const load = useCallback(async () => {
    const storefrontRead = getStorefront();
    // The server's address wins over the copy saved on this device. Never
    // asked for in the signed-out web preview (protected endpoint).
    const addressRequest: Promise<StoreAddress | null> = isSellerPreview() || isBuyerPreview()
      ? Promise.resolve(null)
      : (api as any).store.address().catch(() => null);
    void addressRequest.then(async (a) => {
      if (!a) return;
      await storefrontRead;
      setAddress(a);
      if (a.slug) setSubdomainInput(a.slug);
    });
    const s = await storefrontRead;
    const localDomains = s.domains;

    // Merge: local BT subdomain + real API custom domains
    const btDomain = localDomains.find(d => d.type === 'brandthread');
    if (btDomain) setSubdomainInput(btDomain.subdomain ?? s.settings.storeUrl ?? '');

    try {
      const apiDomains = await (api as any).store.domains() as any[];
      const customFromApi: MergedDomain[] = (apiDomains ?? []).map((d: any) => ({
        id:                 d.id,
        type:               'custom' as const,
        customDomain:       d.domain,
        verificationStatus: d.verified ? 'verified' : 'pending',
        sslStatus:          d.verified ? 'active' : 'pending',
        isPrimary:          false,
        dnsToken:           d.verifyToken,
      }));
      setDomains([...(btDomain ? [btDomain] : []), ...customFromApi]);
      await completeSetupTaskWhen(
        'connect_domain',
        customFromApi.some(domain => domain.verificationStatus === 'verified'),
      );
    } catch {
      setDomains(localDomains);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const btDomain = domains.find(d => d.type === 'brandthread');
  const customDomains = domains.filter(d => d.type === 'custom') as MergedDomain[];

  const handleSaveSubdomain = async () => {
    if (!btDomain) return;
    setSaving(true);
    try {
      // Saved on the server (it was only ever written to this device and
      // marked verified locally, BT-317). Status comes from the server.
      const saved: StoreAddress = await (api as any).store.updateSlug(subdomainInput);
      await updateDomain(btDomain.id, { subdomain: saved.slug ?? subdomainInput });
      await load();
      Alert.alert('Saved', 'Store address updated.');
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectDomain = async () => {
    if (!newDomain.trim()) return;
    try {
      const result = await (api as any).store.addDomain(newDomain.trim());
      await load();
      setNewDomain('');
      setAdding(false);
      const instructions = result?.verificationInstructions ?? `Add a TXT record _brandthread-verify.${newDomain} pointing to your verification token.`;
      Alert.alert('Domain Added', instructions);
    } catch {
      Alert.alert('Error', 'Failed to connect domain. Check your internet connection and try again.');
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    setVerifying(domainId);
    try {
      const verifiedDomain = await (api as any).store.verifyDomain(domainId);
      if (verifiedDomain?.verified !== true) {
        throw new Error('Domain verification is still pending.');
      }
      await completeSetupTaskWhen('connect_domain', verifiedDomain?.verified === true);
      await load();
      // Only the TXT record is checked; the domain serves the store once the
      // CNAME points at our host (BT-318).
      Alert.alert('DNS verified', hosting.cnameTarget
        ? `Point a CNAME for ${verifiedDomain?.domain ?? 'your domain'} to ${hosting.cnameTarget} to finish connecting it.`
        : 'Your TXT record is in place.');
    } catch {
      Alert.alert('Not verified yet', 'DNS changes can take up to 48 hours to propagate. Check your registrar and try again.');
    } finally {
      setVerifying(null);
    }
  };

  const handleRemoveDomain = async (domainId: string, domainName: string) => {
    Alert.alert('Remove Domain?', `Remove ${domainName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await (api as any).store.deleteDomain(domainId);
          } catch { /* best-effort */ }
          await load();
        },
      },
    ]);
  };

  const verificationBadge = (status: StoreDomain['verificationStatus']) => {
    if (status === 'verified') return <StatusBadge label="Verified" variant="success" small />;
    if (status === 'pending') return <StatusBadge label="Pending DNS" variant="warning" small />;
    if (status === 'failed') return <StatusBadge label="Failed" variant="error" small />;
    return <StatusBadge label="Not Started" variant="neutral" small />;
  };

  return (
    <View style={dm.root}>
      <ScreenHeader title="Domains" onBack={leaveSetupDestination} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={dm.scroll}>

        {/* Brandthread Subdomain */}
        <SectionHeader title="BRANDTHREAD SUBDOMAIN" style={dm.sh} />
        {btDomain && (
          <BrandthreadCard style={dm.card}>
            <View style={dm.urlInputRow}>
              <TextInput
                style={[dm.input, { flex: 1 }]}
                value={subdomainInput}
                onChangeText={setSubdomainInput}
                placeholder="yourstore"
                placeholderTextColor={SUBTLE}
                autoCapitalize="none"
              />
              <Text style={dm.urlSuffix}>.brandthread.app</Text>
            </View>
            {hosting.subdomainsLive && subdomainInput ? (
              <Text style={dm.urlPreview}>https://{subdomainInput}.brandthread.app</Text>
            ) : address?.liveUrl ? (
              <Text style={dm.urlPreview}>Store link: {address.liveUrl.replace(/^https:\/\//, '')}</Text>
            ) : null}
            <View style={dm.badgeRow}>
              {hosting.subdomainsLive ? <StatusBadge label="Live" variant="success" small /> : null}
              {btDomain.isPrimary && <StatusBadge label="★ Primary" variant="purple" small />}
            </View>
            <PrimaryButton label={saving ? 'Saving...' : 'Save Subdomain'} onPress={handleSaveSubdomain} loading={saving} small />
          </BrandthreadCard>
        )}

        {/* Custom Domains */}
        {(hosting.customDomainsLive || customDomains.length > 0) && <SectionHeader title="CUSTOM DOMAIN" style={dm.sh} />}
        {customDomains.map(cd => (
          <BrandthreadCard key={cd.id} style={dm.card}>
            <View style={dm.domainRow}>
              <Text style={dm.domainName}>{cd.customDomain}</Text>
              {cd.isPrimary && <StatusBadge label="★ Primary" variant="purple" small />}
            </View>
            <View style={dm.badgeRow}>
              {cd.verificationStatus === 'verified'
                ? <StatusBadge label="DNS verified" variant="neutral" small />
                : verificationBadge(cd.verificationStatus)}
            </View>

            {cd.verificationStatus === 'pending' && (
              <BrandthreadCard style={dm.dnsCard}>
                <Text style={dm.dnsTitle}>Add these DNS records to your registrar:</Text>
                <View style={dm.dnsRow}>
                  <Text style={dm.dnsType}>TXT</Text>
                  <Text style={dm.dnsHost}>_brandthread-verify.{cd.customDomain}</Text>
                </View>
                {cd.dnsToken ? (
                  <View style={dm.dnsRow}>
                    <Text style={[dm.dnsType, { color: CYAN }]}>Value</Text>
                    <Text style={[dm.dnsHost, { color: CYAN, flexWrap: 'wrap', flex: 1 }]}>{cd.dnsToken}</Text>
                  </View>
                ) : null}
                {hosting.cnameTarget ? (
                  <View style={dm.dnsRow}>
                    <Text style={dm.dnsType}>CNAME</Text>
                    <Text style={dm.dnsHost}>{cd.customDomain} → {hosting.cnameTarget}</Text>
                  </View>
                ) : null}
                <Text style={dm.dnsNote}>DNS changes can take up to 48 hours to propagate.</Text>
                <SecondaryButton
                  label={verifying === cd.id ? 'Checking...' : 'Verify DNS'}
                  small
                  accent={SUCCESS}
                  onPress={() => handleVerifyDomain(cd.id)}
                  disabled={verifying === cd.id}
                />
              </BrandthreadCard>
            )}

            {cd.verificationStatus === 'verified' && hosting.customDomainsLive && (
              <BrandthreadCard style={[dm.dnsCard, { borderColor: SUCCESS, backgroundColor: SUCCESS_DIM }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
                  <Feather name="check-circle" size={ICON.sm} color={SUCCESS} />
                  <Text style={{ color: SUCCESS, fontFamily: FONT.semibold, fontSize: FS.sm }}>
                    Domain is live at https://{cd.customDomain}
                  </Text>
                </View>
              </BrandthreadCard>
            )}

            <View style={dm.actionRow}>
              <SecondaryButton
                label="Remove"
                small
                accent={MUTED}
                onPress={() => handleRemoveDomain(cd.id, cd.customDomain ?? '')}
                style={{ flex: 1 }}
              />
            </View>
          </BrandthreadCard>
        ))}

        {hosting.customDomainsLive ? (
        !adding ? (
          <TouchableOpacity style={dm.addDomainBtn} onPress={() => setAdding(true)}>
            <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={dm.addDomainText}>+ Connect Custom Domain</Text>
          </TouchableOpacity>
        ) : (
          <BrandthreadCard style={dm.card}>
            <Text style={dm.fieldLabel}>Custom Domain</Text>
            <TextInput
              style={dm.input}
              value={newDomain}
              onChangeText={setNewDomain}
              placeholder="yourbrand.com"
              placeholderTextColor={SUBTLE}
              autoCapitalize="none"
              keyboardType="url"
              autoFocus
            />
            <Text style={dm.noteText}>
              You'll receive DNS instructions after adding. No domain purchase required — just configure your existing domain registrar.
            </Text>
            <View style={dm.actionRow}>
              <SecondaryButton label="Cancel" small accent={MUTED} onPress={() => { setAdding(false); setNewDomain(''); }} style={{ flex: 1 }} />
              <PrimaryButton label="Add Domain" small onPress={handleConnectDomain} disabled={!newDomain.trim()} style={{ flex: 1 }} />
            </View>
          </BrandthreadCard>
        )
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE_LIGHT = theme.accentLight;
  const CYAN = theme.secondary;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SURFACE = theme.surface;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  sh: { marginTop: SP.lg, marginBottom: SP.sm },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  urlInputRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  urlSuffix: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  urlPreview: { fontSize: FS.sm, fontFamily: FONT.medium, color: CYAN },
  badgeRow: { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  domainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  domainName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  dnsCard: { backgroundColor: SURFACE, gap: SP.sm },
  dnsTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  dnsRow: { flexDirection: 'row', gap: SP.md, alignItems: 'flex-start' },
  dnsType: { fontSize: FS.xs, fontFamily: FONT.bold, color: FG, minWidth: 50, textTransform: 'uppercase' },
  dnsHost: { fontSize: FS.xs, fontFamily: FONT.regular, color: FG },
  dnsNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  actionRow: { flexDirection: 'row', gap: SP.sm },
  addDomainBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    marginHorizontal: SP.md, paddingVertical: SP.md,
    borderWidth: 1, borderColor: PURPLE_LIGHT, borderStyle: 'dashed',
    borderRadius: RADIUS.md, justifyContent: 'center',
  },
  addDomainText: { fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  noteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  });
};
