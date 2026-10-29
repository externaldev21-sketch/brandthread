/**
 * Pure model for the Payouts screen's setup journey (app/payouts.tsx). No
 * React Native imports, so every state is unit-testable.
 *
 * GET /api/seller/connect/status returns `payoutState`, derived from the live
 * Stripe account (api-server lib/connectOnboarding.ts derivePayoutState).
 * Only "active" opens the manage page. Nothing here ever defaults to active.
 */
import { normalizePayoutSetup, type SetupStep } from './payoutSetupSteps';

export type PayoutJourneyState =
  | 'not_started'
  | 'onboarding_incomplete'
  | 'pending_verification'
  | 'action_needed'
  | 'active';

export const PAYOUT_JOURNEY_STATES: PayoutJourneyState[] = [
  'not_started', 'onboarding_incomplete', 'pending_verification', 'action_needed', 'active',
];

export interface PayoutActionItem {
  step: SetupStep['id'];
  label: string;
  detail: string;
  pastDue: boolean;
}

export interface PayoutJourney {
  /** null: the server could not read the Stripe account — show a retry, never a guess. */
  state: PayoutJourneyState | null;
  steps: SetupStep[];
  actionItems: PayoutActionItem[];
  deadline: string | null;
  /** Money still flows (Stripe hasn't paused payouts) even while info is due. */
  payoutsEnabled: boolean;
  /** Stripe rejected the account: the seller can't fix it on Stripe, support can. */
  rejected: boolean;
}

const LEGACY_SETUP_STATE: Record<string, PayoutJourneyState> = {
  not_started: 'not_started',
  in_progress: 'onboarding_incomplete',
  in_review: 'pending_verification',
  restricted: 'action_needed',
  complete: 'active',
};

function isJourneyState(v: unknown): v is PayoutJourneyState {
  return typeof v === 'string' && (PAYOUT_JOURNEY_STATES as string[]).includes(v);
}

function parseState(v: Record<string, unknown>): PayoutJourneyState | null {
  if (isJourneyState(v.payoutState)) return v.payoutState;
  // The server said it can't tell (no Stripe access for an existing account).
  if (v.payoutState === null) return null;
  // Older servers: map the checklist state; with neither, only "not connected"
  // is knowable — a connected account without detail is treated as unfinished.
  if (typeof v.setupState === 'string' && LEGACY_SETUP_STATE[v.setupState]) return LEGACY_SETUP_STATE[v.setupState];
  return v.connected === true ? 'onboarding_incomplete' : 'not_started';
}

/** Tolerant parse of GET /api/seller/connect/status. Returns null for a non-object body. */
export function normalizePayoutJourney(data: unknown): PayoutJourney | null {
  if (!data || typeof data !== 'object') return null;
  const v = data as Record<string, unknown>;
  const setup = normalizePayoutSetup(data);
  const rawItems = Array.isArray(v.actionItems) ? (v.actionItems as Array<Record<string, unknown>>) : [];
  const actionItems = rawItems
    .filter((i) => i && typeof i.label === 'string')
    .map((i): PayoutActionItem => ({
      step: (i.step === 'bank_account' || i.step === 'tax_info' ? i.step : 'identity') as SetupStep['id'],
      label: String(i.label),
      detail: typeof i.detail === 'string' ? i.detail : '',
      pastDue: i.pastDue === true,
    }));
  const state = parseState(v);
  return {
    state,
    steps: setup?.steps ?? [],
    // Older servers without actionItems: fall back to the needed checklist steps.
    actionItems: actionItems.length > 0 || state !== 'action_needed'
      ? actionItems
      : (setup?.steps ?? []).filter((s) => s.status === 'needed').map((s) => ({ step: s.id, label: s.label, detail: s.detail, pastDue: s.pastDue })),
    deadline: typeof v.deadline === 'string' ? v.deadline : null,
    payoutsEnabled: v.payoutsEnabled === true,
    rejected: typeof v.disabledReason === 'string' && v.disabledReason.startsWith('rejected'),
  };
}

/** True when the manage page (balance, schedule, bank, history) is the right screen. */
export function showsManagePage(j: PayoutJourney): boolean {
  if (j.state === 'active') return true;
  // Stripe wants something by a deadline but hasn't paused payouts yet: the
  // seller keeps their manage page, with the ask pinned on top.
  return j.state === 'action_needed' && j.payoutsEnabled && !j.rejected;
}

export interface JourneyCopy {
  title: string;
  body: string;
  /** Primary action label; null when the seller has nothing to do but wait. */
  cta: string | null;
}

