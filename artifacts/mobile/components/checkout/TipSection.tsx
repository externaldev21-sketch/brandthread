/**
 * TIP: shown in the in-app checkout for each seller whose Checkout settings
 * turn tipping on (the server quote's `tippingEnabled`). Three presets of the
 * seller's item subtotal or a custom amount; the server re-checks the tip,
 * adds it to that seller's total and pays it out with the order.
 */
import React from 'react';
import { formatCents } from '@/lib/money';
import { TIP_PRESET_PERCENTS, maxTipCents, percentTipCents, tipCentsFor, type TipChoice } from '@/lib/checkoutTips';
import { CheckoutField, CheckoutSection, OptionRow } from './CheckoutPrimitives';

export function TipSection({
  groups, choices, onChange,
}: {
  /** Sellers in this order that accept tips. */
  groups: Array<{ sellerId: string; sellerName: string; subtotalCents: number }>;
  choices: Record<string, TipChoice>;
  onChange: (sellerId: string, choice: TipChoice) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map(group => {
        const choice = choices[group.sellerId] ?? { kind: 'none' as const };
        const customInvalid = choice.kind === 'custom' && tipCentsFor(choice, group.subtotalCents) == null;
        return (
          <CheckoutSection
            key={group.sellerId}
            title={groups.length > 1 ? `Tip ${group.sellerName}` : 'Tip'}
            testID={`checkout-tip-${group.sellerId}`}
          >
            <OptionRow
              selected={choice.kind === 'none'}
              onPress={() => onChange(group.sellerId, { kind: 'none' })}
              title="No tip"
            />
            {TIP_PRESET_PERCENTS.map(percent => (
              <OptionRow
                key={percent}
                selected={choice.kind === 'percent' && choice.percent === percent}
                onPress={() => onChange(group.sellerId, { kind: 'percent', percent })}
                title={`${percent}% · ${formatCents(percentTipCents(group.subtotalCents, percent))}`}
              />
            ))}
            <OptionRow
              selected={choice.kind === 'custom'}
              onPress={() => onChange(group.sellerId, { kind: 'custom', text: choice.kind === 'custom' ? choice.text : '' })}
              title="Custom amount"
              last={choice.kind !== 'custom'}
            />
            {choice.kind === 'custom' ? (
              <CheckoutField
                label="Tip amount"
                value={choice.text}
                onChangeText={text => onChange(group.sellerId, { kind: 'custom', text })}
                error={customInvalid ? `Enter an amount up to ${formatCents(maxTipCents(group.subtotalCents))}` : undefined}
                showError
                placeholder="0.00"
                keyboardType="decimal-pad"
                returnKeyType="done"
                testID={`checkout-tip-input-${group.sellerId}`}
              />
            ) : null}
          </CheckoutSection>
        );
      })}
    </>
  );
}
