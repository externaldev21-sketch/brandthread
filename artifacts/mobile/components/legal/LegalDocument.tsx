import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BG, BORDER, CARD, FG, MUTED, ORANGE, SUBTLE } from '@/lib/theme';

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalDocumentProps {
  eyebrow: string;
  title: string;
  summary: string;
  effectiveDate: string;
  reviewNotice: string;
  sections: LegalSection[];
  companionRoute: '/privacy' | '/terms';
  companionLabel: string;
}

export default function LegalDocument({
  eyebrow,
  title,
  summary,
  effectiveDate,
  reviewNotice,
  sections,
  companionRoute,
  companionLabel,
}: LegalDocumentProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom;

  function leaveDocument() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topInset + 20, paddingBottom: bottomInset + 36 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to Brandthread"
            onPress={leaveDocument}
            style={({ pressed }) => [styles.brandButton, pressed && styles.pressed]}
          >
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>B</Text>
            </View>
            <Text style={styles.brandName}>Brandthread</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${companionLabel}`}
            onPress={() => router.push(companionRoute)}
            style={({ pressed }) => [styles.companionLink, pressed && styles.pressed]}
          >
            <Text style={styles.companionText}>{companionLabel}</Text>
            <Feather name="arrow-up-right" size={15} color={theme.accentLight} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.summary}>{summary}</Text>
          <Text style={styles.date}>Effective date: {effectiveDate}</Text>
        </View>

        <View accessibilityRole="summary" style={styles.reviewNotice}>
          <View style={styles.noticeIcon}>
            <Feather name="alert-triangle" size={18} color={theme.accentLight} />
          </View>
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Legal review required before launch</Text>
            <Text style={styles.noticeText}>{reviewNotice}</Text>
          </View>
        </View>

        <View style={styles.sections}>
          {sections.map((section, sectionIndex) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionNumber}>
                  {String(sectionIndex + 1).padStart(2, '0')}
                </Text>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {section.title}
                </Text>
              </View>
              {section.paragraphs?.map((paragraph) => (
                <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>
              ))}
              {section.bullets?.map((bullet) => (
                <View key={bullet} style={styles.bulletRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.bulletText}>{bullet}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderLabel}>OWNER + COUNSEL ACTION REQUIRED</Text>
          <Text style={styles.placeholderTitle}>Complete these facts before launch</Text>
          <Text style={styles.placeholderText}>
            [LEGAL ENTITY NAME] · [POSTAL ADDRESS] · [PRIVACY/LEGAL CONTACT] ·
            [GOVERNING LAW AND COURTS] · [FINAL RETENTION SCHEDULE]
          </Text>
        </View>

        <Text style={styles.footer}>
          © {new Date().getFullYear()} Brandthread. Draft document for legal review.
        </Text>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    paddingHorizontal: 22,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 54,
  },
  brandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
  },
  brandMarkText: {
    color: theme.onAccent,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
  },
  brandName: {
    color: FG,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    letterSpacing: -0.3,
  },
  companionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: CARD,
  },
  companionText: {
    color: theme.accentLight,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  pressed: {
    opacity: 0.7,
  },
  hero: {
    paddingBottom: 34,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  eyebrow: {
    color: theme.accentLight,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  title: {
    color: FG,
    fontFamily: 'Inter_700Bold',
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -1.4,
    marginBottom: 18,
  },
  summary: {
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    fontSize: 17,
    lineHeight: 27,
    maxWidth: 700,
  },
  date: {
    color: SUBTLE,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginTop: 18,
  },
  reviewNotice: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 28,
    marginBottom: 42,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.accentLight,
    backgroundColor: theme.accentDim,
    borderRadius: 16,
  },
  noticeIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
  },
  noticeCopy: {
    flex: 1,
  },
  noticeTitle: {
    color: FG,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    marginBottom: 5,
  },
  noticeText: {
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  sections: {
    gap: 38,
  },
  section: {
    gap: 13,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    marginBottom: 3,
  },
  sectionNumber: {
    color: theme.accentLight,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  sectionTitle: {
    flex: 1,
    color: FG,
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  paragraph: {
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 25,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 4,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 9,
    backgroundColor: theme.accentLight,
  },
  bulletText: {
    flex: 1,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 24,
  },
  placeholderCard: {
    marginTop: 48,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 16,
    padding: 20,
    backgroundColor: CARD,
  },
  placeholderLabel: {
    color: ORANGE,
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  placeholderTitle: {
    color: FG,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    marginBottom: 8,
  },
  placeholderText: {
    color: MUTED,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 21,
  },
  footer: {
    color: SUBTLE,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 40,
  },
});