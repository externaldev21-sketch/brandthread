import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SELLER_PLANS } from '../lib/sellerPlans';

const projectRoot = path.resolve(__dirname, '..');
const catalogueMod = require('./plan-catalogue.js');
const pricing = require('./pricing-page.js');
const landing = require('./landing-page.js');
const serverLanding = require('../server/landing.js');

const catalogue = catalogueMod.loadPlanCatalogue();
const shell = {
  CANONICAL_ORIGIN: landing.CANONICAL_ORIGIN,
  LOGO_URL: landing.LOGO_URL,
  BASE_CSS: landing.BASE_CSS,
  ROUTES: landing.ROUTES,
  PENDING_FLOW_KEY: landing.PENDING_FLOW_KEY,
};

describe('plan catalogue (build time)', () => {
  it('reads the same plans the app shows, priced as Stripe charges them', () => {
    expect(catalogue.plans.map((p: any) => p.id)).toEqual(SELLER_PLANS.map((p) => p.id));
    for (const plan of catalogue.plans) {
      const app = SELLER_PLANS.find((p) => p.id === plan.id)!;
      expect(plan.name).toBe(app.name);
      expect(plan.features).toEqual(app.features);
      // The app's display price and the server's billed price must agree.
      expect(plan.priceCents).toBe(app.priceCents);
    }
  });

  it('reads fees, limits and credits from the server constants', async () => {
    const { PLAN_PERKS } = catalogueMod.loadTsModule(catalogueMod.SOURCES.perks);
    const { PLAN_CATALOGUE } = catalogueMod.loadTsModule(catalogueMod.SOURCES.catalogue);
    const { STRIPE_PROCESSING_BPS, STRIPE_PROCESSING_FIXED_CENTS } = catalogueMod.loadTsModule(catalogueMod.SOURCES.fees);
    for (const plan of catalogue.plans) {
      expect(plan.platformFeeBps).toBe(PLAN_PERKS[plan.id].platformFeeBps);
      expect(plan.productLimit).toBe(PLAN_CATALOGUE[plan.id].limits.products);
      expect(plan.teamSeats).toBe(PLAN_CATALOGUE[plan.id].limits.teamSeats);
    }
    expect(catalogue.processing).toEqual({ bps: STRIPE_PROCESSING_BPS, fixedCents: STRIPE_PROCESSING_FIXED_CENTS });
  });

  it("uses Dev's trial terms (7 days, reminder 2 days before) unless the server config sets them", () => {
    if (catalogue.trialFromServerConfig) {
      const { TRIAL_DAYS, TRIAL_REMINDER_DAYS_BEFORE } = catalogueMod.loadTsModule(catalogueMod.SOURCES.catalogue);
      expect(catalogue.trialDays).toBe(TRIAL_DAYS);
      expect(catalogue.reminderDaysBefore).toBe(TRIAL_REMINDER_DAYS_BEFORE);
    } else {
      expect(catalogue.trialDays).toBe(7);
      expect(catalogue.reminderDaysBefore).toBe(2);
    }
  });
});

describe('formatting helpers', () => {
  it('formats prices, percentages and processing', () => {
    expect(pricing.formatPrice(2900)).toBe('$29');
    expect(pricing.formatPrice(19900)).toBe('$199');
    expect(pricing.formatPrice(1950)).toBe('$19.50');
    expect(pricing.formatPrice(1905)).toBe('$19.05');
    expect(pricing.formatPrice(199000)).toBe('$1,990');
    expect(pricing.percentLabel(500)).toBe('5%');
    expect(pricing.percentLabel(290)).toBe('2.9%');
    expect(pricing.percentLabel(125)).toBe('1.25%');
    expect(pricing.processingLabel({ bps: 290, fixedCents: 30 })).toBe('2.9% + 30¢');
  });

  it('computes the first charge date like "Oct 20", across month and year ends', () => {
    expect(pricing.chargeDateLabel(7, new Date(2026, 9, 13, 12))).toBe('Oct 20');
    expect(pricing.chargeDateLabel(7, new Date(2026, 9, 28, 23, 59))).toBe('Nov 4');
    expect(pricing.chargeDateLabel(7, new Date(2026, 11, 29, 0, 1))).toBe('Jan 5');
    expect(pricing.chargeDateLabel(7, new Date(2028, 1, 25))).toBe('Mar 3');
  });

  it("matches Dev's trial copy word for word", () => {
    expect(pricing.trialLineHtml(7, 2, 'Oct 20')).toBe(
      'Free for 7 days. You won’t be charged until Oct 20. We’ll remind you 2 days before. Cancel anytime.',
    );
    expect(pricing.trialLineHtml(1, 1, 'Oct 14')).toBe(
      'Free for 1 day. You won’t be charged until Oct 14. We’ll remind you 1 day before. Cancel anytime.',
    );
  });

  it('labels limits from the catalogue', () => {
    const [starter, growth, pro] = catalogue.plans;
    expect(pricing.keyRows(starter, catalogue)).toContain('Up to 25 products');
    expect(pricing.keyRows(starter, catalogue)).toContain('Owner account only');
    expect(pricing.keyRows(growth, catalogue)).toContain('Up to 3 team members');
    expect(pricing.keyRows(pro, catalogue)).toContain('Unlimited team members');
    expect(pricing.keyRows(pro, catalogue)[0]).toBe(`${pricing.percentLabel(pro.platformFeeBps)} Brandthread fee per sale`);
  });

  it('carries features forward to higher tiers in the comparison', () => {
    const matrix = pricing.featureMatrix(catalogue);
    const first = matrix.find((r: any) => r.feature === SELLER_PLANS[0].features[0]);
    expect(first.included).toEqual([true, true, true]);
    const proOnly = matrix.find((r: any) => r.feature === 'Live shopping tools');
    expect(proOnly.included).toEqual([false, false, true]);
  });
});

