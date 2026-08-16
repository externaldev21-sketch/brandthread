import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, Linking, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/clerk-expo';

const BG     = '#07070F';
const CARD   = '#12121F';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';
const GREEN  = '#8B5CF6';

const FAQS = [
  { q: 'How do drops work?', a: 'Drops are limited-time releases from brands you follow. When a drop goes live you get a notification. Tap the drop to view it and place your order before it sells out. Pre-orders are charged immediately and shipped when production is complete.' },
  { q: 'When does my payment get charged?', a: 'For in-stock items your card is charged at checkout. For pre-order drops your card is charged immediately, but the brand only receives funds once your order ships — we hold the money in escrow to protect you.' },
  { q: 'How do I track my order?', a: 'Go to your Profile → My Orders and tap any order to see its tracking number and live delivery status.' },
  { q: 'Can I return or exchange an item?', a: 'Returns and exchanges are handled per-brand. Tap "Get Help" or "Return / Exchange" on any delivered order in My Orders to start the process with that brand.' },
  { q: 'How do I follow a brand?', a: 'Tap a brand\'s name anywhere in the app to view their profile, then tap "Follow". You\'ll see their drops in your Feed.' },
  { q: 'What is escrow protection?', a: 'Escrow protection means your payment is held by Brandthread and only released to the brand after your order ships. If something goes wrong before shipping you can get a full refund.' },
  { q: 'How do I delete my account?', a: 'Go to Settings → Account → Delete Account. This is permanent and removes all your data. Your order history is retained for legal/tax purposes for 90 days.' },
];

const CATEGORIES = ['General', 'Billing', 'Account', 'Bug', 'Feature'] as const;

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();

  const [query, setQuery]     = useState('');
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Ticket form state
  const [subject, setSubject]       = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [category, setCategory]     = useState<string>('General');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  async function handleSubmitTicket() {
    if (!subject.trim() || !ticketBody.trim()) {
      Alert.alert('Missing info', 'Please fill in the subject and message before sending.');
      return;
    }
    setSubmitting(true);
    try {
      const email = user?.primaryEmailAddress?.emailAddress ?? 'unknown@brandthread.app';
      const name  = user?.fullName ?? user?.firstName ?? 'Brandthread User';
      await api.support.submitTicket({
        subject: subject.trim(),
        body:    ticketBody.trim(),
        category: category.toLowerCase(),
        email,
        name,
      });
      setSubmitted(true);
      setSubject('');
      setTicketBody('');
    } catch {
      Alert.alert('Error', 'Could not send your message. Please try again or email us directly.');
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = FAQS.filter((f) =>
    !query.trim() || f.q.toLowerCase().includes(query.toLowerCase()) || f.a.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={[s.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Help & Support</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Search */}
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={MUTED} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search help articles…"
            placeholderTextColor={MUTED}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Feather name="x" size={16} color={MUTED} />
            </TouchableOpacity>
          )}
        </View>

        {/* Contact shortcuts */}
        <View style={s.contactRow}>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('mailto:support@brandthread.app')} activeOpacity={0.8}>
            <Feather name="mail" size={18} color={GREEN} />
            <Text style={s.contactLabel}>Email Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('https://brandthread.app/chat')} activeOpacity={0.8}>
            <Feather name="message-circle" size={18} color={GREEN} />
            <Text style={s.contactLabel}>Live Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('https://brandthread.app/help')} activeOpacity={0.8}>
            <Feather name="book-open" size={18} color={GREEN} />
            <Text style={s.contactLabel}>Full Docs</Text>
          </TouchableOpacity>
        </View>

        {/* FAQs */}
        <Text style={s.sectionTitle}>Frequently Asked Questions</Text>
        {filtered.length === 0 && (
          <Text style={s.noResults}>No results for "{query}"</Text>
        )}
        {filtered.map((faq, i) => {
          const isOpen = openIdx === i;
          return (
            <TouchableOpacity
              key={i}
              style={s.faqCard}
              activeOpacity={0.85}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpenIdx(isOpen ? null : i); }}
            >
              <View style={s.faqTop}>
                <Text style={s.faqQ} numberOfLines={isOpen ? undefined : 2}>{faq.q}</Text>
                <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
              </View>
              {isOpen && <Text style={s.faqA}>{faq.a}</Text>}
            </TouchableOpacity>
          );
        })}

        {/* Support ticket form */}
        <View style={s.ticketSection}>
          <View style={s.ticketHeader}>
            <Feather name="life-buoy" size={18} color={GREEN} />
            <Text style={s.ticketTitle}>Still stuck? Send us a message</Text>
          </View>
          <Text style={s.ticketSub}>We typically respond within 2 hours on business days.</Text>

          {submitted ? (
            <View style={s.submittedBadge}>
              <Feather name="check-circle" size={16} color="#34D399" />
              <Text style={s.submittedText}>Got it! We'll be in touch shortly.</Text>
              <TouchableOpacity onPress={() => setSubmitted(false)}>
                <Text style={s.sendAnotherText}>Send another</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Category chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={{ gap: 6 }}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[s.catChip, category === c && s.catChipActive]}
                    onPress={() => setCategory(c)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.catChipText, category === c && s.catChipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TextInput
                style={s.ticketInput}
                placeholder="Subject"
                placeholderTextColor={MUTED}
                value={subject}
                onChangeText={setSubject}
                maxLength={120}
              />
              <TextInput
                style={[s.ticketInput, s.ticketBody]}
                placeholder="Describe your issue…"
                placeholderTextColor={MUTED}
                value={ticketBody}
                onChangeText={setTicketBody}
                multiline
                numberOfLines={4}
                maxLength={2000}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[s.contactFullBtn, (!subject.trim() || !ticketBody.trim() || submitting) && s.btnDisabled]}
                onPress={handleSubmitTicket}
                disabled={!subject.trim() || !ticketBody.trim() || submitting}
                activeOpacity={0.85}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={s.contactFullBtnText}>Send Message</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  searchRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  contactRow: { flexDirection: 'row', gap: 10 },
  contactBtn: { flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, alignItems: 'center', gap: 8 },
  contactLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  noResults:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', paddingVertical: 20 },
  faqCard:    { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 10 },
  faqTop:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  faqQ:       { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG, flex: 1 },
  faqA:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 20 },
  ticketSection:   { backgroundColor: 'rgba(139,92,246,0.10)', borderRadius: 18, borderWidth: 1, borderColor: GREEN + '33', padding: 16, gap: 12 },
  ticketHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  ticketSub:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 19 },
  catScroll:       { flexGrow: 0, marginBottom: -2 },
  catChip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)' },
  catChipActive:   { backgroundColor: GREEN, borderColor: GREEN },
  catChipText:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED },
  catChipTextActive: { color: '#000' },
  ticketInput:     { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  ticketBody:      { minHeight: 100 },
  submittedBadge:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(52,211,153,0.12)', borderRadius: 10 },
  submittedText:   { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: FG },
  sendAnotherText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, textDecorationLine: 'underline' },
  contactFullBtn:  { backgroundColor: GREEN, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center' },
  contactFullBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#000' },
  btnDisabled:     { opacity: 0.5 },
});
