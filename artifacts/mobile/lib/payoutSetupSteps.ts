/**
 * Pure model for the payout setup checklist (app/payout-setup.tsx). No React
 * Native imports, so it is cheap to unit test.
 */

export type SetupStepId = 'identity' | 'bank_account' | 'tax_info';
export type SetupStepStatus = 'complete' | 'needed' | 'in_review';
export type SetupState = 'not_started' | 'in_progress' | 'in_review' | 'complete' | 'restricted';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  status: SetupStepStatus;
  detail: string;
  pastDue: boolean;
}

export interface PayoutSetup {
  state: SetupState;
  steps: SetupStep[];
  deadline: string | null;
  bankLast4: string | null;
  providerConfigured: boolean;
}

const STEP_IDS: SetupStepId[] = ['identity', 'bank_account', 'tax_info'];
const DEFAULT_LABEL: Record<SetupStepId, string> = { identity: 'Identity', bank_account: 'Bank account', tax_info: 'Tax info' };
const IDLE_DETAIL: Record<SetupStepId, string> = {
  identity: 'Confirm who you are',
  bank_account: 'Where payouts are sent',
  tax_info: 'SSN or EIN for your W-9',
};
const STATES: SetupState[] = ['not_started', 'in_progress', 'in_review', 'complete', 'restricted'];

export function idleSteps(): SetupStep[] {
  return STEP_IDS.map((id) => ({ id, label: DEFAULT_LABEL[id], status: 'needed', detail: IDLE_DETAIL[id], pastDue: false }));
}

/** Tolerant parse of GET /api/seller/connect/status; older servers without `steps` read as not started. */
export function normalizePayoutSetup(data: unknown): PayoutSetup | null {
  if (!data || typeof data !== 'object') return null;
  const v = data as Record<string, unknown>;
  const rawSteps = Array.isArray(v.steps) ? (v.steps as Array<Record<string, unknown>>) : [];
  const steps = STEP_IDS.map((id): SetupStep => {
    const s = rawSteps.find((x) => x?.id === id);
    const status = s?.status === 'complete' || s?.status === 'in_review' ? s.status : 'needed';
    return {
      id,
      label: typeof s?.label === 'string' && s.label ? s.label : DEFAULT_LABEL[id],
      status,
      detail: typeof s?.detail === 'string' && s.detail ? s.detail : IDLE_DETAIL[id],
      pastDue: s?.pastDue === true,
    };
  });
  const state = STATES.includes(v.setupState as SetupState)
    ? (v.setupState as SetupState)
    : v.connected === true ? 'in_progress' : 'not_started';
  return {
    state,
    steps,
    deadline: typeof v.deadline === 'string' ? v.deadline : null,
    bankLast4: typeof v.bankLast4 === 'string' && /^\d{4}$/.test(v.bankLast4) ? v.bankLast4 : null,
    providerConfigured: v.providerConfigured !== false,
  };
}

export function setupHeadline(state: SetupState): { title: string; body: string } {
  switch (state) {
    case 'complete':
      return { title: "You're ready to get paid", body: 'Payouts go to your bank on your schedule. Stripe files your 1099 for you.' };
    case 'in_review':
      return { title: 'Stripe is reviewing your details', body: 'This usually finishes within a few minutes. Nothing else is needed right now.' };
    case 'restricted':
      return { title: 'Payouts are paused', body: 'Stripe needs a few things before payouts can continue.' };
    case 'in_progress':
      return { title: 'Finish setting up payouts', body: 'Stripe needs a few more details before you can get paid.' };
    default:
      return { title: 'Set up payouts', body: 'Verify your identity, add a bank account and confirm tax info. Stripe handles it securely.' };
  }
}

export function setupCtaLabel(state: SetupState): string | null {
  switch (state) {
    case 'not_started': return 'Start setup';
    case 'in_progress':
    case 'restricted': return 'Continue setup';
    case 'in_review': return 'Refresh status';
    case 'complete': return 'Open Stripe dashboard';
  }
}

export function completedCount(steps: SetupStep[]): number {
  return steps.filter((s) => s.status === 'complete').length;
}

export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Demo dataset, only used under `?bt_preview=seller&demo=1`. */
export function demoPayoutSetup(state: SetupState): PayoutSetup {
  const s = (id: SetupStepId, status: SetupStepStatus, detail: string, pastDue = false): SetupStep =>
    ({ id, label: DEFAULT_LABEL[id], status, detail, pastDue });
  switch (state) {
    case 'in_progress':
      return {
        state, providerConfigured: true, bankLast4: null, deadline: '2026-10-28T00:00:00.000Z',
        steps: [s('identity', 'complete', 'Verified'), s('bank_account', 'needed', 'Bank account details'), s('tax_info', 'needed', 'Last 4 of SSN')],
      };
    case 'in_review':
      return {
        state, providerConfigured: true, bankLast4: '6789', deadline: null,
        steps: [s('identity', 'in_review', 'Stripe is reviewing this'), s('bank_account', 'complete', 'Verified'), s('tax_info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
    case 'complete':
      return {
        state, providerConfigured: true, bankLast4: '6789', deadline: null,
        steps: [s('identity', 'complete', 'Verified'), s('bank_account', 'complete', 'Verified'), s('tax_info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
    case 'restricted':
      return {
        state, providerConfigured: true, bankLast4: '6789', deadline: '2026-10-05T00:00:00.000Z',
        steps: [s('identity', 'needed', 'Photo ID', true), s('bank_account', 'complete', 'Verified'), s('tax_info', 'complete', 'W-9 on file. Stripe files your 1099')],
      };
    default:
      return { state: 'not_started', providerConfigured: true, bankLast4: null, deadline: null, steps: idleSteps() };
  }
}
