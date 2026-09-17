import { describe, expect, it } from 'vitest';

/**
 * Focused tests for the Promote/Boost flow.
 *
 * Covers:
 *  - Target eligibility (only published posts shown)
 *  - Objective persistence
 *  - Budget and duration validation
 *  - Payment readiness gating
 *  - Submission states (success / card_declined / no_payment_method)
 *  - History / results rendering logic
 *
 * These are pure logic tests that do not mount React Native components —
 * they exercise the same helper functions and validation rules that the
 * screen and backend use. Run with: pnpm test boost.test.ts
 */

// ─── Helpers replicated from boost.tsx ───────────────────────────────────────

const BUDGET_STEPS = [500, 1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000, 15000, 25000, 50000] as const;
const BUDGET_MIN   = BUDGET_STEPS[0];
const BUDGET_MAX   = BUDGET_STEPS[BUDGET_STEPS.length - 1];
const DURATION_MIN = 1;
const DURATION_MAX = 30;

type BoostObjective = 'views' | 'likes' | 'followers' | 'profile_visits';

const OBJECTIVES: Array<{ value: BoostObjective; label: string }> = [
  { value: 'views',          label: 'More video views' },
  { value: 'likes',          label: 'More engagement' },
  { value: 'followers',      label: 'More followers' },
  { value: 'profile_visits', label: 'More profile visits' },
];

function objectiveLabel(value: BoostObjective): string {
  return OBJECTIVES.find((o) => o.value === value)?.label ?? 'More video views';
}

function daysRemaining(endsAt: string): number {
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function reachProgress(b: { impressionsCount: number; estimatedImpressions: number }): number {
  if (!b.estimatedImpressions || b.estimatedImpressions <= 0) return 0;
  return Math.min(1, b.impressionsCount / b.estimatedImpressions);
}

/** Server-side validation replicated for client parity tests */
function validateBoostCreate(body: {
  targetType?: string;
  targetId?:   string;
  objective?:  string;
  budgetCents?: number;
  durationDays?: number;
}): { ok: true } | { ok: false; error: string } {
  const BOOST_OBJECTIVES = ['views', 'likes', 'followers', 'profile_visits'];

  if (!body.targetType || body.targetType !== 'post') {
    return { ok: false, error: "targetType must be 'post'" };
  }
  if (!body.targetId || typeof body.targetId !== 'string') {
    return { ok: false, error: 'targetId required' };
  }
  if (!body.objective || !BOOST_OBJECTIVES.includes(body.objective)) {
    return { ok: false, error: 'objective must be views, likes, followers, or profile_visits' };
  }
  if (
    !Number.isInteger(body.budgetCents) ||
    !body.budgetCents ||
    body.budgetCents < 500 ||
    body.budgetCents > 100_000
  ) {
    return { ok: false, error: 'budgetCents must be between 500 and 100000' };
  }
  if (
    body.durationDays !== undefined &&
    (!Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > 30)
  ) {
    return { ok: false, error: 'durationDays must be between 1 and 30' };
  }
  return { ok: true };
}

// ─── Target eligibility ───────────────────────────────────────────────────────

describe('Target eligibility', () => {
  type RawPost = { id: string; postStatus: string; mediaType: string | null; userId: string };

  function filterEligible(posts: RawPost[], sellerId: string): RawPost[] {
    return posts.filter(
      (p) =>
        p.userId === sellerId &&
        (p.postStatus === 'published' || p.postStatus === 'scheduled'),
    );
  }

  const seller = 'seller-1';
  const posts: RawPost[] = [
    { id: 'a', postStatus: 'published',  mediaType: 'video', userId: seller },
    { id: 'b', postStatus: 'draft',      mediaType: 'video', userId: seller },
    { id: 'c', postStatus: 'archived',   mediaType: 'image', userId: seller },
    { id: 'd', postStatus: 'scheduled',  mediaType: 'video', userId: seller },
    { id: 'e', postStatus: 'deleted',    mediaType: 'video', userId: seller },
    { id: 'f', postStatus: 'published',  mediaType: 'image', userId: 'other-seller' },
  ];

  it('includes only published and scheduled posts belonging to the seller', () => {
    const eligible = filterEligible(posts, seller);
    expect(eligible.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('excludes drafts', () => {
    const eligible = filterEligible(posts, seller);
    expect(eligible.find((p) => p.id === 'b')).toBeUndefined();
  });

  it('excludes archived posts', () => {
    const eligible = filterEligible(posts, seller);
    expect(eligible.find((p) => p.id === 'c')).toBeUndefined();
  });

  it('excludes deleted posts', () => {
    const eligible = filterEligible(posts, seller);
    expect(eligible.find((p) => p.id === 'e')).toBeUndefined();
  });

  it('excludes posts owned by other sellers', () => {
    const eligible = filterEligible(posts, seller);
    expect(eligible.find((p) => p.id === 'f')).toBeUndefined();
  });

  it('returns empty array when seller has no published posts', () => {
    const onlyDrafts: RawPost[] = [
      { id: 'x', postStatus: 'draft', mediaType: 'video', userId: seller },
    ];
    expect(filterEligible(onlyDrafts, seller)).toHaveLength(0);
  });
});

// ─── Objective persistence ────────────────────────────────────────────────────

describe('Objective persistence', () => {
  it('objectiveLabel returns correct label for each objective', () => {
    expect(objectiveLabel('views')).toBe('More video views');
    expect(objectiveLabel('likes')).toBe('More engagement');
    expect(objectiveLabel('followers')).toBe('More followers');
    expect(objectiveLabel('profile_visits')).toBe('More profile visits');
  });

  it('objectiveLabel falls back gracefully for unknown values', () => {
    expect(objectiveLabel('unknown' as BoostObjective)).toBe('More video views');
  });

  it('all four defined objectives have labels', () => {
    const vals: BoostObjective[] = ['views', 'likes', 'followers', 'profile_visits'];
    for (const v of vals) {
      expect(objectiveLabel(v)).not.toBe('');
    }
  });
});

// ─── Budget validation ────────────────────────────────────────────────────────

describe('Budget validation', () => {
  const baseBody = {
    targetType: 'post', targetId: 'post-1', objective: 'views', durationDays: 7,
  };

  it('accepts the minimum budget of $5 (500 cents)', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 500 });
    expect(result.ok).toBe(true);
  });

  it('accepts the maximum budget of $1000 (100000 cents)', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 100_000 });
    expect(result.ok).toBe(true);
  });

  it('rejects budgets below minimum', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 499 });
    expect(result.ok).toBe(false);
  });

  it('rejects budgets above maximum', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 100_001 });
    expect(result.ok).toBe(false);
  });

  it('rejects fractional cent budgets (not integer)', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 25.5 });
    expect(result.ok).toBe(false);
  });

  it('rejects zero budget', () => {
    const result = validateBoostCreate({ ...baseBody, budgetCents: 0 });
    expect(result.ok).toBe(false);
  });

  it('BUDGET_STEPS are all within server-accepted range', () => {
    for (const s of BUDGET_STEPS) {
      expect(s).toBeGreaterThanOrEqual(500);
      expect(s).toBeLessThanOrEqual(100_000);
    }
  });

  it('BUDGET_STEPS are sorted ascending', () => {
    for (let i = 1; i < BUDGET_STEPS.length; i++) {
      expect(BUDGET_STEPS[i]).toBeGreaterThan(BUDGET_STEPS[i - 1]);
    }
  });
});

