/**
 * Creator commission input: "10%" with − / + buttons, limited to the 5–10%
 * range the server enforces (lib/commissionRange.ts). Layout follows Shopify's
 * catalog "Overall adjustment" percent stepper. A stored rate from before the
 * range existed is shown as-is; the first tap moves it back inside the range.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { COMMISSION_MAX_PERCENT, COMMISSION_MIN_PERCENT, stepCommission } from '@/lib/commissionRange';

export function CommissionStepper({ label, value, onChange, disabled, testID }: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginBottom: 6 },
    box: {
      flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
      borderRadius: RADIUS.md, paddingLeft: SP.md, paddingRight: 6, minHeight: 48,
    },
    value: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    btn: {
      width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surface, marginLeft: 6,
    },
  }), [theme]);

  const canDown = !disabled && value > COMMISSION_MIN_PERCENT;
  const canUp = !disabled && value < COMMISSION_MAX_PERCENT;
  const pct = `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '')}%`;

  return (
    <View testID={testID}>
      <Text style={s.label}>{label}</Text>
      <View style={s.box}>
        <Text style={s.value} accessibilityLabel={`${label} ${pct}`}>{pct}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Lower ${label.toLowerCase()}`}
          disabled={!canDown}
          onPress={() => onChange(stepCommission(value, -1))}
          style={[s.btn, !canDown && { opacity: 0.4 }]}
          hitSlop={6}
          testID={testID ? `${testID}-down` : undefined}
        >
          <Feather name="minus" size={16} color={theme.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Raise ${label.toLowerCase()}`}
          disabled={!canUp}
          onPress={() => onChange(stepCommission(value, 1))}
          style={[s.btn, !canUp && { opacity: 0.4 }]}
          hitSlop={6}
          testID={testID ? `${testID}-up` : undefined}
        >
          <Feather name="plus" size={16} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}
