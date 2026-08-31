import { describe, expect, it } from 'vitest';
import { getSellerPlan, recommendSellerPlan, SELLER_PLANS } from './sellerPlans';

describe('seller plan recommendations', () => {
  it('keeps modest idea-stage sellers on Starter', () => {
    expect(recommendSellerPlan('idea', ['Launch my store']).planId).toBe('starter');
  });

  it('recommends Growth for active product-building and sourcing needs', () => {
    expect(recommendSellerPlan('build', ['Find manufacturers']).planId).toBe('growth');
  });

  it('recommends Scale for scaling brands with operational goals', () => {
    const result = recommendSellerPlan('scale', ['Manage production', 'Understand analytics']);
    expect(result.planId).toBe('scale');
    expect(result.reason).toContain('manage production');
  });

  it('publishes three distinct plan choices with honest feature differences', () => {
    expect(SELLER_PLANS.map((plan) => plan.id)).toEqual(['starter', 'growth', 'scale']);
    expect(SELLER_PLANS[1].features.join(' ')).toContain('Manufacturer Hub');
    expect(SELLER_PLANS[2].features.join(' ')).toContain('Live shopping');
  });

  it('keeps public names and monthly prices in one catalogue', () => {
    expect(SELLER_PLANS.map(({ id, name, priceLabel }) => ({ id, name, priceLabel }))).toEqual([
      { id: 'starter', name: 'Starter', priceLabel: '$29' },
      { id: 'growth', name: 'Growth', priceLabel: '$79' },
      { id: 'scale', name: 'Scale', priceLabel: '$199' },
    ]);
  });

  it('maps the retired Pro identifier to Growth without exposing Pro', () => {
    expect(getSellerPlan('pro')).toMatchObject({
      id: 'growth',
      name: 'Growth',
      priceLabel: '$79',
    });
  });
});