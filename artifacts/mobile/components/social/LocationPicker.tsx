import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type PlaceInfo, type PlaceSearchResult } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

const DEBOUNCE_MS = 250;

const DEMO_RESULTS: PlaceSearchResult[] = [
  { id: 'preview-place-1', name: 'Café de Flore', city: 'Paris', country: 'France', source: 'local', postCount: 128 },
  { id: 'preview-place-2', name: 'Pier 39', city: 'San Francisco', region: 'CA', country: 'United States', source: 'local', postCount: 64 },
  { id: 'preview-place-3', name: 'Shibuya Crossing', city: 'Tokyo', country: 'Japan', source: 'local', postCount: 41 },
];

export interface LocationPickerProps {
  /** Currently selected place, shown as a removable row. */
  value?: PlaceInfo | { id: string; name: string } | null;
  /** Called with a saved place (it always has an id). */
  onSelect: (place: PlaceInfo | { id: string; name: string }) => void;
  /** Called when the selected place is removed. Omit to hide the remove control. */
  onClear?: () => void;
  /** Bias results toward the device location when the caller has it. */
  coords?: { lat: number; lng: number };
  placeholder?: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

const secondaryLine = (r: PlaceSearchResult): string => {
  if (r.secondary) return r.secondary;
  const parts = [r.city, r.region, r.country].filter(Boolean) as string[];
  return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
};

/**
 * Search field + results list for tagging a post with a place.
 *
 * Results come from /api/places/search (existing places, plus Google Places
 * suggestions when the server has GOOGLE_PLACES_API_KEY). Picking a suggestion
 * that is not saved yet, or the "Add <name>" row, find-or-creates the place via
 * POST /api/places first, so `onSelect` always gets a place with an id to send
 * as `placeId` on POST/PATCH /api/posts.
 */
export function LocationPicker({ value, onSelect, onClear, coords, placeholder = 'Search for a place', autoFocus, style }: LocationPickerProps) {
  const { theme } = useAppTheme();
  const api = useApi();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const preview = isBuyerDevPreview();
  const demo = preview && isPreviewDemoMode();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    setError(null);
    if (!trimmed) { setResults([]); setSearching(false); return; }
    if (preview) {
      const q = trimmed.toLowerCase();
      setResults(demo ? DEMO_RESULTS.filter((r) => r.name.toLowerCase().includes(q)) : []);
      return;
    }
    const id = ++seq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.places.search(trimmed, coords);
        if (id === seq.current) setResults(res.places);
      } catch {
        if (id === seq.current) setResults([]);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, trimmed, coords?.lat, coords?.lng, preview, demo]);

  const pick = async (result: PlaceSearchResult, key: string) => {
    if (savingKey) return;
    hapticSelection();
    if (result.id) { onSelect(result as PlaceInfo); setQuery(''); return; }
    if (preview) { onSelect({ id: `preview-place-${key}`, name: result.name }); setQuery(''); return; }
    setSavingKey(key);
    setError(null);
    try {
      const saved = await api.places.save({
        name: result.name,
        providerPlaceId: result.providerPlaceId,
        ...(typeof result.lat === 'number' && typeof result.lng === 'number' ? { lat: result.lat, lng: result.lng } : {}),
      });
      onSelect(saved.place);
      setQuery('');
    } catch (err: any) {
      setError(err?.status === 422 ? 'That place name isn’t allowed.' : 'Couldn’t save this place. Try again.');
    } finally {
      setSavingKey(null);
    }
  };

  const hasExact = results.some((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase());
  const showCustom = trimmed.length > 0 && !hasExact && !searching;

  return (
    <View style={[styles.root, style]} testID="location-picker">
      {value ? (
        <View style={[styles.selected, { borderColor: theme.border, backgroundColor: theme.surface }]} testID="location-picker-selected">
          <Icon name="map-pin" size={16} color={theme.text} />
          <Text style={styles.selectedText}>{value.name}</Text>
          {onClear ? (
            <TouchableOpacity
              onPress={() => { hapticSelection(); onClear(); }}
              accessibilityRole="button"
              accessibilityLabel="Remove location"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              testID="location-picker-clear"
            >
              <Icon name="x" size={18} color={theme.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.field, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Icon name="search" size={16} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          style={[styles.input, { color: theme.text }]}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="search"
          maxLength={100}
          testID="location-picker-input"
          accessibilityLabel="Search places"
        />
        {searching ? <ActivityIndicator size="small" color={theme.muted} /> : null}
        {query.length > 0 && !searching ? (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="x-circle" size={16} color={theme.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={[styles.error, { color: theme.text }]}>{error}</Text> : null}

      <View testID="location-picker-results">
        {results.map((result, index) => {
          const key = result.id ?? result.providerPlaceId ?? String(index);
          const secondary = secondaryLine(result);
          return (
            <TouchableOpacity
              key={key}
              style={styles.row}
              onPress={() => void pick(result, key)}
              accessibilityRole="button"
              accessibilityLabel={`${result.name}${secondary ? `, ${secondary}` : ''}`}
              testID={`location-result-${index}`}
            >
              <View style={[styles.pin, { borderColor: theme.border }]}>
                {savingKey === key ? <ActivityIndicator size="small" color={theme.muted} /> : <Icon name="map-pin" size={16} color={theme.muted} />}
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: theme.text }]}>{result.name}</Text>
                {secondary ? <Text style={[styles.secondary, { color: theme.muted }]}>{secondary}</Text> : null}
              </View>
              {result.postCount > 0 ? (
                <Text style={[styles.count, { color: theme.muted }]}>{result.postCount} {result.postCount === 1 ? 'post' : 'posts'}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
        {showCustom ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => void pick({ name: trimmed, source: 'local', postCount: 0 }, 'custom')}
            accessibilityRole="button"
            accessibilityLabel={`Add ${trimmed} as a new place`}
            testID="location-result-custom"
          >
            <View style={[styles.pin, { borderColor: theme.border }]}>
              {savingKey === 'custom' ? <ActivityIndicator size="small" color={theme.muted} /> : <Icon name="plus" size={16} color={theme.muted} />}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.text }]}>Add {'“'}{trimmed}{'”'}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { gap: SPACING.sm },
  selected: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, minHeight: 44, borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  selectedText: { ...TYPE_SCALE.body, color: theme.text, fontFamily: FONT.semibold, flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, minHeight: 44, borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: SPACING.md },
  input: { ...TYPE_SCALE.body, flex: 1, minHeight: 44, paddingVertical: 0 },
  error: { ...TYPE_SCALE.footnote },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 56, paddingVertical: SPACING.xs },
  pin: { width: 36, height: 36, borderRadius: RADII.avatar, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  secondary: { ...TYPE_SCALE.footnote, marginTop: 1 },
  count: { ...TYPE_SCALE.footnote },
});

export default LocationPicker;
