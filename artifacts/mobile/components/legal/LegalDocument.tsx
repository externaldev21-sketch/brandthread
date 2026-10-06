import React from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
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
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import LegalMarkdown from '@/components/legal/LegalMarkdown';
import {
  EFFECTIVE_DATE, LEGAL_DOCUMENTS, LEGAL_DOCUMENT_ORDER, LEGAL_ALL_DOCUMENT_ORDER, LEGAL_VERSION,
  type LegalDocId,
} from '@/content/legal';

export type { LegalSection } from '@/content/legal';

interface LegalDocumentProps {
  docId: LegalDocId;
}

/**
 * Renders one of the legal documents from content/legal.ts — the single
 * source for the Terms of Service, Privacy Policy and Community Guidelines.
 */
export default function LegalDocument({ docId }: LegalDocumentProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const topInset = useHeaderTopInset();
  const bottomInset = insets.bottom;
  const doc = LEGAL_DOCUMENTS[docId];
  // The original three documents keep their three-pill switcher exactly as it
  // was; the seller agreement and refund policy show all five (scrollable).
  const inOriginalSet = LEGAL_DOCUMENT_ORDER.includes(docId);
  const switcherIds = inOriginalSet ? LEGAL_DOCUMENT_ORDER : LEGAL_ALL_DOCUMENT_ORDER;

  function leaveDocument() {
    if (router.canGoBack()) {
      goBackOr(router);
      return;
    }
    router.replace('/');
  }

  const switcher = (
    <View style={styles.switcher} accessibilityRole="tablist">
      {switcherIds.map((id) => {
        const item = LEGAL_DOCUMENTS[id];
        const active = id === docId;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => { if (!active) router.replace(item.route); }}
            style={({ pressed }) => [styles.switchItem, active && styles.switchItemActive, pressed && styles.pressed]}
          >
            <Text style={[styles.switchText, active && styles.switchTextActive]}>{item.shortTitle}</Text>
          </Pressable>
        );
      })}
    </View>
  );

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
              <Feather name="arrow-left" size={16} color={theme.onAccent} />
            </View>
            <Text style={styles.brandName}>Brandthread</Text>
          </Pressable>
        </View>

        {inOriginalSet ? switcher : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.switcherScroll}
            contentContainerStyle={styles.switcherScrollContent}
          >
            {switcher}
          </ScrollView>
        )}

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{doc.eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.title}>{doc.title}</Text>
          <Text style={styles.summary}>{doc.summary}</Text>
          <Text style={styles.date}>Effective {EFFECTIVE_DATE} · Version {LEGAL_VERSION}</Text>
        </View>

        <View style={styles.sections}>
          {doc.sections.map((section, sectionIndex) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionNumber}>
                  {String(sectionIndex + 1).padStart(2, '0')}
                </Text>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {section.title}
                </Text>
              </View>
              {section.blocks ? (
                <LegalMarkdown blocks={section.blocks} styles={styles} />
              ) : (
                <>
                  {section.paragraphs?.map((paragraph) => (
                    <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>
                  ))}
                  {section.bullets?.map((bullet) => (
                    <View key={bullet} style={styles.bulletRow}>
                      <View style={styles.bullet} />
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          ))}
        </View>

        <Text style={styles.footer}>
          © 2026 Brandthread, Inc.
        </Text>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
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
    marginBottom: 28,
  },
  brandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    // 44x44 minimum comfortable touch target (COMP.minTouchTarget) — this
    // used to be sized to its icon (34px), which read as a control under
    // 44x44 to the audit.
    minHeight: 44,
    paddingVertical: 5,
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
    color: theme.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    letterSpacing: -0.3,
  },
  pressed: {
    opacity: 0.7,
  },
  switcher: {
    flexDirection: 'row',
    padding: 4,
    marginBottom: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    alignSelf: 'flex-start',
  },
  switcherScroll: {
    flexGrow: 0,
    marginHorizontal: -22,
  },
  switcherScrollContent: {
    paddingHorizontal: 22,
  },
  switchItem: {
    paddingHorizontal: 16,
    // 44px minimum comfortable touch target (COMP.minTouchTarget); was 34px.
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchItemActive: {
    backgroundColor: theme.accent,
  },
  switchText: {
    color: theme.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  switchTextActive: {
    color: theme.onAccent,
  },
  hero: {
    paddingBottom: 34,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
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
    color: theme.text,
    fontFamily: 'Inter_700Bold',
    // FS.h1 (36) — the largest step on the declared type scale in lib/theme.ts.
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -1.2,
    marginBottom: 18,
  },
  summary: {
    color: theme.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 17,
    lineHeight: 27,
    maxWidth: 700,
  },
  date: {
    color: theme.subtle,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginTop: 18,
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
    color: theme.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  paragraph: {
    color: theme.muted,
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
    color: theme.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 24,
  },
  numberText: {
    minWidth: 18,
    color: theme.accentLight,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 24,
  },
  heading: {
    color: theme.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 6,
  },
  bold: {
    color: theme.text,
    fontFamily: 'Inter_700Bold',
  },
  link: {
    color: theme.text,
    fontFamily: 'Inter_600SemiBold',
    textDecorationLine: 'underline',
  },
  footer: {
    color: theme.subtle,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 40,
  },
});