/**
 * Pure Stripe Connect status types/normalizer — no React Native imports, so
 * any screen or test can depend on it without pulling in RN's module graph.
 * The canonical source for what "fully connected" means; StripeConnectWarning
 * re-exports these for back-compat with existing importers.
 */

export interface PayoutSchedule {
  interval: string | null;
  delayDays: number | null;
  weeklyAnchor: string | null;
  monthlyAnchor: number | null;
}

export type TaxInfoStatus = 'submitted' | 'needed' | 'unknown';

export interface ConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: string;
  verified: boolean;
  bankLast4: string | null;
  /** false when this environment has no payment provider configured at all. */
  providerConfigured: boolean;
  payoutSchedule: PayoutSchedule | null;
  requirementsDue: string[];
  taxInfoStatus: TaxInfoStatus;
}

export function normalizeConnectStatus(data: unknown): ConnectStatus | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const schedule = value.payoutSchedule && typeof value.payoutSchedule === 'object'
    ? value.payoutSchedule as Record<string, unknown>
    : null;
  return {
    connected: value.connected === true,
    chargesEnabled: value.chargesEnabled === true,
    payoutsEnabled: value.payoutsEnabled === true,
    status: typeof value.status === 'string' && value.status.trim() ? value.status : 'unknown',
    verified: value.verified === true,
    bankLast4: typeof value.bankLast4 === 'string' && /^\d{4}$/.test(value.bankLast4)
      ? value.bankLast4
      : null,
    // Defaults to true (configured) when the field is absent so older API
    // responses — and every existing test/mock that predates this field —
    // keep behaving exactly as before.
    providerConfigured: value.providerConfigured !== false,
    payoutSchedule: schedule ? {
      interval: typeof schedule.interval === 'string' ? schedule.interval : null,
      delayDays: typeof schedule.delayDays === 'number' ? schedule.delayDays : null,
      weeklyAnchor: typeof schedule.weeklyAnchor === 'string' ? schedule.weeklyAnchor : null,
      monthlyAnchor: typeof schedule.monthlyAnchor === 'number' ? schedule.monthlyAnchor : null,
    } : null,
    requirementsDue: Array.isArray(value.requirementsDue)
      ? value.requirementsDue.filter((entry): entry is string => typeof entry === 'string')
      : [],
    taxInfoStatus: value.taxInfoStatus === 'submitted' || value.taxInfoStatus === 'needed'
      ? value.taxInfoStatus
      : 'unknown',
  };
}

/** A Connect account with nothing left to fix — charges, payouts, and the account itself are all live. */
export function isStripeFullyConnected(status: ConnectStatus | null): boolean {
  return !!status && status.connected && status.chargesEnabled && status.payoutsEnabled && status.status === 'active';
}
