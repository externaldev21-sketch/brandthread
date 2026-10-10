/**
 * Explicit, typed onboarding step machine for buyer and seller flows (v9).
 *
 * v9 is one question per screen:
 *  - BUYER copies Instagram's sign-up 1:1 after the buyer/seller question
 *    (https://mobbin.com/flows/4a6da069-d7db-4720-94e6-db74d80428c0):
 *    email → code → password → birthday → terms → name → username → photo →
 *    "Welcome to Brandthread, @username" → styles → sizes → brands to follow.
 *  - SELLER copies Shopify's onboarding
 *    (https://mobbin.com/flows/5d834cad-e1a4-4893-a1bf-e50ac56090ab):
 *    question screens (stage, goals) → location → the same account fields,
 *    one per screen → brand name → username → "Building your store" preview
 *    → plan + free trial (value before plan; no way into seller tools without
 *    a trial or a paid plan). Payouts happen later from the dashboard.
 *
 * Steps are addressed by id, not index. Which account steps appear depends on
 * how the person signs up (email adds CODE + PASSWORD; Apple/Google skip
 * them) and whether a session already exists (then no account steps at all).
 * Plain module, no React Native imports, so it is directly unit-testable.
 */

export type Flow = 'buyer' | 'seller';
export type AuthMethod = 'email' | 'apple' | 'google';

export type StepId =
  | 'WELCOME'
  | 'ACCOUNT_TYPE'
  // seller questions (Shopify)
  | 'STAGE'
  | 'GOALS'
  | 'LOCATION'
  // account (Instagram)
  | 'EMAIL'
  | 'CODE'
  | 'PASSWORD'
  | 'BIRTHDAY'
  | 'TERMS'
  // profile
  | 'NAME'
  | 'BRAND_NAME'
  | 'USERNAME'
  | 'PHOTO'
  | 'WELCOME_USER'
  // buyer personalisation
  | 'STYLE'
  | 'SIZES'
  | 'BRANDS'
  // seller finish
  | 'BUILDING'
  | 'PLAN';

/** Steps that exist only before the account is created. */
export const ACCOUNT_STEPS: readonly StepId[] = ['EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS'];
/** Only the email path verifies a code and sets a password. */
const EMAIL_ONLY_STEPS: readonly StepId[] = ['CODE', 'PASSWORD'];

export const BUYER_STEPS: readonly StepId[] = [
  'WELCOME', 'ACCOUNT_TYPE',
  'EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS',
  'NAME', 'USERNAME', 'PHOTO', 'WELCOME_USER',
  'STYLE', 'SIZES', 'BRANDS',
];

export const SELLER_STEPS: readonly StepId[] = [
  'WELCOME', 'ACCOUNT_TYPE',
  'STAGE', 'GOALS', 'LOCATION',
  'EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS',
  'NAME', 'BRAND_NAME', 'USERNAME',
  'BUILDING', 'PLAN',
];

/** Steps the person may pass without answering (Shopify "Skip", Instagram "Skip"). */
const SKIPPABLE: ReadonlySet<StepId> = new Set(['STAGE', 'GOALS', 'PHOTO', 'STYLE', 'SIZES', 'BRANDS']);

/** Shopify's question screens: the thin progress bar sits above their bottom buttons. */
export const SELLER_QUESTION_STEPS: readonly StepId[] = ['STAGE', 'GOALS', 'LOCATION'];

export interface FlowContext {
  /** A session for the account being onboarded already exists. */
  accountReady: boolean;
  /** How the person chose to sign up on the EMAIL step. */
  authMethod: AuthMethod;
}

export function allStepsFor(flow: Flow): readonly StepId[] {
  return flow === 'buyer' ? BUYER_STEPS : SELLER_STEPS;
}

/** The ordered steps this person will actually see. */
export function stepsFor(flow: Flow, ctx: FlowContext): StepId[] {
  return allStepsFor(flow).filter((id) => {
    if (ctx.accountReady && ACCOUNT_STEPS.includes(id)) return false;
    if (ctx.authMethod !== 'email' && EMAIL_ONLY_STEPS.includes(id)) return false;
    return true;
  });
}

export function isStepSkippable(id: StepId): boolean {
  return SKIPPABLE.has(id);
}

export function isAccountStep(id: StepId): boolean {
  return ACCOUNT_STEPS.includes(id);
}