/** Runs the page's inline scripts in a tiny fake DOM to check the date fill-in. */
function runTrialScript(html: string, now: Date) {
  const spots = [{ textContent: '' }, { textContent: '' }];
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: any[]) { super(...((args.length ? args : [now.getTime()]) as [])); }
  }
  const script = pricing.trialDateScript(catalogue);
  expect(html).toContain(script);
  vm.runInNewContext(script, { document: { querySelectorAll: () => spots }, Date: FixedDate });
  return spots.map((s) => s.textContent);
}

describe('landing pricing section', () => {
  const html = landing.renderLandingHtml({ pricing: catalogue });

  it('shows every plan with its price, a Try button into seller sign-up and the trial line', () => {
    for (const plan of catalogue.plans) {
      expect(html).toContain(`<h3>${plan.name}</h3>`);
      expect(html).toContain(`<strong>${pricing.formatPrice(plan.priceCents)}</strong>`);
      expect(html).toContain(`href="/onboarding" data-flow="seller" data-cta-for="${plan.id}">Try ${plan.name}</a>`);
    }
    expect(html.match(/class="trial"/g)).toHaveLength(catalogue.plans.length);
    expect(html).toContain(`Pick a plan and add a card to start your ${catalogue.trialDays}-day free trial.`);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/sign-in?returnTo=%2Fplans"');
  });

  it('fills in the charge date in the browser', () => {
    expect(runTrialScript(html, new Date(2026, 9, 13, 9))).toEqual(['Oct 20', 'Oct 20']);
  });

  it('stays static: no requests, so the signed-out page never calls an API', () => {
    expect(html).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\/api\//);
  });

  it('renders exactly as before without a catalogue', () => {
    const bare = landing.renderLandingHtml({});
    expect(bare).not.toContain('id="pricing"');
    expect(bare).not.toContain('/pricing');
  });
});

describe('/pricing page', () => {
  const html = pricing.renderPricingHtml(catalogue, shell);

  it('is a public, indexable page with its own canonical URL', () => {
    expect(html).toContain('<link rel="canonical" href="https://brandthread.app/pricing" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('<title>Pricing | Brandthread</title>');
  });

  it('follows the plan-picker structure: plans, compare table, FAQ', () => {
    const order = ['Choose a plan.', 'class="plans"', 'Compare plans', 'Pricing FAQ'].map((s) => html.indexOf(s));
    expect(order.every((i: number) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<details>/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('uses the system font, black/white/silver, no translucency, no fake proof', () => {
    expect(html).toContain('body{font-family:system-ui');
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    for (const [, hex] of css.matchAll(/#([0-9a-f]{3,6})\b/gi)) {
      const full = hex.length === 3 ? hex.split('').map((c: string) => c + c).join('') : hex;
      expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `#${hex}`).toBe(true);
    }
    expect(css).not.toMatch(/rgba\(|backdrop-filter|opacity\s*:\s*0?\.\d/);
    expect(html.toLowerCase()).not.toMatch(/coming soon|lorem|testimonial|trusted by|\d+\s?(k|m)?\+?\s*(downloads|users|sellers)/);
  });

  it('only calls the public yearly-price endpoint, and hides the toggle until it returns an offer', () => {
    const calls = [...html.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1]);
    expect(calls).toEqual([JSON.stringify(pricing.WEB_ANNUAL_ENDPOINT)]);
    expect(html).toContain("credentials: 'omit'");
    expect(html).toMatch(/<div class="billing"[^>]*hidden>/);
  });

  it('sends yearly buttons through sign-in to the /subscribe hand-off', () => {
    expect(pricing.annualCheckoutHref('growth')).toBe('/sign-in?returnTo=%2Fsubscribe%3Fplan%3Dgrowth%26billing%3Dannual');
    expect(fs.existsSync(path.join(projectRoot, 'app', 'subscribe.tsx'))).toBe(true);
  });

  it('fills in the charge date in the browser', () => {
    expect(runTrialScript(html, new Date(2026, 11, 29, 10))).toEqual(['Jan 5', 'Jan 5']);
  });

  it('states every fee from the catalogue in the FAQ', () => {
    const faq = pricing.faqItems(catalogue).map((f: any) => f.a).join(' ');
    for (const plan of catalogue.plans) expect(faq).toContain(`${pricing.percentLabel(plan.platformFeeBps)} on ${plan.name}`);
    expect(faq).toContain(pricing.processingLabel(catalogue.processing));
    expect(faq).toContain(`free for ${catalogue.trialDays} days`);
  });
});

describe('build output and serving', () => {
  it('writes pricing.html next to landing.html and serves it at /pricing for everyone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-pricing-'));
    try {
      landing.writeLandingPage(dir, projectRoot, {});
      expect(fs.existsSync(path.join(dir, 'pricing.html'))).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'landing.html'), 'utf8')).toContain('id="pricing"');
      const decide = (pathname: string, method = 'GET') => serverLanding.shouldServePricing({ method, pathname, staticRoot: dir });
      expect(decide('/pricing')).toBe(true);
      expect(decide('/pricing/')).toBe(true);
      expect(decide('/pricing', 'HEAD')).toBe(true);
      expect(decide('/pricing', 'POST')).toBe(false);
      expect(decide('/pricing-old')).toBe(false);
      expect(serverLanding.shouldServePricing({ method: 'GET', pathname: '/pricing', staticRoot: path.join(dir, 'missing') })).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists /pricing in the sitemap routes', () => {
    const buildWeb = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-web.js'), 'utf8');
    expect(buildWeb).toMatch(/const PUBLIC_ROUTES = \[[^\]]*'\/pricing'/);
  });
});
