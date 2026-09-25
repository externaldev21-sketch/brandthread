import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Linking, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Header } from '@/components/layout';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  BrandthreadCard, SearchBar, SectionHeader, FilterChip, FormInput,
  PrimaryButton, EmptyState, SheetHandle, NavigationCard,
} from '@/components/BrandthreadUI';

type Category = 'General' | 'Billing' | 'Account' | 'Bug' | 'Feature';

interface Faq {
  q: string;
  a: string;
  category: Category;
  popular?: boolean;
}

const FAQS: Faq[] = [
  { q: 'How do drops work?', a: 'Drops are limited-time releases from brands you follow. When a drop goes live you get a notification. Tap the drop to view it and place your order before it sells out. Pre-orders are charged immediately and shipped when production is complete.', category: 'General', popular: true },
  { q: 'When does my payment get charged?', a: 'For in-stock items your card is charged at checkout. For pre-order drops your card is charged immediately, but the brand only receives funds once your order ships — we hold the money in escrow to protect you.', category: 'Billing', popular: true },
  { q: 'How do I track my order?', a: 'Go to your Profile → My Orders and tap any order to see its tracking number and live delivery status.', category: 'General', popular: true },
  { q: 'Can I return or exchange an item?', a: 'Returns and exchanges are handled per-brand. Tap "Get Help" or "Return / Exchange" on any delivered order in My Orders to start the process with that brand.', category: 'General' },
  { q: 'How do I follow a brand?', a: 'Tap a brand\'s name anywhere in the app to view their profile, then tap "Follow". You\'ll see their drops in your Feed.', category: 'General' },
  { q: 'What is escrow protection?', a: 'Escrow protection means your payment is held by Brandthread and only released to the brand after your order ships. If something goes wrong before shipping you can get a full refund.', category: 'Billing', popular: true },
  { q: 'How do I delete my account?', a: 'Go to Settings → Account → Delete Account. This is permanent and removes all your data. Your order history is retained for legal/tax purposes for 90 days.', category: 'Account' },
];

const CATEGORIES: { key: Category; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'General', icon: 'compass' },
  { key: 'Billing', icon: 'credit-card' },
  { key: 'Account', icon: 'user' },
  { key: 'Bug', icon: 'alert-triangle' },
  { key: 'Feature', icon: 'zap' },
];

const POPULAR = FAQS.filter(f => f.popular);

