/**
 * Settings > About > Open-source licenses.
 *
 * Lists the app's direct dependencies with the version and license declared
 * by each installed package. The data is generated, not hand-written:
 *   node scripts/generate-licenses.mjs   (writes content/open-source-licenses.json)
 * Tapping a row opens the package's npm page.
 */
import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { TYPE_SCALE } from '@/constants/typography';
import { npmPackageUrl, OPEN_SOURCE_LICENSES } from '@/lib/openSourceLicenses';

export default function OpenSourceLicensesScreen() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [error, setError] = useState('');
  const entries = OPEN_SOURCE_LICENSES;

  async function openPackage(name: string) {
    setError('');
    try {
      await Linking.openURL(npmPackageUrl(name));
    } catch {
      setError(`Couldn't open the npm page for ${name}.`);
    }
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Open-source licenses" variant="push" onBack={() => goBackOr(router)} />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        <Text style={[TYPE_SCALE.footnote, s.intro]}>
          Brandthread is built with these open-source packages. Tap one to see its project page and full license text.
        </Text>
        {error ? <Text testID="open-source-licenses-error" style={[TYPE_SCALE.footnote, s.error]}>{error}</Text> : null}
        <Card style={s.card}>
          {entries.map((entry, i) => (
            <React.Fragment key={entry.name}>
              <ListRow
                testID={`license-row-${entry.name}`}
                title={entry.name}
                subtitle={`${entry.version} · ${entry.license}`}
                chevron
                onPress={() => { void openPackage(entry.name); }}
              />
              {i !== entries.length - 1 ? <View style={s.divider} /> : null}
            </React.Fragment>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { color: colors.mutedForeground, marginBottom: SP.md },
  error: { color: colors.destructive, marginBottom: SP.sm },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
