import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/BrandthreadUI';
import { getStorefront, updateDomain, addCustomDomain } from '@/services/storeService';
import { Storefront, StoreDomain } from '@/services/storeTypes';

export default function StoreDomainScreen() {
  const router = useRouter();
  const [store, setStore] = useState<Storefront | null>(null);
  const [domains, setDomains] = useState<StoreDomain[]>([]);
  const [adding, setAdding] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [subdomainInput, setSubdomainInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const s = await getStorefront();
    setStore(s);
    setDomains(s.domains);
    const btDomain = s.domains.find(d => d.type === 'brandthread');
    if (btDomain) setSubdomainInput(btDomain.subdomain ?? s.settings.storeUrl ?? '');
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const btDomain = domains.find(d => d.type === 'brandthread');
  const customDomains = domains.filter(d => d.type === 'custom');

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
      await addCustomDomain(newDomain.trim());
      await load();
      setNewDomain('');
    } catch {
      Alert.alert('Error', 'Failed to connect domain.');
    }
  };

  const handleSimulateVerify = async (domainId: string) => {
    await updateDomain(domainId, { verificationStatus: 'verified', sslStatus: 'active' });
    await load();
    Alert.alert('Verified', 'Domain verified and SSL active (simulated).');
  };

  const handleSetPrimary = async (domainId: string) => {
    for (const d of domains) {
      await updateDomain(d.id, { isPrimary: d.id === domainId });
    }
    await load();
  };

  const verificationBadge = (status: StoreDomain['verificationStatus']) => {
    if (status === 'verified') return <StatusBadge label="Verified" variant="success" small />;
    if (status === 'pending') return <StatusBadge label="Pending" variant="warning" small />;
    if (status === 'failed') return <StatusBadge label="Failed" variant="error" small />;
    return <StatusBadge label="Not Started" variant="neutral" small />;
  };

  return (
    <View style={dm.root}>
      <View style={dm.header}>
        <TouchableOpacity onPress={() => router.back()} style={dm.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={dm.headerTitle}>Domains</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={dm.scroll}>

        {/* Demo Notice */}
        <BrandthreadCard style={[dm.card, { borderColor: CYAN }]}>
          <View style={dm.bannerRow}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={[dm.bannerText, { color: CYAN }]}>
              Domain connection is in development preview. Brandthread subdomain is active immediately. Custom domain DNS verification is simulated.
            </Text>
          </View>
        </BrandthreadCard>

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
              <Text style={dm.urlSuffix}>.brandthread.co</Text>
            </View>
            {subdomainInput ? (
              <Text style={dm.urlPreview}>https://{subdomainInput}.brandthread.co</Text>
            ) : null}
            <View style={dm.badgeRow}>
              {verificationBadge(btDomain.verificationStatus)}
              {btDomain.isPrimary && <StatusBadge label="★ Primary" variant="purple" small />}
            </View>
            <PrimaryButton label={saving ? 'Saving...' : 'Save Subdomain'} onPress={handleSaveSubdomain} loading={saving} small />
          </BrandthreadCard>
        )}

        {/* Custom Domain */}
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
                <Text style={dm.dnsTitle}>Add these DNS records to your domain registrar:</Text>
                <View style={dm.dnsRow}>
                  <Text style={dm.dnsCell}>A</Text>
                  <Text style={dm.dnsCell}>@</Text>
                  <Text style={[dm.dnsCell, { color: CYAN }]}>76.76.21.21</Text>
                </View>
                <View style={dm.dnsRow}>
                  <Text style={dm.dnsCell}>CNAME</Text>
                  <Text style={dm.dnsCell}>www</Text>
                  <Text style={[dm.dnsCell, { color: CYAN }]}>cname.brandthread.co</Text>
                </View>
                <Text style={dm.dnsNote}>Verification may take up to 48 hours. (Demo: verification is simulated)</Text>
                <SecondaryButton
                  label="Simulate Verify"
                  small
                  accent={SUCCESS}
                  onPress={() => handleSimulateVerify(cd.id)}
                />
              </BrandthreadCard>
            )}

            <View style={dm.actionRow}>
              <SecondaryButton label="Remove" small accent={MUTED} onPress={() => Alert.alert('Remove', 'Remove domain coming soon.')} style={{ flex: 1 }} />
              {!cd.isPrimary && (
                <SecondaryButton label="Set Primary" small onPress={() => handleSetPrimary(cd.id)} style={{ flex: 1 }} />
              )}
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
            />
            <Text style={dm.noteText}>Point your domain's A record to 76.76.21.21 before connecting.</Text>
            <View style={dm.actionRow}>
              <SecondaryButton label="Cancel" small accent={MUTED} onPress={() => { setAdding(false); setNewDomain(''); }} style={{ flex: 1 }} />
              <PrimaryButton label="Connect Domain" small onPress={handleConnectDomain} style={{ flex: 1 }} />
            </View>
          </BrandthreadCard>
        )}

        {/* All domains — set primary */}
        {domains.length > 1 && (
          <>
            <SectionHeader title="PRIMARY DOMAIN" style={dm.sh} />
            {domains.map(d => (
              <BrandthreadCard key={d.id} style={[dm.card, { flexDirection: 'row', alignItems: 'center', gap: SP.md }]}>
                <Text style={[dm.domainName, { flex: 1 }]}>
                  {d.type === 'brandthread' ? `${d.subdomain}.brandthread.co` : d.customDomain}
                </Text>
                {d.isPrimary
                  ? <StatusBadge label="★ Primary" variant="purple" small />
                  : <SecondaryButton label="Set Primary" small onPress={() => handleSetPrimary(d.id)} />
                }
              </BrandthreadCard>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const dm = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  sh: { marginTop: SP.lg, marginBottom: SP.sm },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
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
  dnsRow: { flexDirection: 'row', gap: SP.md },
  dnsCell: { fontSize: FS.xs, fontFamily: FONT.regular, color: FG, minWidth: 60 },
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
