import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/hooks/useApi';
import { BrandthreadHeader, BrandthreadScreen, PrimaryButton, SecondaryButton, PressableScale } from '@/components/BrandthreadUI';
import { BG, BORDER, CARD, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, SUCCESS } from '@/lib/theme';

type StoredCase = { listingId: string; caseReference: string; statusToken: string; status: string; submittedAt: string };
const CASES_KEY = 'bt:ip-cases:v1';
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function IpReportScreen() {
  const router = useRouter();
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  const api = useApi();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [rightsType, setRightsType] = useState<'copyright' | 'trademark' | 'counterfeit' | null>(null);
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cases, setCases] = useState<StoredCase[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(CASES_KEY).then(raw => setCases(raw ? JSON.parse(raw) : [])).catch(() => {}); }, []);
  const submit = async () => {
    const evidenceUrls = evidence.split(/\n|,/).map(v => v.trim()).filter(Boolean);
    if (!listingId || !name.trim() || !emailValid(email.trim()) || !rightsType || description.trim().length < 20) {
      Alert.alert('Review your report', 'Select the type of rights, enter your name, a valid email, and at least 20 characters describing your claim.');
      return;
    }
    if (evidenceUrls.some(url => !/^https?:\/\//i.test(url))) {
      Alert.alert('Evidence links', 'Each evidence URL must begin with http:// or https://.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.ipCases.create({ listingProductId: listingId, claimantName: name.trim(), claimantEmail: email.trim(), rightsType, description: description.trim(), evidenceReferences: evidenceUrls });
      const record: StoredCase = { listingId, ...result, submittedAt: new Date().toISOString() };
      const next = [record, ...cases.filter(item => item.caseReference !== record.caseReference)];
      setCases(next);
      await AsyncStorage.setItem(CASES_KEY, JSON.stringify(next));
      Alert.alert('Report submitted', `Your case reference is ${result.caseReference}. Keep it for status updates.`);
    } catch (error: any) {
      Alert.alert('Could not submit report', error?.message ?? 'Please try again.');
    } finally { setSubmitting(false); }
  };
  const refreshStatus = async (item: StoredCase) => {
    setChecking(item.caseReference);
    try {
      const result = await api.ipCases.status(item.caseReference, item.statusToken);
      const next = cases.map(row => row.caseReference === item.caseReference ? { ...row, status: result.status } : row);
      setCases(next); await AsyncStorage.setItem(CASES_KEY, JSON.stringify(next));
    } catch { Alert.alert('Unable to check status', 'Please try again later.'); }
    finally { setChecking(null); }
  };
  return <BrandthreadScreen>
    <BrandthreadHeader title="Report IP infringement" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.legal}>Only a rights holder or an authorized agent may submit this report. By submitting, you certify that you are authorized to act, that the information is accurate, and that you have a good-faith belief the reported listing infringes your copyright, trademark, or other rights. Include the listing, the rights you own or represent, and supporting evidence. Brandthread may request more information, notify the seller, restrict or remove content, or close the case without action. Knowingly false or misleading reports may lead to account action. Questions about an IP case can be sent to support@brandthread.app.</Text>
      <Text style={s.label}>Your full name</Text><TextInput value={name} onChangeText={setName} style={s.input} placeholder="Rights holder or authorized agent" placeholderTextColor={SUBTLE} />
      <Text style={s.label}>Contact email</Text><TextInput value={email} onChangeText={setEmail} style={s.input} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={SUBTLE} />
      <Text style={s.label}>Type of report</Text>
      <View style={s.rights}>{(['copyright', 'trademark', 'counterfeit'] as const).map(type => <PressableScale key={type} onPress={() => setRightsType(type)} style={[s.right, rightsType === type && s.rightSelected]}><Text style={[s.rightText, rightsType === type && s.rightTextSelected]}>{type[0].toUpperCase() + type.slice(1)}</Text></PressableScale>)}</View>
      <Text style={s.label}>Describe your rights</Text><TextInput value={description} onChangeText={setDescription} style={[s.input, s.area]} multiline placeholder="Copyright, trademark, or other rights and why this listing infringes them." placeholderTextColor={SUBTLE} />
      <Text style={s.label}>Evidence URLs (optional)</Text><TextInput value={evidence} onChangeText={setEvidence} style={[s.input, s.area]} multiline autoCapitalize="none" placeholder="One public URL per line" placeholderTextColor={SUBTLE} />
      <PrimaryButton label="Submit report" onPress={submit} loading={submitting} />
      {cases.length > 0 && <View style={s.cases}><Text style={s.title}>Submitted cases</Text>{cases.map(item => <View key={item.caseReference} style={s.case}><View style={{ flex: 1 }}><Text style={s.ref}>{item.caseReference}</Text><Text style={s.status}>Status: {item.status}</Text></View><PressableScale onPress={() => refreshStatus(item)}><Feather name="refresh-cw" size={18} color={SUCCESS} /></PressableScale></View>)}</View>}
    </ScrollView>
  </BrandthreadScreen>;
}
const s = StyleSheet.create({ content:{padding:SP.md,gap:SP.sm,paddingBottom:SP.xl}, legal:{color:MUTED,fontFamily:FONT.regular,fontSize:FS.xs,lineHeight:18,backgroundColor:CARD,borderRadius:RADIUS.sm,padding:SP.sm,marginBottom:SP.sm}, label:{color:FG,fontFamily:FONT.semibold,fontSize:FS.sm,marginTop:SP.xs}, input:{color:FG,fontFamily:FONT.regular,fontSize:FS.base,borderWidth:1,borderColor:BORDER,borderRadius:RADIUS.sm,backgroundColor:CARD,padding:SP.sm,minHeight:46}, area:{height:100,textAlignVertical:'top'}, rights:{flexDirection:'row',gap:SP.xs,flexWrap:'wrap'},right:{borderWidth:1,borderColor:BORDER,borderRadius:RADIUS.pill,paddingHorizontal:SP.sm,paddingVertical:7,backgroundColor:CARD},rightSelected:{borderColor:SUCCESS},rightText:{color:MUTED,fontFamily:FONT.medium,fontSize:FS.xs},rightTextSelected:{color:SUCCESS},cases:{marginTop:SP.lg,gap:SP.sm}, title:{color:FG,fontFamily:FONT.bold,fontSize:FS.lg}, case:{flexDirection:'row',alignItems:'center',backgroundColor:CARD,borderRadius:RADIUS.sm,padding:SP.sm,borderWidth:1,borderColor:BORDER}, ref:{color:FG,fontFamily:FONT.semibold},status:{color:MUTED,fontFamily:FONT.regular,fontSize:FS.xs,marginTop:3} });