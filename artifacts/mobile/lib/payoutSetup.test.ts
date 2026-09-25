import { describe, expect, it } from 'vitest';
import { requirementLabel, scheduleLabel, taxInfoConfig } from './payoutSetup';

const theme = { secondary: '#172554' };

describe('scheduleLabel', () => {
  it('explains an unset schedule', () => {
    expect(scheduleLabel(null)).toBe('Not set yet — connect Stripe to choose one');
    expect(scheduleLabel({ interval: null, delayDays: null, weeklyAnchor: null, monthlyAnchor: null }))
      .toBe('Not set yet — connect Stripe to choose one');
  });

  it('describes manual, daily, weekly, and monthly schedules', () => {
    expect(scheduleLabel({ interval: 'manual', delayDays: null, weeklyAnchor: null, monthlyAnchor: null }))
      .toBe('Manual — you trigger each payout');
    expect(scheduleLabel({ interval: 'daily', delayDays: 2, weeklyAnchor: null, monthlyAnchor: null }))
      .toBe('Daily (2-day rolling delay)');
    expect(scheduleLabel({ interval: 'weekly', delayDays: null, weeklyAnchor: 'friday', monthlyAnchor: null }))
      .toBe('Weekly, every Friday');
    expect(scheduleLabel({ interval: 'monthly', delayDays: null, weeklyAnchor: null, monthlyAnchor: 1 }))
      .toBe('Monthly, on day 1');
  });
});

describe('requirementLabel', () => {
  it('gives a friendly label for common Stripe requirement ids', () => {
    expect(requirementLabel('individual.id_number')).toBe('Tax ID / SSN verification');
    expect(requirementLabel('individual.verification.document')).toBe('Government ID document');
    expect(requirementLabel('external_account')).toBe('Bank account details');
    expect(requirementLabel('business_profile.url')).toBe('Business details');
    expect(requirementLabel('company.tax_id')).toBe('Tax ID / SSN verification');
  });

  it('falls back to a readable version of unknown fields', () => {
    expect(requirementLabel('some_unknown_field')).toBe('some unknown field');
  });
});

describe('taxInfoConfig', () => {
  it('maps each tax info status to a label', () => {
    expect(taxInfoConfig('submitted', theme).label).toBe('On file');
    expect(taxInfoConfig('needed', theme).label).toBe('Action needed');
    expect(taxInfoConfig('unknown', theme).label).toBe('Not available yet');
  });
});
