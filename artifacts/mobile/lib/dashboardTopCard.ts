/**
 * The dashboard's one top-card slot (components/dashboard/DashboardTopCard).
 * Each feature offers a candidate with a priority; the slot shows only the
 * highest-priority visible one, so the dashboard never stacks promo cards.
 *
 * Priorities (higher wins). Milestones outrank the morning brief because a
 * milestone shows once ever, while tomorrow brings a new brief.
 */
export const TOP_CARD_PRIORITY = {
  milestone: 200,
  morningBrief: 100,
} as const;

export interface TopCardCandidate {
  key: string;
  priority: number;
  visible: boolean;
}

/**
 * The winning candidate, or null. `blocked` is true while the dashboard is
 * showing its zero-orders setup card in the body, which already is that
 * screen's one prompt.
 */
export function pickTopCard<T extends TopCardCandidate>(candidates: readonly T[], opts: { blocked?: boolean } = {}): T | null {
  if (opts.blocked) return null;
  let best: T | null = null;
  for (const c of candidates) {
    if (!c.visible) continue;
    if (!best || c.priority > best.priority) best = c;
  }
  return best;
}
