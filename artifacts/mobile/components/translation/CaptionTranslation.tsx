/**
 * Instagram-style caption translation: a "See translation" link under text
 * that looks like it is in another language than the viewer's translation
 * language (Settings → Language), "See original" once translated. With
 * "Auto-translate captions" on, the translation is fetched and shown at once.
 *
 * Translations come from POST /api/translate (cached on the server and for
 * the session here). The signed-out preview never calls that protected API:
 * the link opens sign-in instead.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { useDisplayPrefs } from '@/contexts/DisplayPrefsContext';
import {
  TranslationMemo, shouldOfferTranslation, translationLinkLabel, type TranslationResult, type TranslationStatus as Status,
} from '@/lib/translation';
import { FONT } from '@/lib/theme';

const memo = new TranslationMemo();

export interface CaptionTranslation {
  /** The text to render: the translation while it is showing, else the original. */
  text: string;
  /** Label for the link under the text, or null when there is nothing to offer. */
  linkLabel: string | null;
  onPressLink: () => void;
}

export function useCaptionTranslation(original: string | null | undefined): CaptionTranslation {
  const source = original ?? '';
  const { prefs, syncsToAccount } = useDisplayPrefs();
  const api = useApi();
  const router = useRouter();
  const target = prefs.translationLanguage;
  const offer = useMemo(() => shouldOfferTranslation(source, target), [source, target]);
  const [result, setResult] = useState<TranslationResult | null>(() => memo.peek(source, target) ?? null);
  const [status, setStatus] = useState<Status>('idle');
  const [showingTranslation, setShowingTranslation] = useState(prefs.autoTranslateCaptions);

  // A new caption or language starts over.
  useEffect(() => {
    setResult(memo.peek(source, target) ?? null);
    setStatus('idle');
    setShowingTranslation(prefs.autoTranslateCaptions);
  }, [source, target, prefs.autoTranslateCaptions]);

  const fetchTranslation = useCallback(async () => {
    setStatus('loading');
    try {
      const value = await memo.get(source, target, async () => {
        const { translations } = await api.translate([source], target);
        const first = translations[0];
        if (!first) throw new Error('Empty translation response');
        return first;
      });
      setResult(value);
      setStatus('idle');
      return true;
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === 'TRANSLATION_NOT_CONFIGURED' ? 'unavailable' : 'error');
      return false;
    }
  }, [api, source, target]);

  // Auto-translate: signed-in only, and only for text that looks foreign.
  useEffect(() => {
    if (!offer || !prefs.autoTranslateCaptions || !syncsToAccount || result || status !== 'idle') return;
    void fetchTranslation();
  }, [offer, prefs.autoTranslateCaptions, syncsToAccount, result, status, fetchTranslation]);

  const onPressLink = useCallback(() => {
    if (showingTranslation && result) { setShowingTranslation(false); return; }
    if (!syncsToAccount) { router.push('/sign-in' as never); return; }
    if (status === 'unavailable' || status === 'loading') return;
    setShowingTranslation(true);
    if (!result) void fetchTranslation();
  }, [showingTranslation, result, syncsToAccount, status, router, fetchTranslation]);

  const translated = showingTranslation && result && !result.sameLanguage;
  return {
    text: translated ? result.translatedText : source,
    linkLabel: translationLinkLabel({ offer, showingTranslation: !!translated, status, result }),
    onPressLink,
  };
}

/** The small text link under a caption or comment. Pass a style to match the surface. */
export function TranslationLink({ translation, style }: {
  translation: CaptionTranslation; style?: StyleProp<TextStyle>;
}) {
  if (!translation.linkLabel) return null;
  return (
    <Text
      onPress={translation.onPressLink}
      accessibilityRole="button"
      suppressHighlighting
      style={[{ fontFamily: FONT.semibold, fontSize: 12, color: '#C0C0C0', marginTop: 4 }, style]}
    >
      {translation.linkLabel}
    </Text>
  );
}

/** A caption <Text> with its translation link below — drop-in for `<Text style numberOfLines>{caption}</Text>`. */
export function TranslatableCaption({ text, style, numberOfLines, linkStyle }: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  linkStyle?: StyleProp<TextStyle>;
}) {
  const translation = useCaptionTranslation(text);
  return (
    <>
      <Text style={style} numberOfLines={numberOfLines}>{translation.text}</Text>
      <TranslationLink translation={translation} style={linkStyle} />
    </>
  );
}