export function journeyCopy(state: Exclude<PayoutJourneyState, 'active'>, opts: { rejected?: boolean } = {}): JourneyCopy {
  switch (state) {
    case 'not_started':
      return {
        title: 'Set up payouts',
        body: 'Get paid for your sales. Stripe sends your earnings straight to your bank account.',
        cta: 'Set up payouts',
      };
    case 'onboarding_incomplete':
      return {
        title: 'Finish setting up payouts',
        body: "You started setup on Stripe but didn't finish. Your progress is saved, so you can pick up where you left off.",
        cta: 'Resume setup',
      };
    case 'pending_verification':
      return {
        title: 'Stripe is verifying your info',
        body: "You've sent everything Stripe needs. Verification usually takes a few minutes and can take up to 2 business days. Payouts turn on as soon as it's done.",
        cta: null,
      };
    case 'action_needed':
      return opts.rejected
        ? {
          title: "Stripe couldn't verify this account",
          body: "Payouts can't be turned on for this account. Contact support and we'll help you sort it out.",
          cta: 'Contact support',
        }
        : {
          title: 'Stripe needs more info',
          body: 'Payouts are on hold until you send Stripe the details below.',
          cta: 'Update info on Stripe',
        };
  }
}

/** What the seller needs before they start (state 1). */
export const SETUP_NEEDS: Array<{ icon: 'credit-card' | 'user' | 'file-text'; title: string; detail: string }> = [
  { icon: 'credit-card', title: 'Bank account', detail: 'Routing and account number where payouts are sent' },
  { icon: 'user', title: 'Photo ID', detail: "Driver's license or passport to confirm it's you" },
  { icon: 'file-text', title: 'SSN or EIN', detail: 'For your W-9. Stripe files your 1099 for you' },
];

/**
 * Fixed fixtures for each state, used only when the web dev session forces a
 * state for screenshots (`?bt_preview=seller&demo=1&payoutState=…`).
 */
export function fixtureJourneyStatus(state: PayoutJourneyState): Record<string, unknown> {
  const step = (id: SetupStep['id'], label: string, status: SetupStep['status'], detail: string, pastDue = false) =>
    ({ id, label, status, detail, pastDue, requirements: [], upcoming: [] });
  const base = {
    stripeAccountId: null, providerConfigured: true, requirementsDue: [], payoutSchedule: null,
    taxInfoStatus: 'unknown', deadline: null, disabledReason: null, actionItems: [],
  };
  switch (state) {
    case 'not_started':
      return {
        ...base, connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
        status: 'not_started', verified: false, bankLast4: null, setupState: 'not_started', payoutState: state,
        steps: [step('identity', 'Identity', 'needed', 'Confirm who you are'), step('bank_account', 'Bank account', 'needed', 'Where payouts are sent'), step('tax_info', 'Tax info', 'needed', 'SSN or EIN for your W-9')],
      };
    case 'onboarding_incomplete':
      return {
        ...base, connected: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
        status: 'pending', verified: false, bankLast4: null, setupState: 'in_progress', payoutState: state,
        steps: [step('identity', 'Identity', 'complete', 'Verified'), step('bank_account', 'Bank account', 'needed', 'Where payouts are sent'), step('tax_info', 'Tax info', 'needed', 'SSN or EIN for your W-9')],
      };
    case 'pending_verification':
      return {
        ...base, connected: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true,
        status: 'restricted', verified: false, bankLast4: '6789', setupState: 'in_review', payoutState: state,
        steps: [step('identity', 'Identity', 'in_review', 'Stripe is reviewing this'), step('bank_account', 'Bank account', 'complete', 'Verified'), step('tax_info', 'Tax info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
    case 'action_needed':
      return {
        ...base, connected: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true,
        status: 'restricted', verified: false, bankLast4: '6789', setupState: 'restricted', payoutState: state,
        deadline: '2026-11-12T00:00:00.000Z', disabledReason: 'requirements.past_due',
        actionItems: [{ step: 'identity', label: 'Identity', detail: 'Photo ID', pastDue: true }],
        steps: [step('identity', 'Identity', 'needed', 'Photo ID', true), step('bank_account', 'Bank account', 'complete', 'Verified'), step('tax_info', 'Tax info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
    case 'active':
      return {
        ...base, connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
        status: 'active', verified: true, bankLast4: '4242', setupState: 'complete', payoutState: state,
        taxInfoStatus: 'submitted', payoutSchedule: { interval: 'daily', delayDays: 2, weeklyAnchor: null, monthlyAnchor: null },
        steps: [step('identity', 'Identity', 'complete', 'Verified'), step('bank_account', 'Bank account', 'complete', 'Verified'), step('tax_info', 'Tax info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
  }
}
