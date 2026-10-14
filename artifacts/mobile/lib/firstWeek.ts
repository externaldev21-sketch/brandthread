/** First-week checklist (GET /api/first-week). Pure; the card is components/FirstWeekCard.tsx. */

export type FirstWeekStepId = 'follow_brands' | 'post_fit' | 'save_item' | 'profile_photo' | 'add_products' | 'share_store';

export interface FirstWeekState {
  visible: boolean;
  role?: 'buyer' | 'seller';
  steps: Array<{ id: FirstWeekStepId; label: string; done: boolean; href: string }>;
  allDone: boolean;
  reward: { cents: number; granted: boolean } | null;
}

/** "2 of 4" */
export function progressLabel(state: Pick<FirstWeekState, 'steps'>): string {
  const done = state.steps.filter((s) => s.done).length;
  return `${done} of ${state.steps.length}`;
}

/** The line under the title, or null when there's nothing true to say. */
export function rewardLine(state: Pick<FirstWeekState, 'reward' | 'allDone' | 'steps'>, formatCents: (c: number) => string): string | null {
  if (!state.reward) return null;
  const amount = formatCents(state.reward.cents);
  if (state.reward.granted) return `${amount} Thread Cash added`;
  return `Finish all ${state.steps.length} for ${amount} Thread Cash`;
}
