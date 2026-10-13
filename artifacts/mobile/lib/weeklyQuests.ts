/**
 * Thread Cash weekly quests: response types and the small pure helpers the
 * WeeklyQuestsSection renders from. Progress is always counted by the
 * server (GET /api/thread-cash/weekly-quests); the client never reports it.
 */
export type WeeklyQuest = { id: string; title: string; progress: number; target: number };

export type WeeklyQuestsStatus = {
  weekKey: string;
  /** Next Monday 00:00 in the buyer's timezone, ISO. */
  endsAt: string;
  quests: WeeklyQuest[];
  rewardCents: number;
  claimed: boolean;
  /** Consecutive local ISO weeks with the reward claimed. */
  weekStreak: number;
};

export type WeeklyQuestsClaimResult = WeeklyQuestsStatus & {
  ok: boolean;
  created: boolean;
  amountCents: number;
  balanceCents: number;
};

export function questFraction(quest: WeeklyQuest): number {
  if (quest.target <= 0) return 1;
  return Math.max(0, Math.min(1, quest.progress / quest.target));
}

export function isQuestComplete(quest: WeeklyQuest): boolean {
  return quest.progress >= quest.target;
}

export function completedQuestCount(status: WeeklyQuestsStatus): number {
  return status.quests.filter(isQuestComplete).length;
}

export function allQuestsComplete(status: WeeklyQuestsStatus): boolean {
  return status.quests.length > 0 && status.quests.every(isQuestComplete);
}

/** "3 days", "1 day", "5 hours", "1 hour", "12 min" — time until the week resets. */
export function timeLeftLabel(endsAt: string, now: Date = new Date()): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '0 min';
  const hours = ms / 3_600_000;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (hours >= 1) {
    const h = Math.floor(hours);
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/** Next local Monday 00:00 after `now` (device timezone), for preview data. */
export function nextLocalMonday(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + daysUntil);
  return d;
}

const QUEST_TITLES: Array<[string, string, number]> = [
  ['open_days', 'Open Brandthread on 3 days', 3],
  ['save_products', 'Save 3 pieces', 3],
  ['follow_brands', 'Follow 2 brands', 2],
];

/**
 * Preview-only data (signed-out/dev web preview never calls the protected
 * API): a fresh week at zero, or with `&demo=1` a week in progress.
 */
export function previewWeeklyQuests(demo: boolean, now: Date = new Date()): WeeklyQuestsStatus {
  const demoProgress = [2, 1, 2];
  return {
    weekKey: 'preview',
    endsAt: nextLocalMonday(now).toISOString(),
    quests: QUEST_TITLES.map(([id, title, target], i) => ({ id, title, target, progress: demo ? demoProgress[i] : 0 })),
    rewardCents: 50,
    claimed: false,
    weekStreak: demo ? 3 : 0,
  };
}