export function nextStepId(flow: Flow, current: StepId, ctx: FlowContext): StepId | null {
  const steps = stepsFor(flow, ctx);
  const i = steps.indexOf(current);
  if (i < 0) return firstStepAfterAccount(flow, ctx);
  return steps[i + 1] ?? null;
}

/**
 * Back is not offered on NAME once the account exists: the account steps
 * behind it are done and can't be redone (Instagram behaves the same).
 */
export function prevStepId(flow: Flow, current: StepId, ctx: FlowContext): StepId | null {
  if (ctx.accountReady && current === firstStepAfterAccount(flow, ctx)) return null;
  const steps = stepsFor(flow, ctx);
  const i = steps.indexOf(current);
  if (i <= 0) return null;
  return steps[i - 1];
}

/** First step after account creation: NAME for both flows. */
export function firstStepAfterAccount(_flow: Flow, _ctx?: FlowContext): StepId {
  return 'NAME';
}

/** The first account step for the chosen method (EMAIL, or BIRTHDAY for Apple/Google). */
export function firstAccountStep(): StepId {
  return 'EMAIL';
}

/** 0..1 position used by the seller question progress bar. */
export function progressFraction(flow: Flow, current: StepId, ctx: FlowContext): number {
  const steps: StepId[] = stepsFor(flow, ctx).filter((id) => id !== 'WELCOME');
  const i = steps.indexOf(current);
  if (i < 0) return 0;
  return (i + 1) / steps.length;
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && ([...BUYER_STEPS, ...SELLER_STEPS] as string[]).includes(value);
}

// ─── Draft version ───────────────────────────────────────────────────────────

/**
 * Draft schema version. v9 stores the step *id*; v8 and older stored an index
 * into the old step arrays, which are translated with the frozen tables below.
 */
export const DRAFT_VERSION = 9;

// The v8 order, frozen, so old drafts can be mapped to ids.
const V8_BUYER = ['WELCOME', 'ACCOUNT_TYPE', 'AUTH', 'NAME', 'STYLE', 'SIZES', 'BRANDS', 'LOADING', 'NOTIFICATIONS', 'SUCCESS'] as const;
const V8_SELLER = ['WELCOME', 'ACCOUNT_TYPE', 'AUTH', 'NAME', 'BRAND_NAME', 'BRAND_STAGE', 'GOALS', 'PLAN', 'LOADING', 'NOTIFICATIONS', 'SUCCESS'] as const;

const V8_TO_V9: Record<string, StepId> = {
  WELCOME: 'ACCOUNT_TYPE',
  ACCOUNT_TYPE: 'ACCOUNT_TYPE',
  // Old drafts were written only for signed-in accounts, so "Auth" is done.
  AUTH: 'NAME',
  NAME: 'NAME',
  STYLE: 'STYLE',
  SIZES: 'SIZES',
  BRANDS: 'BRANDS',
  BRAND_NAME: 'BRAND_NAME',
  BRAND_STAGE: 'STAGE',
  GOALS: 'GOALS',
};

/**
 * Translate any persisted draft into a v9 step id. v9 drafts carry `stepId`;
 * older drafts carry `step` (an index) and `version`.
 */
export function restoreDraftStepId(
  flow: Flow,
  draft: { stepId?: unknown; step?: unknown; version?: unknown },
): StepId {
  if (draft.version === DRAFT_VERSION && isStepId(draft.stepId) && allStepsFor(flow).includes(draft.stepId)) {
    return draft.stepId;
  }
  if (draft.version === DRAFT_VERSION || typeof draft.step !== 'number') return 'ACCOUNT_TYPE';
  const index = draft.step;
  const version = typeof draft.version === 'number' ? draft.version : undefined;
  const v8Index = restoreLegacyDraftStep(flow, index, version);
  const v8Id = (flow === 'buyer' ? V8_BUYER : V8_SELLER)[v8Index] ?? 'ACCOUNT_TYPE';
  // Old finishing screens (loading, notifications, success) resume on the
  // last real step of the new flow; the old plan step maps to the new one.
  if (v8Id === 'PLAN') return 'PLAN';
  return V8_TO_V9[v8Id] ?? (flow === 'buyer' ? 'BRANDS' : 'BUILDING');
}

