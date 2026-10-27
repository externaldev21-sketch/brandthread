/**
 * "You've reached your Starter limit of 5 products" — shown when the server refuses a product
 * create / publish / duplicate / import with 403 PLAN_LIMIT_REACHED.
 *
 * Layout copied 1:1 from Grok's "Get Ultra" upgrade sheet
 * (https://mobbin.com/screens/f6d13969-a642-445e-80f9-274d96486e9a), reskinned:
 * centred title + one line, a rounded card of check rows with what the next
 * plan unlocks, the monthly price, one primary upgrade button and a quiet
 * secondary button under it.
 *
 * Content comes only from lib/productLimitUnlocks (the 403 body + the plan
 * catalogue); the upgrade button opens the existing plans screen.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { buildProductLimitUnlocks, parseProductLimitHit, type ProductLimitUnlocks } from '@/lib/productLimitUnlocks';

export function ProductLimitSheet({ unlocks, onClose }: { unlocks: ProductLimitUnlocks | null; onClose: () => void }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // Keep the last content mounted through the close animation.
  const last = useRef<ProductLimitUnlocks | null>(unlocks);
  if (unlocks) last.current = unlocks;
  const u = unlocks ?? last.current;

  return (
    <BottomSheet visible={!!unlocks} onClose={onClose} testID="product-limit-sheet">
      {u ? (
        <View style={s.body}>
          <Text style={s.title} accessibilityRole="header">{u.title}</Text>
          <Text style={s.subtitle}>Upgrade to {u.planName} to list more.</Text>
          <View style={s.card}>
            {u.rows.map((row, i) => (
              <View key={row.label} style={[s.row, i < u.rows.length - 1 && s.rowDivider]}>
                <Feather name="check" size={18} color={theme.text} style={s.check} />
                <Text style={s.rowLabel}>{row.label}</Text>
                {row.now ? <Text style={[s.rowNow, TABULAR_NUMS]}>{row.now}</Text> : null}
              </View>
            ))}
          </View>
          <Text style={[s.price, TABULAR_NUMS]}>{u.price}</Text>
          <Button
            label={u.cta}
            fullWidth
            onPress={() => { onClose(); router.push(u.href as never); }}
            testID="product-limit-upgrade"
          />
          <Button label="Not now" variant="tertiary" fullWidth onPress={onClose} style={s.secondary} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

/**
 * For screens with a product create/publish/duplicate/import call:
 *   const limit = useProductLimitSheet();
 *   catch (err) { if (limit.showFor(err)) return; ... }
 *   ...
 *   {limit.sheet}
 */
export function useProductLimitSheet() {
  const [unlocks, setUnlocks] = useState<ProductLimitUnlocks | null>(null);
  const showFor = useCallback((error: unknown): boolean => {
    const hit = parseProductLimitHit(error);
    const built = hit ? buildProductLimitUnlocks(hit) : null;
    if (!built) return false;
    setUnlocks(built);
    return true;
  }, []);
  const sheet = <ProductLimitSheet unlocks={unlocks} onClose={() => setUnlocks(null)} />;
  return { showFor, sheet };
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  body: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.sm },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  subtitle: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', marginTop: SP.xs },
  card: {
    marginTop: SP.lg, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    backgroundColor: theme.surface, paddingHorizontal: SP.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: SP.sm },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  check: { marginRight: SP.sm },
  rowLabel: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  rowNow: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginLeft: SP.sm },
  price: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center', marginTop: SP.lg, marginBottom: SP.md },
  secondary: { marginTop: SP.xs },
});
