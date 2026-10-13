/**
 * "Usage limits" section of the discount code form (app/discounts.tsx), in
 * the order of Shopify's "Maximum discount uses": a total limit, then a
 * per-customer limit (1 by default, i.e. "one use per customer"), then the
 * existing "First order only" switch.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export interface UsageLimitsForm {
  limitTotal: boolean;
  totalLimit: string;
  limitPerCustomer: boolean;
  perCustomerLimit: string;
  firstOrderOnly: boolean;
}

export function usageLimitsFromStored(d: {
  maxUses: number | null; oneUsePerCustomer: boolean; maxUsesPerCustomer?: number | null; firstOrderOnly: boolean;
} | null): UsageLimitsForm {
  if (!d) return { limitTotal: false, totalLimit: '100', limitPerCustomer: false, perCustomerLimit: '1', firstOrderOnly: false };
  const perCustomer = d.maxUsesPerCustomer ?? (d.oneUsePerCustomer ? 1 : null);
  return {
    limitTotal: d.maxUses != null,
    totalLimit: d.maxUses != null ? String(d.maxUses) : '100',
    limitPerCustomer: perCustomer != null,
    perCustomerLimit: perCustomer != null ? String(perCustomer) : '1',
    firstOrderOnly: d.firstOrderOnly,
  };
}

/** API fields for the form, or an error message to show. */
export function usageLimitsPayload(f: UsageLimitsForm):
  | { error: string }
  | { values: { maxUses: number | null; maxUsesPerCustomer: number | null; oneUsePerCustomer: boolean; firstOrderOnly: boolean } } {
  const total = Number(f.totalLimit);
  const each = Number(f.perCustomerLimit);
  if (f.limitTotal && !(Number.isInteger(total) && total >= 1)) return { error: 'Enter how many times this code can be used in total.' };
  if (f.limitPerCustomer && !(Number.isInteger(each) && each >= 1)) return { error: 'Enter how many times each customer can use this code.' };
  return {
    values: {
      maxUses: f.limitTotal ? total : null,
      maxUsesPerCustomer: f.limitPerCustomer ? each : null,
      oneUsePerCustomer: f.limitPerCustomer && each === 1,
      firstOrderOnly: f.firstOrderOnly,
    },
  };
}

export function usageSummary(f: UsageLimitsForm): string {
  const parts = [f.limitTotal ? `${f.totalLimit || '0'} total use${f.totalLimit === '1' ? '' : 's'}` : 'Unlimited uses'];
  if (f.limitPerCustomer) parts.push(f.perCustomerLimit === '1' ? '1 per customer' : `${f.perCustomerLimit || '0'} per customer`);
  if (f.firstOrderOnly) parts.push('First order only');
  return parts.join(' · ');
}

export function UsageLimitsFields({ value, onChange }: { value: UsageLimitsForm; onChange: (next: UsageLimitsForm) => void }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const set = (patch: Partial<UsageLimitsForm>) => onChange({ ...value, ...patch });
  const digits = (t: string) => t.replace(/[^0-9]/g, '').slice(0, 6);

  return (
    <View>
      <Text style={s.label}>Usage limits</Text>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Limit number of times this discount can be used in total</Text>
        <HapticSwitch value={value.limitTotal} onValueChange={(on) => set({ limitTotal: on })} accessibilityLabel="Limit total uses" />
      </View>
      {value.limitTotal && (
        <TextInput
          style={[s.input, WEB_INPUT_RESET]}
          value={value.totalLimit}
          onChangeText={(t) => set({ totalLimit: digits(t) })}
          placeholder="100"
          placeholderTextColor={theme.muted}
          keyboardType="number-pad"
          accessibilityLabel="Total uses"
        />
      )}
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Limit uses per customer</Text>
        <HapticSwitch value={value.limitPerCustomer} onValueChange={(on) => set({ limitPerCustomer: on })} accessibilityLabel="Limit uses per customer" />
      </View>
      {value.limitPerCustomer && (
        <View style={s.inlineRow}>
          <TextInput
            style={[s.input, s.shortInput, WEB_INPUT_RESET]}
            value={value.perCustomerLimit}
            onChangeText={(t) => set({ perCustomerLimit: digits(t) })}
            placeholder="1"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            accessibilityLabel="Uses per customer"
          />
          <Text style={s.inlineSuffix}>{value.perCustomerLimit === '1' ? 'use per customer' : 'uses per customer'}</Text>
        </View>
      )}
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>First order only</Text>
        <HapticSwitch value={value.firstOrderOnly} onValueChange={(on) => set({ firstOrderOnly: on })} />
      </View>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  label: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md, marginTop: SP.sm },
  switchLabel: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  input: {
    marginTop: SP.sm, backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: 12, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm,
  },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  shortInput: { width: 72, textAlign: 'center' },
  inlineSuffix: { marginTop: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
});
