import { describe, expect, it } from 'vitest';
import {
  completedCount,
  demoPayoutSetup,
  formatDeadline,
  normalizePayoutSetup,
  setupCtaLabel,
  setupHeadline,
} from '../payoutSetupSteps';

describe('normalizePayoutSetup', () => {
  it('returns null for junk', () => {
    expect(normalizePayoutSetup(null)).toBeNull();
    expect(normalizePayoutSetup('x')).toBeNull();
  });

  it('reads a full server response', () => {
    const r = normalizePayoutSetup({
      setupState: 'restricted', bankLast4: '6789', deadline: '2026-10-05T00:00:00.000Z',
      steps: [
        { id: 'identity', label: 'Identity', status: 'needed', detail: 'Photo ID', pastDue: true },
        { id: 'bank_account', status: 'complete', detail: 'Verified' },
        { id: 'tax_info', status: 'in_review', detail: 'Stripe is reviewing this' },
      ],
    })!;
    expect(r.state).toBe('restricted');
    expect(r.steps.map((s) => s.status)).toEqual(['needed', 'complete', 'in_review']);
    expect(r.steps[0].pastDue).toBe(true);
    expect(r.bankLast4).toBe('6789');
  });

  it('falls back for older servers without steps', () => {
    const r = normalizePayoutSetup({ connected: false })!;
    expect(r.state).toBe('not_started');
    expect(r.steps).toHaveLength(3);
    expect(r.steps.every((s) => s.status === 'needed')).toBe(true);
    expect(normalizePayoutSetup({ connected: true })!.state).toBe('in_progress');
  });

  it('rejects malformed bank digits', () => {
    expect(normalizePayoutSetup({ bankLast4: '12345678' })!.bankLast4).toBeNull();
  });
});

describe('copy and helpers', () => {
  it('maps each state to a CTA', () => {
    expect(setupCtaLabel('not_started')).toBe('Start setup');
    expect(setupCtaLabel('in_progress')).toBe('Continue setup');
    expect(setupCtaLabel('restricted')).toBe('Continue setup');
    expect(setupCtaLabel('in_review')).toBe('Refresh status');
    expect(setupCtaLabel('complete')).toBe('Open Stripe dashboard');
  });
  it('has the ready headline', () => {
    expect(setupHeadline('complete').title).toBe("You're ready to get paid");
  });
  it('counts and formats', () => {
    expect(completedCount(demoPayoutSetup('in_progress').steps)).toBe(1);
    expect(formatDeadline('2026-10-28T00:00:00.000Z')).toBe('Oct 28, 2026');
    expect(formatDeadline('nope')).toBeNull();
    expect(formatDeadline(null)).toBeNull();
  });
});
