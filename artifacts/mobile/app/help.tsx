import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

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

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery]     = useState('');
  const [openIdx, setOpenIdx] = useState<number | null>(null);

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

        {/* Still stuck */}
        <View style={s.stillStuck}>
          <Feather name="life-buoy" size={20} color={GREEN} />
          <Text style={s.stillStuckTitle}>Still stuck?</Text>
          <Text style={s.stillStuckSub}>Our support team typically responds within 2 hours on business days.</Text>
          <TouchableOpacity style={s.contactFullBtn} onPress={() => Linking.openURL('mailto:support@brandthread.app')} activeOpacity={0.85}>
            <Text style={s.contactFullBtnText}>Contact Support</Text>
          </TouchableOpacity>
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
  stillStuck: { backgroundColor: 'rgba(139,92,246,0.18)', borderRadius: 18, borderWidth: 1, borderColor: GREEN + '33', padding: 20, alignItems: 'center', gap: 8 },
  stillStuckTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  stillStuckSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 19 },
  contactFullBtn:  { backgroundColor: GREEN, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 13, marginTop: 4 },
  contactFullBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#000' },
});
