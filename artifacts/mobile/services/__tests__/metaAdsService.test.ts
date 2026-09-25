/**
 * Meta Ads Service Tests — Vitest (matches project test conventions)
 */

import { describe, it, expect } from 'vitest';
import {
  formatBudgetCents,
  BUDGET_STEPS,
  BUDGET_MIN_CENTS,
  BUDGET_MAX_CENTS,
  META_OBJECTIVE_OPTIONS,
  META_CTA_OPTIONS,
  metaCampaignStatusVariant,
  metaCampaignStatusLabel,
  buildMetaAdsReturnUrl,
  formatReachRange,
} from '../metaAdsService';

describe('metaAdsService', () => {
  it('formats whole-dollar budgets', () => {
    expect(formatBudgetCents(500)).toBe('$5');
    expect(formatBudgetCents(100_000)).toBe('$1,000');
  });

  it('reuses the shared $5–$1000 budget step contract', () => {
    expect(BUDGET_MIN_CENTS).toBe(500);
    expect(BUDGET_MAX_CENTS).toBe(100_000);
    expect(BUDGET_STEPS[0]).toBe(500);
    expect(BUDGET_STEPS[BUDGET_STEPS.length - 1]).toBe(100_000);
  });

  it('exposes exactly three objectives mapping to the server enum', () => {
    expect(META_OBJECTIVE_OPTIONS.map((o) => o.objective)).toEqual(['sales', 'traffic', 'awareness']);
  });

  it('exposes Meta\'s own small CTA set', () => {
    expect(META_CTA_OPTIONS.map((o) => o.value)).toEqual(['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP']);
  });

  it('maps campaign status to a StatusBadge variant', () => {
    expect(metaCampaignStatusVariant('active')).toBe('success');
    expect(metaCampaignStatusVariant('in_review')).toBe('warning');
    expect(metaCampaignStatusVariant('rejected')).toBe('error');
    expect(metaCampaignStatusVariant('failed')).toBe('error');
    expect(metaCampaignStatusVariant('paused')).toBe('neutral');
    expect(metaCampaignStatusVariant('draft')).toBe('neutral');
  });

  it('gives every status a human label', () => {
    expect(metaCampaignStatusLabel('in_review')).toBe('In review');
    expect(metaCampaignStatusLabel('draft')).toBe('Draft');
  });

  it('builds the native and web OAuth return URLs', () => {
    expect(buildMetaAdsReturnUrl()).toBe('brandthread://meta-ads-connect');
    expect(buildMetaAdsReturnUrl('https://brandthread.app')).toBe('https://brandthread.app/meta-ads-connect');
  });

  it('formats an estimated reach range', () => {
    expect(formatReachRange(1000, 2500)).toBe('1,000–2,500 people');
  });
});
