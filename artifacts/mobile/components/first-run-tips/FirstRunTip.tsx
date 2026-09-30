/**
 * <FirstRunTip> — single entry point for the reusable first-run tips system.
 *
 * A screen renders this once, with a unique stable `id` and a `variant`
 * chosen by the content author, plus the variant's own props. It wires up
 * `useFirstRunTip` (seen-state, auth-route exclusion, the "never stacks"
 * lock, reduce-motion) and renders the matching presentational component.
 *
 * Usage:
 *   <FirstRunTip
 *     id="seller-dashboard"
 *     variant="anchored"
 *     contentReady={!loading}
 *     anchored={{ steps: [...], targets: [...] }}
 *   />
 *
 * See hooks/useFirstRunTip.ts for the persistence/eligibility rules and
 * components/first-run-tips/{GestureHintTip,SpotlightTip,AnchoredCardTip,FullScreenGuideTip}
 * for the four presentational variants.
 */
import React from 'react';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useFirstRunTip } from '@/hooks/useFirstRunTip';
import { GestureHintTip, GestureHintTipProps } from './GestureHintTip';
import { SpotlightTip, SpotlightTipProps } from './SpotlightTip';
import { AnchoredCardTip, AnchoredCardTipProps } from './AnchoredCardTip';
import { FullScreenGuideTip, FullScreenGuideTipProps } from './FullScreenGuideTip';
import type { FirstRunTipVariant } from './types';

type VariantProps = {
  gesture: Omit<GestureHintTipProps, 'visible' | 'onDismiss' | 'reduceMotion'>;
  spotlight: Omit<SpotlightTipProps, 'visible' | 'onDismiss' | 'reduceMotion'>;
  anchored: Omit<AnchoredCardTipProps, 'visible' | 'onDismiss' | 'reduceMotion'>;
  fullscreen: Omit<FullScreenGuideTipProps, 'visible' | 'onDismiss' | 'reduceMotion'>;
};

export type FirstRunTipProps<V extends FirstRunTipVariant> = {
  /** Unique, stable id for this screen's tip, e.g. "seller-dashboard". Determines the seen-state key. */
  id: string;
  variant: V;
  /** True once the screen has real content (not a loading skeleton). The tip never shows before this. */
  contentReady: boolean;
  /** Escape hatch to suppress for a screen-specific reason (e.g. another modal is open). */
  suppressed?: boolean;
} & { [K in V]: VariantProps[K] };

export function FirstRunTip<V extends FirstRunTipVariant>(props: FirstRunTipProps<V>) {
  const { id, variant, contentReady, suppressed } = props;
  const { visible, dismiss } = useFirstRunTip(id, { contentReady, suppressed });
  const reduceMotion = useReduceMotion();

  if (variant === 'gesture') {
    const p = (props as unknown as { gesture: VariantProps['gesture'] }).gesture;
    return <GestureHintTip visible={visible} onDismiss={dismiss} reduceMotion={reduceMotion} {...p} />;
  }
  if (variant === 'spotlight') {
    const p = (props as unknown as { spotlight: VariantProps['spotlight'] }).spotlight;
    return <SpotlightTip visible={visible} onDismiss={dismiss} reduceMotion={reduceMotion} {...p} />;
  }
  if (variant === 'anchored') {
    const p = (props as unknown as { anchored: VariantProps['anchored'] }).anchored;
    return <AnchoredCardTip visible={visible} onDismiss={dismiss} reduceMotion={reduceMotion} {...p} />;
  }
  const p = (props as unknown as { fullscreen: VariantProps['fullscreen'] }).fullscreen;
  return <FullScreenGuideTip visible={visible} onDismiss={dismiss} reduceMotion={reduceMotion} {...p} />;
}

export { GestureHintTip, SpotlightTip, AnchoredCardTip, FullScreenGuideTip };
export * from './types';
export { GestureGlyph } from './GestureGlyph';
