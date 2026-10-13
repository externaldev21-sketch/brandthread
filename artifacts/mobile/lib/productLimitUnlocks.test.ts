import { describe, expect, it } from 'vitest';
import { PLAN_CATALOGUE } from '../../api-server/src/lib/planCatalogue';
import { ApiError } from './networkNotice';
import { SELLER_PLANS } from './sellerPlans';
import { PLAN_LIMITS, buildProductLimitUnlocks, parseProductLimitHit } from './productLimitUnlocks';

const limitError = (body: Record<string, unknown>) => new ApiError(403, JSON.stringify(body));
// The exact body lib/planAccess.ts sendPlanLimitReached sends for a Starter seller at the cap.
const starterAtCap = {
  error: 'Plan limit reached', code: 'PLAN_LIMIT_REACHED', resource: 'products',
  currentPlan: 'starter', requiredPlan: 'growth', limit: 25,
  message: 'Your Starter plan includes 25 products. Upgrade to add more.',
};

describe('PLAN_LIMITS', () => {
  it('matches the server plan catalogue exactly', () => {
    for (const id of ['starter', 'growth', 'pro'] as const) {
      expect(PLAN_LIMITS[id]).toEqual(PLAN_CATALOGUE[id].limits);
    }
  });

  it('prices match the server catalogue', () => {
    for (const plan of SELLER_PLANS) {
      expect(plan.priceCents).toBe(PLAN_CATALOGUE[plan.id as keyof typeof PLAN_CATALOGUE].amountCents);
    }
  });
});

describe('parseProductLimitHit', () => {
  it('reads the 403 body', () => {
    expect(parseProductLimitHit(limitError(starterAtCap))).toEqual({ currentPlan: 'starter', requiredPlan: 'growth', limit: 25 });
  });

  it('keeps nextLimit when the server sends it and treats "none" as no plan', () => {
    expect(parseProductLimitHit(limitError({ ...starterAtCap, currentPlan: 'none', requiredPlan: 'starter', limit: 0, nextLimit: 25 })))
      .toEqual({ currentPlan: null, requiredPlan: 'starter', limit: 0, nextLimit: 25 });
  });

  it('ignores team-seat limits, other codes and non-API errors', () => {
    expect(parseProductLimitHit(limitError({ ...starterAtCap, resource: 'teamSeats' }))).toBeNull();
    expect(parseProductLimitHit(limitError({ code: 'PLAN_REQUIRED', requiredPlan: 'growth' }))).toBeNull();
    expect(parseProductLimitHit(new Error('offline'))).toBeNull();
    expect(parseProductLimitHit(new ApiError(500, 'not json'))).toBeNull();
  });
});

describe('buildProductLimitUnlocks', () => {
  it('Starter at 25 → Growth: unlimited products, 3 seats, the Growth features, $49/mo', () => {
    const u = buildProductLimitUnlocks(parseProductLimitHit(limitError(starterAtCap))!)!;
    expect(u.title).toBe("You've reached 25 products");
    expect(u.cta).toBe('Upgrade to Growth');
    expect(u.price).toBe('$49/mo');
    expect(u.href).toBe('/plans?highlight=growth&source=product-limit');
    expect(u.rows).toEqual([
      { label: 'Up to 50 products', now: 'Now 25' },
      { label: '3 team seats', now: 'Now 1' },
      { label: 'AI logos, mockups, product photography, and lifestyle imagery' },
      { label: 'Background removal and replacement' },
      { label: 'Manufacturer Hub sourcing and production workflows' },
    ]);
  });

  it('every feature row comes from the catalogue, never "Everything in …"', () => {
    const u = buildProductLimitUnlocks({ currentPlan: 'starter', requiredPlan: 'growth', limit: 25 })!;
    const growth = SELLER_PLANS.find((p) => p.id === 'growth')!;
    for (const row of u.rows.filter((r) => !r.now)) expect(growth.features).toContain(row.label);
    expect(u.rows.some((r) => /^Everything in/.test(r.label))).toBe(false);
  });

  it('prefers the server nextLimit over the local copy', () => {
    const u = buildProductLimitUnlocks({ currentPlan: 'starter', requiredPlan: 'growth', limit: 10, nextLimit: 50 })!;
    expect(u.title).toBe("You've reached 10 products");
    expect(u.rows[0]).toEqual({ label: 'Up to 50 products', now: 'Now 10' });
  });

  it('Growth → Pro lists Pro seats and features', () => {
    const u = buildProductLimitUnlocks({ currentPlan: 'growth', requiredPlan: 'pro', limit: 50, nextLimit: null })!;
    expect(u.cta).toBe('Upgrade to Pro');
    expect(u.price).toBe('$129/mo');
    expect(u.rows[0]).toEqual({ label: 'Unlimited products', now: 'Now 50' });
    expect(u.rows[1]).toEqual({ label: 'Unlimited team seats', now: 'Now 3' });
    expect(u.rows.map((r) => r.label)).toContain('Live shopping tools');
  });

  it('a single product reads in the singular', () => {
    expect(buildProductLimitUnlocks({ currentPlan: 'starter', requiredPlan: 'growth', limit: 1 })!.title).toBe("You've reached 1 product");
  });
});
