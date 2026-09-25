import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Header } from '@/components/layout';
import {
  SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/BrandthreadUI';
import { getStorefront, updateDomain } from '@/services/storeService';
import { useApi } from '@/lib/api';
import { StoreDomain } from '@/services/storeTypes';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
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

  const leaveSetupDestination = () => {
    if (isSellerSetupOrigin(params.from)) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  };

  const load = useCallback(async () => {
    const s = await getStorefront();
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
      await updateDomain(btDomain.id, { subdomain: subdomainInput, verificationStatus: 'verified' });
      await load();
      Alert.alert('Saved', 'Subdomain updated.');
    } catch {
      Alert.alert('Error', 'Failed to update subdomain.');
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
      Alert.alert('Verified ✓', 'Your domain is verified and SSL is being issued.');
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
      <Header title="Domains" onBack={leaveSetupDestination} />

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
            {subdomainInput ? (
              <Text style={dm.urlPreview}>https://{subdomainInput}.brandthread.app</Text>
            ) : null}
            <View style={dm.badgeRow}>
              {verificationBadge(btDomain.verificationStatus)}
              {btDomain.isPrimary && <StatusBadge label="★ Primary" variant="purple" small />}
            </View>
            <PrimaryButton label={saving ? 'Saving...' : 'Save Subdomain'} onPress={handleSaveSubdomain} loading={saving} small />
          </BrandthreadCard>
        )}

        {/* Custom Domains */}
        <SectionHeader title="CUSTOM DOMAIN" style={dm.sh} />
        {customDomains.map(cd => (
          <BrandthreadCard key={cd.id} style={dm.card}>
            <View style={dm.domainRow}>
              <Text style={dm.domainName}>{cd.customDomain}</Text>
              {cd.isPrimary && <StatusBadge label="★ Primary" variant="purple" small />}
            </View>
            <View style={dm.badgeRow}>
              {verificationBadge(cd.verificationStatus)}
              <StatusBadge
                label={cd.sslStatus === 'active' ? 'SSL Active' : 'SSL Pending'}
                variant={cd.sslStatus === 'active' ? 'success' : 'warning'}
                small
              />
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
                <View style={dm.dnsRow}>
                  <Text style={dm.dnsType}>CNAME</Text>
                  <Text style={dm.dnsHost}>www → cname.brandthread.app</Text>
                </View>
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

            {cd.verificationStatus === 'verified' && (
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

        {!adding ? (
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
        )}
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
