/**
 * "Founding Seller #N" — the first 100 sellers on Brandthread (server:
 * api-server lib/foundingSellers.ts, exposed as `foundingSellerNumber` on the
 * public and own seller profile).
 *
 * Pattern copied from Zocdoc's "Patient Choice" badge (Mobbin flow
 * e93c5a18-cd23-4f07-8726-f1c3b4c1f8d6): a small pill with an info glyph
 * beside the profile identity; tapping it opens a short sheet with a close
 * control, a title, one line of explanation and a full-width Close button.
 * Reskinned monochrome for Brandthread.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

export const FOUNDING_SELLER_LIMIT = 100;

/** A valid founding number from an API payload, else null. */
export function foundingSellerNumberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= FOUNDING_SELLER_LIMIT
    ? value
    : null;
}

export function foundingSellerTitle(n: number): string {
  return `Founding Seller #${n}`;
}

export const FOUNDING_SELLER_BODY = `One of the first ${FOUNDING_SELLER_LIMIT} sellers on Brandthread.`;

export function FoundingSellerBadge({ number, testID = 'founding-seller-badge' }: { number: number | null | undefined; testID?: string }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const n = foundingSellerNumberOf(number);
  if (n == null) return null;
  const title = foundingSellerTitle(n);
  return (
    <>
      <PressableScale
        onPress={() => { hapticLight(); setOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel={`${title}. What is this?`}
        style={styles.chip}
        noMinHeight
        testID={testID}
      >
        <Feather name="award" size={11} color={theme.text} />
        <Text style={styles.chipText} numberOfLines={1}>{title}</Text>
        <Feather name="info" size={11} color={theme.muted} />
      </PressableScale>
      <BottomSheet visible={open} onClose={() => setOpen(false)} testID={`${testID}-sheet`}>
        <View style={styles.sheet}>
          <PressableScale
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={styles.close}
          >
            <Feather name="x" size={22} color={theme.text} />
          </PressableScale>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{FOUNDING_SELLER_BODY}</Text>
          <Button label="Close" onPress={() => setOpen(false)} fullWidth testID={`${testID}-close`} />
        </View>
      </BottomSheet>
    </>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
      borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4,
      borderColor: theme.border, backgroundColor: theme.cardGlass,
    },
    chipText: { fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 14, color: theme.text },
    sheet: { paddingHorizontal: SP.lg, paddingTop: SP.xs, paddingBottom: SP.md, gap: SP.sm },
    close: { alignSelf: 'flex-start', marginBottom: SP.xs },
    title: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text },
    body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.muted, marginBottom: SP.md },
  });
}