// ─── Legacy (v1–v8, index-based) ─────────────────────────────────────────────
// Kept only to translate old in-flight drafts. Do not use for new code.
type LegacyBuyerStepId = typeof V8_BUYER[number];
type LegacySellerStepId = typeof V8_SELLER[number];
const BUYER_STEP_INDEX = Object.fromEntries(V8_BUYER.map((id, i) => [id, i])) as Record<LegacyBuyerStepId, number>;
const SELLER_STEP_INDEX = Object.fromEntries(V8_SELLER.map((id, i) => [id, i])) as Record<LegacySellerStepId, number>;
function totalStepsFor(flow: Flow): number {
  return flow === 'buyer' ? V8_BUYER.length : V8_SELLER.length;
}
function clampStep(flow: Flow, stepIndex: number): number {
  return Math.max(0, Math.min(stepIndex, totalStepsFor(flow) - 1));
}

// ─── Draft persistence & migration ──────────────────────────────────────────

/**
 * Draft schema version written alongside each user's serialized onboarding
 * answers. Bump this whenever the step order changes, and add a branch below
 * that translates the old step index into the current (v7) layout so an
 * in-flight user resuming mid-onboarding lands back on an equivalent step
 * instead of restarting from scratch.
 */
const LEGACY_DRAFT_VERSION = 8;

// v7 order (Welcome + Brands, no Sizes step): the *source* indices for the
// v7 -> v8 migration. Frozen — never reference the live index maps here.
const V7_BUYER_STEP_INDEX = {
  WELCOME: 0, ACCOUNT_TYPE: 1, AUTH: 2, NAME: 3, STYLE: 4, BRANDS: 5, LOADING: 6, NOTIFICATIONS: 7, SUCCESS: 8,
} as const;
const V7_SELLER_STEP_INDEX = {
  WELCOME: 0, ACCOUNT_TYPE: 1, AUTH: 2, NAME: 3, BRAND_NAME: 4, BRAND_STAGE: 5, GOALS: 6, PLAN: 7,
  LOADING: 8, NOTIFICATIONS: 9, SUCCESS: 10,
} as const;

// v6 order (no Welcome step, no Brands-to-follow step): kept here only so the
// migration table below can name its *source* indices clearly.
const V6_BUYER_STEP_INDEX = {
  ACCOUNT_TYPE: 0, AUTH: 1, NAME: 2, STYLE: 3, LOADING: 4, NOTIFICATIONS: 5, SUCCESS: 6,
} as const;
const V6_SELLER_STEP_INDEX = {
  ACCOUNT_TYPE: 0, AUTH: 1, NAME: 2, BRAND_NAME: 3, BRAND_STAGE: 4, GOALS: 5, PLAN: 6,
  LOADING: 7, NOTIFICATIONS: 8, SUCCESS: 9,
} as const;

/** Translate a v6-shaped step index (no Welcome/Brands steps) into v7. */
function v6ToV7(flow: Flow, v6Step: number): number {
  if (flow === 'buyer') {
    const map: Record<number, number> = {
      [V6_BUYER_STEP_INDEX.ACCOUNT_TYPE]: V7_BUYER_STEP_INDEX.ACCOUNT_TYPE,
      [V6_BUYER_STEP_INDEX.AUTH]: V7_BUYER_STEP_INDEX.AUTH,
      [V6_BUYER_STEP_INDEX.NAME]: V7_BUYER_STEP_INDEX.NAME,
      [V6_BUYER_STEP_INDEX.STYLE]: V7_BUYER_STEP_INDEX.STYLE,
      [V6_BUYER_STEP_INDEX.LOADING]: V7_BUYER_STEP_INDEX.LOADING,
      [V6_BUYER_STEP_INDEX.NOTIFICATIONS]: V7_BUYER_STEP_INDEX.NOTIFICATIONS,
      [V6_BUYER_STEP_INDEX.SUCCESS]: V7_BUYER_STEP_INDEX.SUCCESS,
    };
    return map[v6Step] ?? V7_BUYER_STEP_INDEX.ACCOUNT_TYPE;
  }
  const map: Record<number, number> = {
    [V6_SELLER_STEP_INDEX.ACCOUNT_TYPE]: V7_SELLER_STEP_INDEX.ACCOUNT_TYPE,
    [V6_SELLER_STEP_INDEX.AUTH]: V7_SELLER_STEP_INDEX.AUTH,
    [V6_SELLER_STEP_INDEX.NAME]: V7_SELLER_STEP_INDEX.NAME,
    [V6_SELLER_STEP_INDEX.BRAND_NAME]: V7_SELLER_STEP_INDEX.BRAND_NAME,
    [V6_SELLER_STEP_INDEX.BRAND_STAGE]: V7_SELLER_STEP_INDEX.BRAND_STAGE,
    [V6_SELLER_STEP_INDEX.GOALS]: V7_SELLER_STEP_INDEX.GOALS,
    [V6_SELLER_STEP_INDEX.PLAN]: V7_SELLER_STEP_INDEX.PLAN,
    [V6_SELLER_STEP_INDEX.LOADING]: V7_SELLER_STEP_INDEX.LOADING,
    [V6_SELLER_STEP_INDEX.NOTIFICATIONS]: V7_SELLER_STEP_INDEX.NOTIFICATIONS,
    [V6_SELLER_STEP_INDEX.SUCCESS]: V7_SELLER_STEP_INDEX.SUCCESS,
  };
  return map[v6Step] ?? V7_SELLER_STEP_INDEX.ACCOUNT_TYPE;
}

