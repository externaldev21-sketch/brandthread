import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert, ActivityIndicator, Modal } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { Feather } from '@expo/vector-icons';

import { haptic } from '@/lib/haptics';

import { useApi } from '@/lib/api';

import { useUser } from '@clerk/expo';

import { SupportChatModal } from '@/components/SupportChatBubble';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAfterModalDismiss } from '@/hooks/useAfterModalDismiss';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  BrandthreadCard, SearchBar, SectionHeader, FilterChip, FormInput,
  PrimaryButton, EmptyState, SheetHandle, NavigationCard,
} from '@/components/BrandthreadUI';
import { useLocalSearchParams } from 'expo-router';
import { useRole } from '@/contexts/RoleContext';
import { HelpArticleSheet } from '@/components/help/HelpArticleSheet';
import { SELLER_ARTICLES, getSellerArticle, type SellerArticle } from '@/content/help/sellerArticles';

type Category = 'General' | 'Billing' | 'Account' | 'Bug' | 'Feature';

interface Faq {
  q: string;
  a: string;
  category: Category;
  popular?: boolean;
}

const FAQS: Faq[] = [
  { q: 'How do drops work?', a: 'Drops are limited-time products from brands you follow. When a drop goes live you get a notification. Tap the drop to view it and place your order before it sells out. Pre-orders are charged immediately and shipped when production is complete.', category: 'General', popular: true },
  { q: 'When does my payment get charged?', a: 'For in-stock items your card is charged at checkout. For pre-order drops your card is charged immediately, but the brand only receives funds once your order ships — we hold the money in escrow to protect you.', category: 'Billing', popular: true },
  { q: 'How do I track my order?', a: 'Go to your Profile → My Orders and tap any order to see its tracking number and live delivery status.', category: 'General', popular: true },
  { q: 'Can I return or exchange an item?', a: 'Returns and exchanges are handled per-brand. Tap "Get Help" or "Return / Exchange" on any delivered order in My Orders to start the process with that brand.', category: 'General' },
  { q: 'How do I follow a brand?', a: 'Tap a brand\'s name anywhere in the app to view their profile, then tap "Follow". You\'ll see their drops in your Feed.', category: 'General' },
  { q: 'What is escrow protection?', a: 'Escrow protection means your payment is held by Brandthread and only released to the brand after your order ships. If something goes wrong before shipping you can get a full refund.', category: 'Billing', popular: true },
  { q: 'How do I delete my account?', a: 'Go to Settings → Account → Delete Account. Your account is hidden right away and permanently deleted after 30 days. Sign back in during those 30 days to restore it. Order, payment and tax records are kept, without your personal details, for as long as the law requires.', category: 'Account' },
];

const CATEGORIES: { key: Category; icon: IconName }[] = [
  { key: 'General', icon: 'compass' },
  { key: 'Billing', icon: 'credit-card' },
  { key: 'Account', icon: 'user' },
  { key: 'Bug', icon: 'alert-triangle' },
  { key: 'Feature', icon: 'zap' },
];

const POPULAR = FAQS.filter(f => f.popular);

/** Same address as the Terms / Privacy Policy and REVIEW_NOTES.md. */
const SUPPORT_EMAIL = 'support@brandthread.app';

