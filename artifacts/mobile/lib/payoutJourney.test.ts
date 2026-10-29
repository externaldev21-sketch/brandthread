import { describe, expect, it } from 'vitest';
import {
  PAYOUT_JOURNEY_STATES,
  fixtureJourneyStatus,
  journeyCopy,
  normalizePayoutJourney,
  showsManagePage,
} from './payoutJourney';
import { resolvePreviewApiResponse } from './previewApiData';

describe('normalizePayoutJourney', () => {
  it('reads every server payoutState as-is', () => {
    for (const state of PAYOUT_JOURNEY_STATES) {
      expect(normalizePayoutJourney({ payoutState: state })!.state).toBe(state);
    }
  });

  it('keeps an explicit null (Stripe unreadable) as null, never a guess', () => {
    expect(normalizePayoutJourney({ payoutState: null, connected: true, chargesEnabled: true, payoutsEnabled: true })!.state).toBeNull();
  });

  it('never defaults to active: an older connected response without detail is unfinished', () => {
    expect(normalizePayoutJourney({ connected: true, chargesEnabled: true, payoutsEnabled: true })!.state).toBe('onboarding_incomplete');
    expect(normalizePayoutJourney({})!.state).toBe('not_started');
    expect(normalizePayoutJourney({ payoutState: 'bogus', connected: false })!.state).toBe('not_started');
  });

  it('maps older setupState values', () => {
    expect(normalizePayoutJourney({ setupState: 'in_progress' })!.state).toBe('onboarding_incomplete');
    expect(normalizePayoutJourney({ setupState: 'in_review' })!.state).toBe('pending_verification');
    expect(normalizePayoutJourney({ setupState: 'restricted' })!.state).toBe('action_needed');
    expect(normalizePayoutJourney({ setupState: 'complete' })!.state).toBe('active');
  });

  it('carries what Stripe needs and the deadline for action_needed', () => {
    const j = normalizePayoutJourney(fixtureJourneyStatus('action_needed'))!;
    expect(j.actionItems).toEqual([{ step: 'identity', label: 'Identity', detail: 'Photo ID', pastDue: true }]);
    expect(j.deadline).toBe('2026-11-12T00:00:00.000Z');
    expect(j.rejected).toBe(false);
  });

  it('falls back to needed steps when an older server sends no actionItems', () => {
    const j = normalizePayoutJourney({
      payoutState: 'action_needed',
      steps: [
        { id: 'identity', label: 'Identity', status: 'complete', detail: 'Verified', pastDue: false },
        { id: 'bank_account', label: 'Bank account', status: 'needed', detail: 'Add a payout bank account', pastDue: false },
        { id: 'tax_info', label: 'Tax info', status: 'complete', detail: 'W-9 on file', pastDue: false },
      ],
    })!;
    expect(j.actionItems).toEqual([{ step: 'bank_account', label: 'Bank account', detail: 'Add a payout bank account', pastDue: false }]);
  });

  it('flags a Stripe rejection', () => {
    expect(normalizePayoutJourney({ payoutState: 'action_needed', disabledReason: 'rejected.fraud' })!.rejected).toBe(true);
  });
});

describe('showsManagePage', () => {
  const j = (status: Record<string, unknown>) => normalizePayoutJourney(status)!;
  it('is the manage page only when active', () => {
    expect(showsManagePage(j(fixtureJourneyStatus('active')))).toBe(true);
    for (const s of ['not_started', 'onboarding_incomplete', 'pending_verification', 'action_needed'] as const) {
      expect(showsManagePage(j(fixtureJourneyStatus(s)))).toBe(false);
    }
  });
  it('keeps the manage page when Stripe wants info but payouts still flow', () => {
    expect(showsManagePage(j({ payoutState: 'action_needed', payoutsEnabled: true }))).toBe(true);
    expect(showsManagePage(j({ payoutState: 'action_needed', payoutsEnabled: true, disabledReason: 'rejected.other' }))).toBe(false);
  });
});

describe('journeyCopy', () => {
  it('gives every pre-active state a title, a body and (except waiting) one action', () => {
    expect(journeyCopy('not_started').cta).toBe('Set up payouts');
    expect(journeyCopy('onboarding_incomplete').cta).toBe('Resume setup');
    expect(journeyCopy('pending_verification')).toMatchObject({ title: 'Stripe is verifying your info', cta: null });
    expect(journeyCopy('action_needed').cta).toBe('Update info on Stripe');
    expect(journeyCopy('action_needed', { rejected: true }).cta).toBe('Contact support');
  });
  it('never says unavailable', () => {
    for (const s of ['not_started', 'onboarding_incomplete', 'pending_verification', 'action_needed'] as const) {
      for (const rejected of [false, true]) {
        expect(JSON.stringify(journeyCopy(s, { rejected }))).not.toMatch(/unavailable/i);
      }
    }
  });
});

describe('dev web preview', () => {
  it('a fresh seller preview lands on the setup stage (state 1)', () => {
    const hit = resolvePreviewApiResponse('/api/seller/connect/status', { role: 'seller', demo: false });
    const j = normalizePayoutJourney(hit!.data)!;
    expect(j.state).toBe('not_started');
    expect(showsManagePage(j)).toBe(false);
  });
  it('the demo seller (with paid orders) is active', () => {
    const hit = resolvePreviewApiResponse('/api/seller/connect/status', { role: 'seller', demo: true });
    expect(normalizePayoutJourney(hit!.data)!.state).toBe('active');
  });
});