/**
 * Translate a pre-v6 step index into the v6 layout. This is a straight port
 * of the step tables that shipped with v6's `restoreDraftStep`, unchanged —
 * only the *names* of the target constants changed (V6_* instead of the
 * flow's live STEP_INDEX, since "live" now means v7).
 */
function restoreLegacyStepToV6(flow: Flow, step: number, version?: number): number {
  if (version === 6) return step;

  if (version === 5) {
    if (flow === 'buyer') {
      // v5: 0=Auth, 1=AccountType, 2=Name, 3=Style, 4=Loading, 5=Notifications, 6=Success
      const v5ToBuyer: Record<number, number> = {
        0: V6_BUYER_STEP_INDEX.AUTH,
        1: V6_BUYER_STEP_INDEX.ACCOUNT_TYPE,
        2: V6_BUYER_STEP_INDEX.NAME,
        3: V6_BUYER_STEP_INDEX.STYLE,
        4: V6_BUYER_STEP_INDEX.LOADING,
        5: V6_BUYER_STEP_INDEX.NOTIFICATIONS,
        6: V6_BUYER_STEP_INDEX.SUCCESS,
      };
      return v5ToBuyer[step] ?? V6_BUYER_STEP_INDEX.ACCOUNT_TYPE;
    }
    const v5ToSeller: Record<number, number> = {
      0: V6_SELLER_STEP_INDEX.AUTH,
      1: V6_SELLER_STEP_INDEX.ACCOUNT_TYPE,
      2: V6_SELLER_STEP_INDEX.NAME,
      3: V6_SELLER_STEP_INDEX.BRAND_NAME,
      4: V6_SELLER_STEP_INDEX.BRAND_STAGE,
      5: V6_SELLER_STEP_INDEX.GOALS,
      6: V6_SELLER_STEP_INDEX.PLAN,
      7: V6_SELLER_STEP_INDEX.LOADING,
      8: V6_SELLER_STEP_INDEX.NOTIFICATIONS,
      9: V6_SELLER_STEP_INDEX.SUCCESS,
    };
    return v5ToSeller[step] ?? V6_SELLER_STEP_INDEX.ACCOUNT_TYPE;
  }

  if (version === 4) {
    const previousStep = flow === 'buyer'
      ? [V6_BUYER_STEP_INDEX.AUTH, V6_BUYER_STEP_INDEX.ACCOUNT_TYPE, V6_BUYER_STEP_INDEX.NAME, V6_BUYER_STEP_INDEX.STYLE, V6_BUYER_STEP_INDEX.LOADING, V6_BUYER_STEP_INDEX.NOTIFICATIONS, V6_BUYER_STEP_INDEX.SUCCESS]
      : [V6_SELLER_STEP_INDEX.AUTH, V6_SELLER_STEP_INDEX.ACCOUNT_TYPE, V6_SELLER_STEP_INDEX.NAME, V6_SELLER_STEP_INDEX.BRAND_NAME, V6_SELLER_STEP_INDEX.BRAND_STAGE, V6_SELLER_STEP_INDEX.GOALS, V6_SELLER_STEP_INDEX.LOADING, V6_SELLER_STEP_INDEX.NOTIFICATIONS, V6_SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? V6_BUYER_STEP_INDEX.ACCOUNT_TYPE : V6_SELLER_STEP_INDEX.ACCOUNT_TYPE);
  }

  if (version === 3) {
    const previousStep = flow === 'buyer'
      ? [V6_BUYER_STEP_INDEX.AUTH, V6_BUYER_STEP_INDEX.NAME, V6_BUYER_STEP_INDEX.STYLE, V6_BUYER_STEP_INDEX.LOADING, V6_BUYER_STEP_INDEX.NOTIFICATIONS, V6_BUYER_STEP_INDEX.SUCCESS]
      : [V6_SELLER_STEP_INDEX.AUTH, V6_SELLER_STEP_INDEX.NAME, V6_SELLER_STEP_INDEX.BRAND_NAME, V6_SELLER_STEP_INDEX.BRAND_STAGE, V6_SELLER_STEP_INDEX.GOALS, V6_SELLER_STEP_INDEX.LOADING, V6_SELLER_STEP_INDEX.NOTIFICATIONS, V6_SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? V6_BUYER_STEP_INDEX.ACCOUNT_TYPE : V6_SELLER_STEP_INDEX.ACCOUNT_TYPE);
  }

  if (flow === 'buyer') {
    // Previous buyer order: Name, Style, Auth, Loading, Notifications, Success.
    const previousBuyerStep: Record<number, number> = {
      0: V6_BUYER_STEP_INDEX.NAME,
      1: V6_BUYER_STEP_INDEX.STYLE,
      2: V6_BUYER_STEP_INDEX.AUTH,
      3: V6_BUYER_STEP_INDEX.LOADING,
      4: V6_BUYER_STEP_INDEX.NOTIFICATIONS,
      5: V6_BUYER_STEP_INDEX.SUCCESS,
    };
    return previousBuyerStep[step] ?? V6_BUYER_STEP_INDEX.ACCOUNT_TYPE;
  }

  if (version === 2) {
    // Version 2 seller order: Name, BrandName, Auth, Stage, Goals, Loading, Notifications, Success.
    const previousSellerStep: Record<number, number> = {
      0: V6_SELLER_STEP_INDEX.NAME,
      1: V6_SELLER_STEP_INDEX.BRAND_NAME,
      2: V6_SELLER_STEP_INDEX.AUTH,
      3: V6_SELLER_STEP_INDEX.BRAND_STAGE,
      4: V6_SELLER_STEP_INDEX.GOALS,
      5: V6_SELLER_STEP_INDEX.LOADING,
      6: V6_SELLER_STEP_INDEX.NOTIFICATIONS,
      7: V6_SELLER_STEP_INDEX.SUCCESS,
    };
    return previousSellerStep[step] ?? V6_SELLER_STEP_INDEX.ACCOUNT_TYPE;
  }

  // Version 1 seller order included a product-model step and put Auth at 5.
  const previousLegacySellerStep: Record<number, number> = {
    0: V6_SELLER_STEP_INDEX.NAME,
    1: V6_SELLER_STEP_INDEX.BRAND_NAME,
    2: V6_SELLER_STEP_INDEX.BRAND_STAGE,
    3: V6_SELLER_STEP_INDEX.GOALS,
    4: V6_SELLER_STEP_INDEX.GOALS,
    5: V6_SELLER_STEP_INDEX.AUTH,
    6: V6_SELLER_STEP_INDEX.LOADING,
    7: V6_SELLER_STEP_INDEX.NOTIFICATIONS,
    8: V6_SELLER_STEP_INDEX.SUCCESS,
  };
  return previousLegacySellerStep[step] ?? V6_SELLER_STEP_INDEX.ACCOUNT_TYPE;
}

/** v7 -> v8: the buyer flow gained a Sizes step after Style; every buyer step from Brands on shifts by one. */
function v7ToV8(flow: Flow, v7Step: number): number {
  if (flow === 'seller') return v7Step;
  return v7Step >= V7_BUYER_STEP_INDEX.BRANDS ? v7Step + 1 : v7Step;
}

/**
 * Translate a persisted (flow, step, version) draft into the current (v8)
 * step index for that flow. Unknown/undefined versions are treated as the
 * oldest legacy shape, matching the historical behaviour of this function.
 */
export function restoreLegacyDraftStep(flow: Flow, step: number, version?: number): number {
  if (version === LEGACY_DRAFT_VERSION) return clampStep(flow, step);
  if (version === 7) return clampStep(flow, v7ToV8(flow, step));
  const v6Step = restoreLegacyStepToV6(flow, step, version);
  return clampStep(flow, v7ToV8(flow, v6ToV7(flow, v6Step)));
}