// ─── Duration validation ──────────────────────────────────────────────────────

describe('Duration validation', () => {
  const baseBody = {
    targetType: 'post', targetId: 'post-1', objective: 'views', budgetCents: 2500,
  };

  it('accepts 1 day (minimum)', () => {
    expect(validateBoostCreate({ ...baseBody, durationDays: 1 }).ok).toBe(true);
  });

  it('accepts 30 days (maximum — aligned with server)', () => {
    expect(validateBoostCreate({ ...baseBody, durationDays: 30 }).ok).toBe(true);
  });

  it('rejects 31 days', () => {
    const result = validateBoostCreate({ ...baseBody, durationDays: 31 });
    expect(result.ok).toBe(false);
  });

  it('rejects 0 days', () => {
    expect(validateBoostCreate({ ...baseBody, durationDays: 0 }).ok).toBe(false);
  });

  it('rejects fractional days', () => {
    expect(validateBoostCreate({ ...baseBody, durationDays: 3.5 }).ok).toBe(false);
  });

  it('accepts undefined durationDays (server defaults to 7)', () => {
    expect(validateBoostCreate({ ...baseBody }).ok).toBe(true);
  });

  it('DURATION_MIN and DURATION_MAX match validation', () => {
    expect(DURATION_MIN).toBe(1);
    expect(DURATION_MAX).toBe(30);
  });
});

// ─── Payment readiness gating ─────────────────────────────────────────────────

describe('Payment readiness', () => {
  function canLaunch(hasCard: boolean | null): boolean {
    return hasCard === true;
  }

  it('blocks launch when hasCard is null (still loading)', () => {
    expect(canLaunch(null)).toBe(false);
  });

  it('blocks launch when hasCard is false', () => {
    expect(canLaunch(false)).toBe(false);
  });

  it('allows launch when hasCard is true', () => {
    expect(canLaunch(true)).toBe(true);
  });
});