const REPLY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Error copy for the "Reply email" field, or null when it's a usable address. */
export function replyEmailError(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter an email so we can reply';
  return REPLY_EMAIL_RE.test(v) ? null : 'Enter a valid email';
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { user, isSignedIn } = useUser();
  const [chatOpen, setChatOpen] = useState(false);
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const tabBarInset = useSellerTabBarInset();
  const scrollRef = useRef<ScrollView>(null);
  const [contactY, setContactY] = useState(0);
  const [gridW, setGridW] = useState(0);
  // Equal-width category cards: 3 per row, exact width so a short last row
  // keeps the same card size instead of stretching.
  const categoryW = gridW > 0 ? Math.floor((gridW - SP.sm * 2) / 3) : undefined;
  const [faqY, setFaqY] = useState(0);
  const [articlesY, setArticlesY] = useState(0);

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [article, setArticle] = useState<Faq | null>(null);
  // "Contact support" from inside the article sheet scrolls once the sheet
  // has actually closed, not after a guessed delay.
  const articleSheet = useAfterModalDismiss(!!article);
  // ?article=<id> opens that seller article directly (HelpLink ids).
  const { role } = useRole();
  const params = useLocalSearchParams<{ article?: string }>();
  const [sellerArticle, setSellerArticle] = useState<SellerArticle | null>(() => getSellerArticle(params.article));
  useEffect(() => { const next = getSellerArticle(params.article); if (next) setSellerArticle(next); }, [params.article]);

  // Ticket form state
  const [subject, setSubject]       = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [category, setCategory]     = useState<Category>('General');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  // No email on the account: ask where to reply instead of inventing one.
  const accountEmail = user?.primaryEmailAddress?.emailAddress?.trim() || '';
  const needsReplyEmail = !!isSignedIn && !accountEmail;
  const [replyEmail, setReplyEmail] = useState('');
  const [replyEmailTouched, setReplyEmailTouched] = useState(false);

  async function handleSubmitTicket() {
    if (!subject.trim() || !ticketBody.trim()) {
      Alert.alert('Missing info', 'Please fill in the subject and message before sending.');
      return;
    }
    // Signed out (public Support URL): no account to file a ticket under, so
    // hand the message to the mail app instead of calling the authed API.
    if (!isSignedIn) {
      const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[${category}] ${subject.trim()}`)}&body=${encodeURIComponent(ticketBody.trim())}`;
      Linking.openURL(url).catch(() => Alert.alert('Email us', SUPPORT_EMAIL));
      return;
    }
    if (needsReplyEmail && replyEmailError(replyEmail)) {
      setReplyEmailTouched(true);
      return;
    }
    setSubmitting(true);
    try {
      const email = accountEmail || replyEmail.trim();
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
      Alert.alert("Couldn't send your message", 'Try again, or email us directly.');
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

  // Live Chat is the in-app support assistant (it can hand off to a person).
  // It reads the account, so it needs one; signed out, offer email instead.
  function openLiveChat() {
    if (isSignedIn) {
      setChatOpen(true);
      return;
    }
    Alert.alert('Sign in to chat', 'Live chat is available once you sign in. You can email us any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Email us', onPress: () => { Linking.openURL('mailto:support@brandthread.app').catch(() => {}); } },
    ]);
  }
  // "Full Docs": the help center is these in-app articles, so clear any
  // search/filter and jump to the full list instead of reopening this page.
  function showAllArticles() {
    setQuery('');
    setActiveCategory(null);
    scrollRef.current?.scrollTo({ y: articlesY, animated: true });
  }

  return (
    <View style={s.root}>
      <ScreenHeader
        title="Help & support"
        actions={[
          { icon: 'life-buoy', onPress: scrollToContact, accessibilityLabel: 'Jump to contact support' },
        ]}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: SP.md, paddingBottom: Math.max(100, tabBarInset + SP.lg), gap: SP.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search */}
        <SearchBar value={query} onChange={setQuery} placeholder="Search help articles…" style={s.search} />

        {!isSearching && (
          <>
            {/* Popular topics */}
            <View style={{ gap: SP.sm }}>
              <SectionHeader title="Popular topics" style={s.sectionHeader} />
              <View style={{ gap: SP.sm }}>
                {POPULAR.map((faq) => (
                  <NavigationCard
                    key={faq.q}
                    icon="help-circle"
                    label={faq.q}
                    description={faq.category}
                    onPress={() => { haptic('sheet'); setArticle(faq); }}
                  />
                ))}
              </View>
            </View>

            {role === 'seller' && (
              <View style={{ gap: SP.sm }}>
                <SectionHeader title="Selling" />
                <View style={{ gap: SP.sm }}>
                  {SELLER_ARTICLES.map((a) => (
                    <NavigationCard key={a.id} icon="file-text" label={a.title} onPress={() => setSellerArticle(a)} />
                  ))}
                </View>
              </View>
            )}

            {/* Category cards */}
            <View style={{ gap: SP.sm }}>
              <SectionHeader title="Browse by category" style={s.sectionHeader} />
              <View style={s.categoryGrid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
                {CATEGORIES.map((c) => {
                  const count = FAQS.filter(f => f.category === c.key).length;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[s.categoryCard, categoryW !== undefined && { width: categoryW }]}
                      activeOpacity={0.85}
                      onPress={() => { haptic('select'); setActiveCategory(c.key); }}
                    >
                      <View style={[s.categoryIconWrap, { backgroundColor: theme.accent + '18' }]}>
                        <Icon name={c.icon} size={ICON.md} color={theme.accent} />
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
        <View style={{ gap: SP.sm }} onLayout={(e) => { setFaqY(e.nativeEvent.layout.y); setArticlesY(e.nativeEvent.layout.y); }}>
          <SectionHeader
            title={isSearching ? 'Results' : 'All questions'}
            style={s.sectionHeader}
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
                  onPress={() => { haptic('sheet'); setArticle(faq); }}
                />
              ))}
            </View>
          )}
        </View>

        {/* Contact shortcuts */}
        <View style={s.contactRow}>
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} activeOpacity={0.8}>
            <Icon name="mail" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Email Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={openLiveChat} activeOpacity={0.8} accessibilityRole="button" testID="help-live-chat">
            <Icon name="message-circle" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Live Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactBtn} onPress={showAllArticles} activeOpacity={0.8} testID="help-full-docs">
            <Icon name="book-open" size={ICON.md} color={theme.accent} />
            <Text style={s.contactLabel}>Full Docs</Text>
          </TouchableOpacity>
        </View>
        {/* The address as text; "Email Us" above is the one mail control. */}
        <Text style={s.supportEmail} selectable testID="help-support-email">{SUPPORT_EMAIL}</Text>

        {/* Support ticket form */}
        <View onLayout={(e) => setContactY(e.nativeEvent.layout.y)}>
          <BrandthreadCard style={s.ticketSection}>
            <View style={s.ticketHeader}>
              <Icon name="life-buoy" size={ICON.md} color={theme.accent} />
              <Text style={s.ticketTitle}>Still stuck? Send us a message</Text>
            </View>
            <Text style={s.ticketSub}>We typically respond within 2 hours on business days.</Text>

            {submitted ? (
              <View style={s.submittedBadge}>
                <Icon name="check-circle" size={ICON.sm} color={theme.success} />
                <Text style={s.submittedText}>Got it. We'll be in touch shortly.</Text>
                <TouchableOpacity onPress={() => setSubmitted(false)}>
                  <Text style={s.sendAnotherText}>Send another</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Category chips */}
                <View style={s.chipRow}>
                  {CATEGORIES.map((c) => (
                    <FilterChip
                      key={c.key}
                      label={c.key}
                      active={category === c.key}
                      onPress={() => setCategory(c.key)}
                    />
                  ))}
                </View>

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
                {needsReplyEmail ? (
                  <FormInput
                    label="Reply email"
                    value={replyEmail}
                    onChange={(v) => { setReplyEmail(v); if (replyEmailTouched && !replyEmailError(v)) setReplyEmailTouched(false); }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    autoCapitalize="none"
                    helper="Your account has no email, so tell us where to reply."
                    validate={replyEmailError}
                    error={replyEmailTouched ? replyEmailError(replyEmail) ?? undefined : undefined}
                  />
                ) : null}
                <PrimaryButton
                  label={submitting ? 'Sending…' : 'Send Message'}
                  onPress={handleSubmitTicket}
                  disabled={!subject.trim() || !ticketBody.trim() || (needsReplyEmail && !replyEmail.trim()) || submitting}
                  loading={submitting}
                />
              </>
            )}
          </BrandthreadCard>
        </View>
      </ScrollView>

      <HelpArticleSheet article={sellerArticle} onClose={() => setSellerArticle(null)} />

      {/* Article sheet */}
      <Modal
        visible={!!article}
        animationType="slide"
        transparent
        onRequestClose={() => setArticle(null)}
        onDismiss={articleSheet.onDismiss}
      >
        <View style={[s.sheetBackdrop, { paddingTop: insets.top }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setArticle(null)} />
          <View style={s.sheetCard}>
            <SheetHandle />
            {article && (
              <ScrollView contentContainerStyle={{ padding: SP.md, paddingTop: SP.xs, gap: SP.sm, paddingBottom: Math.max(SP.xl, insets.bottom + SP.sm) }} showsVerticalScrollIndicator={false}>
                <View style={s.sheetCategoryPill}>
                  <Text style={[s.sheetCategoryText, { color: theme.accent }]}>{article.category}</Text>
                </View>
                <Text style={s.sheetTitle}>{article.q}</Text>
                <Text style={s.sheetBody}>{article.a}</Text>
                <PrimaryButton
                  label="Still need help? Contact support"
                  onPress={() => { articleSheet.runAfterDismiss(scrollToContact); setArticle(null); }}
                  icon="life-buoy"
                  style={{ marginTop: SP.md }}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <SupportChatModal visible={chatOpen} onClose={() => setChatOpen(false)} />
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root:       { flex: 1, backgroundColor: theme.background },
  contactRow: { flexDirection: 'row', gap: SP.sm },
  contactBtn: { flex: 1, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.md, alignItems: 'center', gap: SP.sm },
  contactLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
  supportEmail: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', marginTop: -SP.sm },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  search:        { borderWidth: 1, borderColor: theme.border },
  sectionHeader: { paddingHorizontal: 0 },
  categoryCard: { width: '31%', backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.sm, gap: SP.xs, alignItems: 'flex-start' },
  categoryIconWrap: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  categoryLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  categoryCount: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, fontVariant: ['tabular-nums'] },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },

  ticketSection:   { gap: SP.md },
  ticketHeader:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  ticketTitle:     { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  ticketSub:       { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },
  submittedBadge:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, backgroundColor: `${theme.success}1F`, borderRadius: RADIUS.sm },
  submittedText:   { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  sendAnotherText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, textDecorationLine: 'underline' },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }, // theme-exempt: neutral modal scrim
  sheetCard:     { maxHeight: '80%', backgroundColor: theme.background, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border },
  sheetCategoryPill: { alignSelf: 'flex-start', backgroundColor: theme.accentDim, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  sheetCategoryText: { fontSize: FS.xs, fontFamily: FONT.bold },
  sheetTitle:    { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.3 },
  sheetBody:     { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, lineHeight: 20 },
});
