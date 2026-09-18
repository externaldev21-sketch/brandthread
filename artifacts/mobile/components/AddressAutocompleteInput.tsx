import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useApi } from '@/hooks/useApi';
import { BORDER, CARD_ELEVATED, FG, FONT, FS, MUTED, SP, SUBTLE } from '@/lib/theme';

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
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const query = value.trim();
    const generation = ++requestGeneration.current;
    if (query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      void api.buyer.addresses.autocomplete(query, country)
        .then(rows => {
          if (requestGeneration.current === generation) setSuggestions(rows);
        })
        .catch(() => {
          if (requestGeneration.current === generation) setSuggestions([]);
        })
        .finally(() => {
          if (requestGeneration.current === generation) setLoading(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [api, country, value]);

  async function chooseSuggestion(suggestion: AddressSuggestion) {
    if (resolving) return;
    setResolving(suggestion.placeId);
    try {
      const selected = await api.buyer.addresses.resolveSuggestion(suggestion.placeId);
      requestGeneration.current += 1;
      setSuggestions([]);
      onSelect(selected);
    } catch {
      Alert.alert('Address unavailable', 'We could not load that address. Choose another suggestion or enter it manually.');
    } finally {
      setResolving(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Shipping address</Text>
      <View style={styles.inputWrap}>
        <Feather name="search" size={17} color={MUTED} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Start typing your street address"
          placeholderTextColor={SUBTLE}
          autoCapitalize="words"
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          accessibilityLabel="Shipping address search"
          style={styles.input}
        />
        {loading ? <ActivityIndicator size="small" color={FG} /> : null}
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
              <Feather name="map-pin" size={16} color={MUTED} />
              <Text style={styles.suggestionText} numberOfLines={2}>{suggestion.label}</Text>
              {resolving === suggestion.placeId
                ? <ActivityIndicator size="small" color={FG} />
                : <Feather name="chevron-right" size={16} color={SUBTLE} />}
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.hint}>Choose a suggestion to fill city, state, postal code, and country. Powered by Google.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: SP.sm },
  label: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    marginBottom: 6,
  },
  inputWrap: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    color: FG,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    paddingVertical: 12,
  },
  suggestions: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
  },
  suggestion: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  suggestionText: {
    flex: 1,
    color: FG,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 19,
  },
  hint: {
    color: SUBTLE,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    lineHeight: 17,
    marginTop: 6,
  },
});