export default function HelpScreen() {
  const api = useApi();
  const { user } = useUser();
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const scrollRef = useRef<ScrollView>(null);
  const [contactY, setContactY] = useState(0);

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [article, setArticle] = useState<Faq | null>(null);

  // Ticket form state
  const [subject, setSubject]       = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [category, setCategory]     = useState<Category>('General');
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

  const filtered = FAQS.filter((f) => {
    const matchesQuery = !query.trim()
      || f.q.toLowerCase().includes(query.toLowerCase())
      || f.a.toLowerCase().includes(query.toLowerCase())
      || f.category.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = !activeCategory || f.category === activeCategory;
    return matchesQuery && matchesCategory;
  });

  const isSearching = query.trim().length > 0 || activeCategory !== null;

  function scrollToContact() {
    scrollRef.current?.scrollTo({ y: contactY, animated: true });
  }

  return (
    <View style={s.root}>
      <Header
        title="Help & Support"
        actions={[
          { icon: 'life-buoy', onPress: scrollToContact, accessibilityLabel: 'Jump to contact support' },
        ]}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: SP.md, paddingBottom: 100, gap: SP.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search */}
        <SearchBar value={query} onChange={setQuery} placeholder="Search help articles…" />

        {!isSearching && (
          <>
            {/* Popular topics */}
            <View style={{ gap: SP.sm }}>
              <SectionHeader title="Popular topics" />
              <View style={{ gap: SP.sm }}>
                {POPULAR.map((faq) => (
                  <NavigationCard
                    key={faq.q}
                    icon="help-circle"
                    label={faq.q}
                    description={faq.category}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setArticle(faq); }}
                  />
                ))}
              </View>
            </View>

            {/* Category cards */}
            <View style={{ gap: SP.sm }}>
              <SectionHeader title="Browse by category" />
              <View style={s.categoryGrid}>
                {CATEGORIES.map((c) => {
                  const count = FAQS.filter(f => f.category === c.key).length;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={s.categoryCard}
                      activeOpacity={0.85}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveCategory(c.key); }}
                    >
                      <View style={[s.categoryIconWrap, { backgroundColor: theme.accent + '18' }]}>
                        <Feather name={c.icon} size={ICON.md} color={theme.accent} />
                      </View>
                      <Text style={s.categoryLabel}>{c.key}</Text>
                      <Text style={s.categoryCount}>{count > 0 ? `${count} article${count === 1 ? '' : 's'}` : 'Contact us'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* FAQ list (search / category results, or the full list) */}
        <View style={{ gap: SP.sm }}>
          <SectionHeader
            title={isSearching ? 'Results' : 'All questions'}
            action={activeCategory ? { label: 'Clear filter', onPress: () => setActiveCategory(null) } : undefined}
          />

          {isSearching && (
            <View style={s.chipRow}>
              {CATEGORIES.map((c) => (
                <FilterChip
                  key={c.key}
                  label={c.key}
                  active={activeCategory === c.key}
                  onPress={() => setActiveCategory(activeCategory === c.key ? null : c.key)}
                />
              ))}
            </View>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="No matching articles"
              description={query.trim() ? `Nothing matched "${query}". Try another term, or send us a message below.` : 'No articles in this category yet — send us a message below and we\'ll help directly.'}
              action={{ label: 'Contact support', onPress: scrollToContact, icon: 'life-buoy' }}
              compact
            />
          ) : (
            <View style={{ gap: SP.sm }}>
              {filtered.map((faq) => (
                <NavigationCard
                  key={faq.q}
                  icon="file-text"
                  label={faq.q}
                  description={faq.category}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setArticle(faq); }}
                />
              ))}
            </View>
          )}
        </View>

        {/* Contact shortcuts */}
        <View style={s.contactRow}>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('mailto:support@brandthread.app')} activeOpacity={0.8}>
            <Feather name="mail" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Email Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('https://brandthread.app/chat')} activeOpacity={0.8}>
            <Feather name="message-circle" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Live Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL('https://brandthread.app/help')} activeOpacity={0.8}>
            <Feather name="book-open" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Full Docs</Text>
          </TouchableOpacity>
        </View>

        {/* Support ticket form */}
        <View onLayout={(e) => setContactY(e.nativeEvent.layout.y)}>
          <BrandthreadCard style={[s.ticketSection, { backgroundColor: theme.accentDim, borderColor: `${theme.accent}33` }]}>
            <View style={s.ticketHeader}>
              <Feather name="life-buoy" size={ICON.md} color={theme.accent} />
              <Text style={s.ticketTitle}>Still stuck? Send us a message</Text>
            </View>
            <Text style={s.ticketSub}>We typically respond within 2 hours on business days.</Text>

            {submitted ? (
              <View style={s.submittedBadge}>
                <Feather name="check-circle" size={ICON.sm} color={theme.success} />
                <Text style={s.submittedText}>Got it! We'll be in touch shortly.</Text>
                <TouchableOpacity onPress={() => setSubmitted(false)}>
                  <Text style={s.sendAnotherText}>Send another</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Category chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={{ gap: SP.sm }}>
                  {CATEGORIES.map((c) => (
                    <FilterChip
                      key={c.key}
                      label={c.key}
                      active={category === c.key}
                      onPress={() => setCategory(c.key)}
                    />
                  ))}
                </ScrollView>

                <FormInput
                  value={subject}
                  onChange={setSubject}
                  placeholder="Subject"
                />
                <FormInput
                  value={ticketBody}
                  onChange={setTicketBody}
                  placeholder="Describe your issue…"
                  multiline
                />
                <PrimaryButton
                  label={submitting ? 'Sending…' : 'Send Message'}
                  onPress={handleSubmitTicket}
                  disabled={!subject.trim() || !ticketBody.trim() || submitting}
                  loading={submitting}
                />
              </>
            )}
          </BrandthreadCard>
        </View>
      </ScrollView>

      {/* Article sheet */}
      <Modal
        visible={!!article}
        animationType="slide"
        transparent
        onRequestClose={() => setArticle(null)}
      >
        <View style={s.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setArticle(null)} />
          <View style={s.sheetCard}>
            <SheetHandle />
            {article && (
              <ScrollView contentContainerStyle={{ padding: SP.md, paddingTop: SP.xs, gap: SP.sm, paddingBottom: SP.xl }} showsVerticalScrollIndicator={false}>
                <View style={s.sheetCategoryPill}>
                  <Text style={[s.sheetCategoryText, { color: theme.accent }]}>{article.category}</Text>
                </View>
                <Text style={s.sheetTitle}>{article.q}</Text>
                <Text style={s.sheetBody}>{article.a}</Text>
                <PrimaryButton
                  label="Still need help? Contact support"
                  onPress={() => { setArticle(null); setTimeout(scrollToContact, 250); }}
                  icon="life-buoy"
                  style={{ marginTop: SP.md }}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root:       { flex: 1, backgroundColor: theme.background },
  contactRow: { flexDirection: 'row', gap: SP.sm },
  contactBtn: { flex: 1, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.md, alignItems: 'center', gap: SP.sm },
  contactLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  categoryCard: { width: '31%', flexGrow: 1, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.sm, gap: 4, alignItems: 'flex-start' },
  categoryIconWrap: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  categoryLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  categoryCount: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },

  ticketSection:   { gap: SP.md },
  ticketHeader:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  ticketTitle:     { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  ticketSub:       { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 19 },
  catScroll:       { flexGrow: 0, marginBottom: -2 },
  submittedBadge:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, backgroundColor: `${theme.success}1F`, borderRadius: RADIUS.sm },
  submittedText:   { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  sendAnotherText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, textDecorationLine: 'underline' },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetCard:     { maxHeight: '80%', backgroundColor: theme.background, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border },
  sheetCategoryPill: { alignSelf: 'flex-start', backgroundColor: theme.accentDim, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4 },
  sheetCategoryText: { fontSize: FS.xs, fontFamily: FONT.bold, letterSpacing: 0.3, textTransform: 'uppercase' },
  sheetTitle:    { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.3 },
  sheetBody:     { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, lineHeight: 23 },
});