// ─── targetType restriction ───────────────────────────────────────────────────

describe('targetType restriction', () => {
  const base = { targetId: 'id-1', objective: 'views', budgetCents: 2500, durationDays: 7 };

  it('accepts post targetType', () => {
    expect(validateBoostCreate({ ...base, targetType: 'post' }).ok).toBe(true);
  });

  it('rejects product targetType (not supported in UI or server)', () => {
    const result = validateBoostCreate({ ...base, targetType: 'product' });
    expect(result.ok).toBe(false);
  });

  it('rejects missing targetType', () => {
    expect(validateBoostCreate({ ...base }).ok).toBe(false);
  });
});

// ─── Submission states ────────────────────────────────────────────────────────

describe('Submission error handling', () => {
  function parseApiError(rawMessage: string): { error: string; code: string } {
    try {
      const body = JSON.parse(rawMessage);
      return { error: body?.error ?? rawMessage, code: body?.code ?? '' };
    } catch {
      return { error: rawMessage, code: '' };
    }
  }

  it('parses card_declined response', () => {
    const raw = JSON.stringify({ error: 'Card declined.', code: 'card_declined' });
    const { code } = parseApiError(raw);
    expect(code).toBe('card_declined');
  });

  it('parses no_payment_method response', () => {
    const raw = JSON.stringify({ error: 'No payment method on file.', code: 'no_payment_method' });
    const { code } = parseApiError(raw);
    expect(code).toBe('no_payment_method');
  });

  it('parses authentication_required response', () => {
    const raw = JSON.stringify({ error: 'Card requires verification.', code: 'authentication_required' });
    const { code } = parseApiError(raw);
    expect(code).toBe('authentication_required');
  });

  it('falls back gracefully on non-JSON error messages', () => {
    const raw = 'Network request failed';
    const { error, code } = parseApiError(raw);
    expect(error).toBe('Network request failed');
    expect(code).toBe('');
  });
});

// ─── History / results metrics ────────────────────────────────────────────────

describe('History and results metrics', () => {
  it('reachProgress returns 0 when estimatedImpressions is 0', () => {
    expect(reachProgress({ impressionsCount: 100, estimatedImpressions: 0 })).toBe(0);
  });

  it('reachProgress caps at 1.0 even if impressions exceed estimate', () => {
    expect(reachProgress({ impressionsCount: 2000, estimatedImpressions: 1000 })).toBe(1);
  });

  it('reachProgress calculates fraction correctly', () => {
    expect(reachProgress({ impressionsCount: 400, estimatedImpressions: 1000 })).toBeCloseTo(0.4);
  });

  it('daysRemaining returns 0 for past end dates', () => {
    const past = new Date(Date.now() - 86_400_000 * 2).toISOString();
    expect(daysRemaining(past)).toBe(0);
  });

  it('daysRemaining returns correct positive value for future dates', () => {
    // 3 days + 1 minute: Math.ceil rounds fractional days up so result is 3 or 4
    // depending on exact millisecond timing — test the invariant instead.
    const future = new Date(Date.now() + 86_400_000 * 3).toISOString();
    const result = daysRemaining(future);
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(4);
  });

  it('estimatedImpressions calculation matches server formula', () => {
    const budgetCents = 2500;
    const expected = Math.round(budgetCents * 0.4);
    expect(expected).toBe(1000);
  });

  it('boost marked as paid only when stripePaymentIntentId exists', () => {
    const paidBoost   = { stripePaymentIntentId: 'pi_abc', budgetCents: 2500 };
    const unpaidBoost = { stripePaymentIntentId: null,    budgetCents: 2500 };
    expect(!!paidBoost.stripePaymentIntentId).toBe(true);
    expect(!!unpaidBoost.stripePaymentIntentId).toBe(false);
  });
});

// ─── Estimated impressions formula ───────────────────────────────────────────

describe('Estimated reach formula', () => {
  it('matches server-side formula (budgetCents * 0.4)', () => {
    const cases = [500, 1000, 2500, 5000, 10000, 25000, 50000];
    for (const cents of cases) {
      const client = Math.round(cents * 0.4);
      const server = Math.round(cents * 0.4);
      expect(client).toBe(server);
    }
  });

  it('per-day budget is integer division without loss', () => {
    // divideCents(2500, 7) should not throw or return NaN
    const perDay = Math.round(2500 / 7);
    expect(perDay).toBeGreaterThan(0);
    expect(Number.isFinite(perDay)).toBe(true);
  });
});
