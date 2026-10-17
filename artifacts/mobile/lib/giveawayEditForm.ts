/**
 * Edit mode for app/seller-giveaway-create.tsx (PATCH /api/seller/giveaways/:id).
 * Pure helpers so the prefill / lock / payload rules are unit-tested.
 *
 * Server rules mirrored here (routes/giveaways.ts PATCH): only `status: 'open'`
 * giveaways are editable, and once a giveaway has started its entry post and
 * start time are locked.
 */

const DAY_MS = 86_400_000;

export interface ServerGiveaway {
  id: string;
  title: string;
  prizeText: string;
  productId: string | null;
  postId: string | null;
  startsAt: string;
  endsAt: string;
  rulesText: string;
  eligibility: string;
  region: string;
  winnerCount: number;
  status: string;
  phase: string;
}

export interface GiveawayForm {
  title: string;
  prize: string;
  winners: string;
  days: string;
  region: string;
  eligibility: string;
  rules: string;
  postId: string | null;
  productId: string | null;
}

/** Editable while open and not yet past its end (upcoming or live). */
export function canEditGiveaway(g: Pick<ServerGiveaway, 'status' | 'phase'> | null | undefined): boolean {
  return !!g && g.status === 'open' && (g.phase === 'upcoming' || g.phase === 'live');
}

/** Entry post (and start) can't change once the giveaway has started. */
export function isStartLocked(g: Pick<ServerGiveaway, 'startsAt'>, now: number = Date.now()): boolean {
  return now >= new Date(g.startsAt).getTime();
}

export function durationDays(startsAt: string, endsAt: string): number {
  return Math.max(1, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / DAY_MS));
}

export function formFromGiveaway(g: ServerGiveaway): GiveawayForm {
  return {
    title: g.title ?? '',
    prize: g.prizeText ?? '',
    winners: String(g.winnerCount ?? 1),
    days: String(durationDays(g.startsAt, g.endsAt)),
    region: g.region ?? '',
    eligibility: g.eligibility ?? '',
    rules: g.rulesText ?? '',
    postId: g.postId ?? null,
    productId: g.productId ?? null,
  };
}

/**
 * Chip options including the giveaway's current value when it isn't one of
 * the presets, so a prefilled form always shows its selection.
 */
export function withCurrentOption(
  options: Array<{ id: string; label: string }>,
  current: string,
  label: (id: string) => string,
): Array<{ id: string; label: string }> {
  if (!current || options.some((o) => o.id === current)) return options;
  return [...options, { id: current, label: label(current) }]
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/** Edit mode: drop lengths that would already be over (never end a live giveaway by accident). */
export function availableDurations(
  options: Array<{ id: string; label: string }>,
  startsAt: string,
  now: number = Date.now(),
): Array<{ id: string; label: string }> {
  const start = new Date(startsAt).getTime();
  return options.filter((o) => start + Number(o.id) * DAY_MS > now);
}

/** PATCH body: start stays fixed; the length moves the end relative to it. */
export function buildGiveawayPatch(g: ServerGiveaway, form: GiveawayForm, now: number = Date.now()) {
  const locked = isStartLocked(g, now);
  const start = new Date(g.startsAt).getTime();
  return {
    title: form.title.trim(),
    prizeText: form.prize.trim(),
    winnerCount: Number(form.winners),
    startsAt: g.startsAt,
    endsAt: new Date(start + Number(form.days) * DAY_MS).toISOString(),
    postId: locked ? g.postId : form.postId,
    productId: form.productId,
    region: form.region,
    eligibility: form.eligibility,
    rulesText: form.rules,
  };
}
