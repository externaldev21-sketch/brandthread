/**
 * Intl #107: Currency — the buyer's display currency.
 *
 * Reference (copied 1:1, reskinned): MoonPay iOS "Currency" settings screen
 * https://mobbin.com/screens/9d4e6fe2-f2e9-4d89-8460-0003cf809143 —
 * back arrow + "Currency" title, a search field, a "Popular currencies"
 * card, an "All currencies" card, each row the currency name over its code
 * with a check on the selected one. Searching collapses to one result list.
 * MoonPay's colour flag icons are left out (black / white / silver only).
 *
 * Display only: prices gain an "≈" line in this currency; every charge
 * stays in US dollars.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSearchBar } from '@/components/settings/SettingsKit';
import { ListRow } from '@/components/ui';
import { useApi } from '@/lib/api';
import { hapticSelection } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { FONT, FS, SP } from '@/lib/theme';
import {
  CURRENCIES, POPULAR_CURRENCY_CODES, applyAccountCurrency, filterCurrencies, setDisplayCurrency, useDisplayCurrency, type CurrencyOption,
} from '@/lib/displayCurrency';

type Section = { title: string | null; data: CurrencyOption[] };

export default function CurrencyScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { currency } = useDisplayCurrency(api);
  const [query, setQuery] = useState('');

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) return [{ title: null, data: filterCurrencies(query) }];
    const popular = POPULAR_CURRENCY_CODES
      .map(code => CURRENCIES.find(c => c.code === code))
      .filter((c): c is CurrencyOption => !!c);
    return [
      { title: 'Popular currencies', data: popular },
      { title: 'All currencies', data: CURRENCIES.filter(c => !(POPULAR_CURRENCY_CODES as readonly string[]).includes(c.code)) },
    ];
  }, [query]);

  // The account's saved choice wins over this device's copy.
  useEffect(() => {
    if (!isSignedIn) return;
    api.fx.getDisplayCurrency().then((r) => applyAccountCurrency(r?.displayCurrency)).catch(() => {});
  }, [api, isSignedIn]);

  async function choose(code: string) {
    hapticSelection();
    const previous = currency;
    await setDisplayCurrency(code);
    if (isSignedIn) {
      try {
        await api.fx.setDisplayCurrency(code);
      } catch (err) {
        // Not saved on the account: put the device back and say so.
        await setDisplayCurrency(previous);
        showAlert("Couldn't change currency", friendlyError(err, 'Try again.'));
        return;
      }
    }
    goBackOr(router);
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Currency" onBack={() => goBackOr(router)} />
      <SectionList
        sections={sections}
        keyExtractor={item => item.code}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + 48 }}
        ListHeaderComponent={
          <View style={s.search}>
            <SettingsSearchBar value={query} onChangeText={setQuery} placeholder="Search" />
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={s.sectionTitle} accessibilityRole="header">{section.title}</Text> : null
        }
        renderSectionFooter={() => <View style={{ height: SP.lg }} />}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          const selected = item.code === currency;
          return (
            <View style={[s.rowCard, first && s.rowFirst, last && s.rowLast]}>
              <ListRow
                title={item.name}
                subtitle={item.code}
                onPress={() => choose(item.code)}
                right={selected ? <Feather name="check" size={18} color={colors.foreground} /> : undefined}
                testID={`currency-${item.code}`}
              />
              {!last ? <View style={s.divider} /> : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={s.empty}>No currencies match “{query.trim()}”</Text>}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    search: { paddingTop: SP.sm, marginBottom: SP.sm },
    sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: colors.foreground, marginBottom: SP.sm },
    rowCard: {
      backgroundColor: colors.card,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: SP.md,
    },
    rowFirst: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    empty: { fontFamily: FONT.regular, fontSize: FS.base, color: colors.mutedForeground, textAlign: 'center', marginTop: SP.lg },
  });
}
