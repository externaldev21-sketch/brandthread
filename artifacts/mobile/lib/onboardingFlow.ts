/**
 * Explicit, typed onboarding step machine for buyer and seller flows.
 *
 * This is the single source of truth for:
 *  - step ordering per flow (including the v7 Welcome + Brands-to-follow steps)
 *  - which steps may be skipped
 *  - draft-version migration (old in-flight AsyncStorage drafts -> current step)
 *
 * `app/onboarding.tsx` renders steps driven by these definitions instead of
 * hand-maintained, duplicated index objects. Keeping this logic in a plain
 * module (no React Native imports) makes it directly unit-testable.
 */

export type Flow = 'buyer' | 'seller';

export type BuyerStepId =
  | 'WELCOME'
  | 'ACCOUNT_TYPE'
  | 'AUTH'
  | 'NAME'
  | 'STYLE'
  | 'SIZES'
  | 'BRANDS'
  | 'LOADING'
  | 'NOTIFICATIONS'
  | 'SUCCESS';

export type SellerStepId =
  | 'WELCOME'
  | 'ACCOUNT_TYPE'
  | 'AUTH'
  | 'NAME'
  | 'BRAND_NAME'
  | 'BRAND_STAGE'
  | 'GOALS'
  | 'PLAN'
  | 'LOADING'
  | 'NOTIFICATIONS'
  | 'SUCCESS';

export interface StepDef<Id extends string> {
  id: Id;
  /** Whether the user can advance past this step without completing it. */
  skippable: boolean;
}

// ─── Step order (v8) ──────────────────────────────────────────────────────
// BOTH:   0=Welcome  1=AccountType  2=Auth  3=Name
// BUYER:  4=Style  5=Sizes  6=Brands  7=Loading  8=Notifications  9=Success
// SELLER: 4=BrandName  5=BrandStage  6=Goals  7=Plan  8=Loading  9=Notifications  10=Success
export const BUYER_FLOW_STEPS: StepDef<BuyerStepId>[] = [
  { id: 'WELCOME', skippable: false },
  { id: 'ACCOUNT_TYPE', skippable: false },
  { id: 'AUTH', skippable: false },
  { id: 'NAME', skippable: false },
  { id: 'STYLE', skippable: true },
  { id: 'SIZES', skippable: true },
  { id: 'BRANDS', skippable: true },
  { id: 'LOADING', skippable: false },
  { id: 'NOTIFICATIONS', skippable: true },
  { id: 'SUCCESS', skippable: false },
];

export const SELLER_FLOW_STEPS: StepDef<SellerStepId>[] = [
  { id: 'WELCOME', skippable: false },
  { id: 'ACCOUNT_TYPE', skippable: false },
  { id: 'AUTH', skippable: false },
  { id: 'NAME', skippable: false },
  { id: 'BRAND_NAME', skippable: false },
  { id: 'BRAND_STAGE', skippable: true },
  { id: 'GOALS', skippable: true },
  { id: 'PLAN', skippable: true },
  { id: 'LOADING', skippable: false },
  { id: 'NOTIFICATIONS', skippable: true },
  { id: 'SUCCESS', skippable: false },
];

function stepIndexMap<Id extends string>(steps: StepDef<Id>[]): Record<Id, number> {
  return Object.fromEntries(steps.map((s, i) => [s.id, i])) as Record<Id, number>;
}

export const BUYER_STEP_INDEX = stepIndexMap(BUYER_FLOW_STEPS);
export const SELLER_STEP_INDEX = stepIndexMap(SELLER_FLOW_STEPS);

export function stepsFor(flow: Flow): StepDef<string>[] {
  return flow === 'buyer' ? BUYER_FLOW_STEPS : SELLER_FLOW_STEPS;
}

export function totalStepsFor(flow: Flow): number {
  return stepsFor(flow).length;
}

export function clampStep(flow: Flow, stepIndex: number): number {
  return Math.max(0, Math.min(stepIndex, totalStepsFor(flow) - 1));
}

export function isStepSkippable(flow: Flow, stepIndex: number): boolean {
  return stepsFor(flow)[stepIndex]?.skippable ?? false;
}

/** One step forward, clamped to the last step of the flow. */
export function nextStepIndex(flow: Flow, stepIndex: number): number {
  return clampStep(flow, stepIndex + 1);
}

/** One step back, clamped to the first step of the flow (Welcome). */
export function prevStepIndex(flow: Flow, stepIndex: number): number {
  return clampStep(flow, stepIndex - 1);
}

export function canGoBack(stepIndex: number): boolean {
  return stepIndex > 0;
}

// ─── Draft persistence & migration ──────────────────────────────────────────

/**
 * Draft schema version written alongside each user's serialized onboarding
 * answers. Bump this whenever the step order changes, and add a branch below
 * that translates the old step index into the current (v7) layout so an
 * in-flight user resuming mid-onboarding lands back on an equivalent step
 * instead of restarting from scratch.
 */
export const DRAFT_VERSION = 8;

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
export function restoreDraftStep(flow: Flow, step: number, version?: number): number {
  if (version === DRAFT_VERSION) return clampStep(flow, step);
  if (version === 7) return clampStep(flow, v7ToV8(flow, step));
  const v6Step = restoreLegacyStepToV6(flow, step, version);
  return clampStep(flow, v7ToV8(flow, v6ToV7(flow, v6Step)));
}
