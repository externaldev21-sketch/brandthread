/**
 * Street-address field with Google Places suggestions (server:
 * GET /api/buyer/address-suggestions and /address-suggestions/:placeId).
 *
 * Shop app pattern (Mobbin "Add address"): type the street, pick a
 * suggestion, and city / state / ZIP / country fill in below. When Places
 * can't help, the buyer is told so inline and pointed at the manual fields
 * right below (SHEIN / Yami / Vestiaire "Can't find it? Enter it manually"):
 *  - no matches            → "No matching addresses"
 *  - Places down / network → "Suggestions aren't loading" + Try again
 *  - Places not configured → "Address search is unavailable"
 *  - picked place isn't a full street address (server 422) or fails to
 *    load → said inline under the list. (This used to be Alert.alert, which
 *    is a no-op on web, so web buyers got no feedback at all.)
 *
 * Only what the buyer types triggers a search: re-opening a saved address
 * or filling line1 from a picked suggestion never pops the list back open.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useApi } from '@/hooks/useApi';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { WEB_INPUT_RESET } from '@/lib/inputReset';

export interface AddressSelection {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface AddressSuggestion {
  placeId: string;
  label: string;
}

export type AddressSearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'unavailable';

/** Server status → which designed state to show. 503 = Places not configured. */
export function searchStatusForError(error: unknown): AddressSearchStatus {
  return (error as { status?: number } | null)?.status === 503 ? 'unavailable' : 'error';
}

/** Why a picked suggestion couldn't fill the form, in the buyer's words. */
export function resolveErrorMessage(error: unknown): string {
  return (error as { status?: number } | null)?.status === 422
    ? 'That place isn’t a full street address. Pick one with a street number, or enter it below.'
    : 'We couldn’t load that address. Try again, or enter it below.';
}

export const MIN_ADDRESS_QUERY = 3;

export function AddressAutocompleteInput({
  value,
  country = 'US',
  onChangeText,
  onSelect,
}: {
  value: string;
  country?: string;
  onChangeText: (value: string) => void;
  onSelect: (address: AddressSelection) => void;
}) {
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>('idle');
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // The text the buyer typed. null = nothing to search (sheet just opened
  // with a saved street, or line1 was just filled from a suggestion).
  const [query, setQuery] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const trimmed = query?.trim() ?? '';
    const generation = ++requestGeneration.current;
    if (trimmed.length < MIN_ADDRESS_QUERY) {
      setSuggestions([]);
      setStatus('idle');
      return;
    }

    setStatus('loading');
    const timer = setTimeout(() => {
      void api.buyer.addresses.autocomplete(trimmed, country)
        .then(rows => {
          if (requestGeneration.current !== generation) return;
          setSuggestions(rows);
          setStatus(rows.length > 0 ? 'results' : 'empty');
        })
        .catch(error => {
          if (requestGeneration.current !== generation) return;
          setSuggestions([]);
          setStatus(searchStatusForError(error));
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [api, country, query, attempt]);

  function handleChangeText(text: string) {
    setResolveError(null);
    setQuery(text);
    onChangeText(text);
  }

  function retry() {
    setAttempt(previous => previous + 1);
  }

  async function chooseSuggestion(suggestion: AddressSuggestion) {
    if (resolving) return;
    setResolving(suggestion.placeId);
    setResolveError(null);
    try {
      const selected = await api.buyer.addresses.resolveSuggestion(suggestion.placeId);
      requestGeneration.current += 1;
      setSuggestions([]);
      setStatus('idle');
      setQuery(null);
      onSelect(selected);
    } catch (error) {
      setResolveError(resolveErrorMessage(error));
    } finally {
      setResolving(null);
    }
  }

  const notice = status === 'empty'
    ? { icon: 'map-pin' as const, title: 'No matching addresses', body: 'Check the street number and name, or enter your address in the fields below.', retry: false }
    : status === 'error'
      ? { icon: 'wifi-off' as const, title: 'Suggestions aren’t loading', body: 'You can still enter your address in the fields below.', retry: true }
      : status === 'unavailable'
        ? { icon: 'map' as const, title: 'Address search is unavailable', body: 'Enter your address in the fields below.', retry: false }
        : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Street address</Text>
      <View style={styles.inputWrap}>
        <Feather name="search" size={17} color={theme.muted} />
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          placeholder="Start typing your address"
          placeholderTextColor={theme.subtle}
          autoCapitalize="words"
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          accessibilityLabel="Shipping address search"
          style={[styles.input, WEB_INPUT_RESET]}
        />
        {status === 'loading' ? <ActivityIndicator size="small" color={theme.text} /> : null}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.placeId}
              onPress={() => void chooseSuggestion(suggestion)}
              disabled={resolving != null}
              style={[styles.suggestion, index > 0 && styles.suggestionBorder]}
              accessibilityRole="button"
              accessibilityLabel={`Use address ${suggestion.label}`}
            >
              <Feather name="map-pin" size={16} color={theme.muted} />
              <Text style={styles.suggestionText} numberOfLines={2}>{suggestion.label}</Text>
              {resolving === suggestion.placeId
                ? <ActivityIndicator size="small" color={theme.text} />
                : <Feather name="chevron-right" size={16} color={theme.subtle} />}
            </Pressable>
          ))}
        </View>
      )}

      {notice ? (
        <View style={styles.notice} accessibilityLiveRegion="polite" testID={`address-search-${status}`}>
          <Feather name={notice.icon} size={16} color={theme.muted} style={styles.noticeIcon} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>{notice.title}</Text>
            <Text style={styles.noticeBody}>{notice.body}</Text>
          </View>
          {notice.retry ? (
            <Pressable
              onPress={retry}
              style={styles.retry}
              accessibilityRole="button"
              accessibilityLabel="Try loading address suggestions again"
              hitSlop={8}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {resolveError ? (
        <View style={styles.resolveError} accessibilityLiveRegion="polite" accessibilityRole="alert" testID="address-resolve-error">
          <Feather name="alert-circle" size={14} color={theme.text} style={styles.noticeIcon} />
          <Text style={styles.resolveErrorText}>{resolveError}</Text>
        </View>
      ) : null}

      {notice ? null : (
        <Text style={styles.hint}>Choose a suggestion to fill city, state, postal code, and country. Powered by Google.</Text>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  wrap: { marginBottom: SP.sm },
  // Matches the checkout's labeled field (components/checkout/CheckoutPrimitives
  // CheckoutField): static label above a rounded, bordered box.
  label: {
    color: theme.muted,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    marginBottom: 6,
  },
  inputWrap: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    backgroundColor: theme.background,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    paddingVertical: 12,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  suggestions: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
    backgroundColor: theme.cardElevated,
  },
  suggestion: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  suggestionText: {
    flex: 1,
    color: theme.text,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 19,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: theme.cardElevated,
  },
  noticeIcon: { marginTop: 2 },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 19 },
  noticeBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, lineHeight: 18, marginTop: 2 },
  retry: { alignSelf: 'center', paddingHorizontal: 4, paddingVertical: 4 },
  retryText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  resolveError: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8 },
  resolveErrorText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs + 1, lineHeight: 18 },
  hint: {
    color: theme.subtle,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    lineHeight: 17,
    marginTop: 6,
  },
});