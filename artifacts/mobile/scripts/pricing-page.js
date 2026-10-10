/**
 * Seller pricing for the public site: the "Pricing" section on the landing
 * page and the standalone /pricing page. Layout follows Shopify's plan picker
 * (plan columns: name, who it is for, what is included, price, "Try <plan>",
 * trial line under the button; then compare plans and FAQ), in Brandthread's
 * black, white and silver.
 *
 * Every number comes from scripts/plan-catalogue.js, which reads the same
 * catalogue files the app and the server use. Nothing here sets a price.
 *
 * The landing section is fully static. /pricing adds one same-origin request
 * to the public GET /api/public/web-annual-plans: it lists the optional
 * web-only yearly prices (STRIPE_PRICE_<TIER>_ANNUAL_WEB) and is empty until
 * Dev sets one, in which case the page looks exactly like the static version.
 */

const PRICING_PATH = '/pricing';
const PRICING_TITLE = 'Pricing | Brandthread';
const PRICING_DESCRIPTION =
  'Brandthread seller plans: Starter, Growth and Pro. Every plan starts with a free trial. See monthly prices, fees per sale and what each plan includes.';
const WEB_ANNUAL_ENDPOINT = '/api/public/web-annual-plans';

// Where the buttons go. New sellers create an account (the seller onboarding
// ends on the plan screen, which runs Stripe Checkout on the web); people who
// already have an account sign in and land on the plan screen directly.
const PRICING_ROUTES = {
  startTrial: '/onboarding',
  signInToPlans: `/sign-in?returnTo=${encodeURIComponent('/plans')}`,
};

/** Yearly (web-only) checkout: sign in, then /subscribe opens Stripe Checkout. ES5: inlined into /pricing. */
function annualCheckoutHref(planId) {
  return '/sign-in?returnTo=' + encodeURIComponent('/subscribe?plan=' + planId + '&billing=annual');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 2900 -> "$29", 1950 -> "$19.50", 120000 -> "$1,200". ES5: also inlined into /pricing. */
function formatPrice(cents) {
  var whole = Math.floor(cents / 100);
  var rest = cents % 100;
  var dollars = whole.toLocaleString('en-US');
  return rest === 0 ? '$' + dollars : '$' + dollars + '.' + (rest < 10 ? '0' : '') + rest;
}

/** 500 -> "5%", 290 -> "2.9%", 125 -> "1.25%". */
function percentLabel(bps) {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

/** { bps: 290, fixedCents: 30 } -> "2.9% + 30¢". */
function processingLabel(processing) {
  const fixed = processing.fixedCents < 100 ? `${processing.fixedCents}¢` : formatPrice(processing.fixedCents);
  return `${percentLabel(processing.bps)} + ${fixed}`;
}

function countLabel(n) {
  return n.toLocaleString('en-US');
}

/**
 * The first charge date for a trial that starts at `now`, like "Oct 20".
 * Kept to ES5 so the same function is inlined into the page and runs in the
 * visitor's browser at view time (a static page must not bake in a date).
 */
function chargeDateLabel(trialDays, now) {
  var d = new Date(now.getTime());
  d.setDate(d.getDate() + trialDays);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Dev's trial copy, word for word:
 * "Free for 7 days. You won't be charged until Oct 20. We'll remind you 2 days before. Cancel anytime."
 * `dateHtml` is the date (or the placeholder the browser script fills in).
 */
function trialLineHtml(trialDays, reminderDaysBefore, dateHtml) {
  return `Free for ${plural(trialDays, 'day')}. You won’t be charged until ${dateHtml}. We’ll remind you ${plural(reminderDaysBefore, 'day')} before. Cancel anytime.`;
}

function trialDatePlaceholder(trialDays) {
  // Shown only until the inline script runs (or with scripts off).
  return `<span data-charge-date>${plural(trialDays, 'day')} from today</span>`;
}

/** The limit and fee rows every plan column shows, all from the catalogue. */
function keyRows(plan, catalogue) {
  return [
    `${percentLabel(plan.platformFeeBps)} Brandthread fee per sale`,
    `Card processing ${processingLabel(catalogue.processing)}`,
    plan.productLimit === null ? 'Unlimited products' : `Up to ${countLabel(plan.productLimit)} products`,
    plan.teamSeats === null
      ? 'Unlimited team members'
      : plan.teamSeats === 0
        ? 'Owner account only'
        : `Up to ${countLabel(plan.teamSeats)} team members`,
    plan.monthlyAiCredits === null ? 'Unlimited AI credits' : `${countLabel(plan.monthlyAiCredits)} AI credits a month`,
  ];
}

function priceHtml(plan) {
  return `<p class="price" data-price-for="${plan.id}"><strong>${formatPrice(plan.priceCents)}</strong><span>USD/month</span></p>`;
}

function planColumn(plan, catalogue, { full }) {
  const rows = full ? [...keyRows(plan, catalogue), ...plan.features] : keyRows(plan, catalogue);
  return `<article class="plan" data-plan="${plan.id}">
  <h3>${escapeHtml(plan.name)}</h3>
  <p class="for">${escapeHtml(plan.tagline)}</p>
  <ul class="rows">${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>
  ${priceHtml(plan)}
  <a class="btn solid cta" href="${PRICING_ROUTES.startTrial}" data-flow="seller" data-cta-for="${plan.id}">Try ${escapeHtml(plan.name)}</a>
  <p class="trial">${trialLineHtml(catalogue.trialDays, catalogue.reminderDaysBefore, trialDatePlaceholder(catalogue.trialDays))}</p>
</article>`;
}

function plansGrid(catalogue, { full }) {
  return `<div class="plans">${catalogue.plans.map((plan) => planColumn(plan, catalogue, { full })).join('\n')}</div>`;
}

function introLine(catalogue) {
  return `Pick a plan and add a card to start your ${catalogue.trialDays}-day free trial.`;
}

/** Fills in the charge date at view time. Same function the tests exercise. */
function trialDateScript(catalogue) {
  return `(function(){
  ${chargeDateLabel.toString()}
  var label = chargeDateLabel(${Number(catalogue.trialDays)}, new Date());
  var spots = document.querySelectorAll('[data-charge-date]');
  for (var i = 0; i < spots.length; i++) spots[i].textContent = label;
})();`;
}

/** The section inserted into the landing page (static, no requests). */
function renderLandingPricingSection(catalogue) {
  return `<section id="pricing" aria-labelledby="pricing-title">
    <div class="wrap">
      <h2 id="pricing-title">Pricing.</h2>
      <p class="sub">${escapeHtml(introLine(catalogue))}</p>
      ${plansGrid(catalogue, { full: false })}
      <p class="plans-foot"><a href="${PRICING_PATH}">Compare plans</a><a href="${PRICING_ROUTES.signInToPlans}">Log in to choose a plan</a></p>
    </div>
  </section>`;
}

function featureMatrix(catalogue) {
  // Same carry-forward rule as lib/sellerPlansDisplay.ts: a tier includes
  // every feature listed by any tier at or below it.
  const strip = (f) => f.replace(/^Everything in [A-Za-z]+,?\s*/i, '').trim();
  const rows = [];
  for (const plan of catalogue.plans) {
    for (const feature of plan.features) {
      const key = strip(feature);
      if (key && !rows.includes(key)) rows.push(key);
    }
  }
  return rows.map((feature) => ({
    feature,
    included: catalogue.plans.map((_, tier) => catalogue.plans.slice(0, tier + 1).some((p) => p.features.some((f) => strip(f) === feature))),
  }));
}

function compareTable(catalogue) {
  const head = catalogue.plans.map((p) => `<th scope="col">${escapeHtml(p.name)}</th>`).join('');
  const valueRows = [
    ['Price', catalogue.plans.map((p) => `${formatPrice(p.priceCents)}/mo`)],
    ['Brandthread fee per sale', catalogue.plans.map((p) => percentLabel(p.platformFeeBps))],
    ['Card processing', catalogue.plans.map(() => processingLabel(catalogue.processing))],
    ['Products', catalogue.plans.map((p) => (p.productLimit === null ? 'Unlimited' : countLabel(p.productLimit)))],
    ['Team members', catalogue.plans.map((p) => (p.teamSeats === null ? 'Unlimited' : countLabel(p.teamSeats)))],
    ['AI credits a month', catalogue.plans.map((p) => (p.monthlyAiCredits === null ? 'Unlimited' : countLabel(p.monthlyAiCredits)))],
  ];
  const featureRows = featureMatrix(catalogue).map(({ feature, included }) => [
    feature,
    included.map((yes) => (yes ? '<span aria-label="Included">&#10003;</span>' : '<span aria-label="Not included">&mdash;</span>')),
    true,
  ]);
  const body = [...valueRows, ...featureRows]
    .map(([label, cells, raw]) => `<tr><th scope="row">${escapeHtml(label)}</th>${cells.map((c) => `<td>${raw ? c : escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="compare"><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function faqItems(catalogue) {
  const fees = catalogue.plans.map((p) => `${percentLabel(p.platformFeeBps)} on ${p.name}`).join(', ');
  const days = plural(catalogue.trialDays, 'day');
  const reminder = plural(catalogue.reminderDaysBefore, 'day');
  return [
    {
      q: 'How does the free trial work?',
      a: `Pick a plan and add a card to start. It\u2019s free for ${days}, and you won\u2019t be charged until the trial ends. We\u2019ll remind you ${reminder} before. Cancel anytime: if you cancel during the trial, you\u2019re not charged and you keep access until it ends.`,
    },
    {
      q: 'What does Brandthread take from each sale?',
      a: `A fee on the item price of each sale: ${fees}. Card processing of ${processingLabel(catalogue.processing)} is taken from the total the buyer pays.`,
    },
    {
      q: 'Where can I subscribe?',
      a: 'On the web at brandthread.app, with a card through Stripe. You can also subscribe in the Brandthread app for iPhone and Android through the App Store or Google Play. Your plan works everywhere you sign in.',
    },
    {
      q: 'Can I change plans later?',
      a: 'Yes. Change your plan from Settings in the app at any time.',
    },
    {
      q: 'What happens to my store if I cancel?',
      a: 'You keep selling until the end of the period you paid for, or the end of your trial. After that, pick a plan to keep selling. Your products and orders are kept.',
    },
  ];
}

const PRICING_CSS = `
.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line)}
.plan{display:flex;flex-direction:column;padding:32px 28px 8px;border-left:1px solid var(--line)}
.plan:first-child{border-left:0;padding-left:0}
.plan:last-child{padding-right:0}
.plan h3{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:0 0 4px}
.plan .for{margin:0 0 20px;color:var(--silver);font-size:16px}
.plan .rows{list-style:none;margin:0 0 28px;padding:0;flex:1}
.plan .rows li{padding:10px 0;border-top:1px solid var(--line);font-size:15px;line-height:1.4}
.price{display:flex;align-items:baseline;gap:8px;margin:0 0 16px;flex-wrap:wrap}
.price strong{font-size:40px;line-height:1;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.price span{color:var(--silver);font-size:14px}
.price em{font-style:normal;color:var(--silver);font-size:14px;flex-basis:100%}
.plan .cta{width:100%}
.plan .trial{margin:12px 0 24px;color:var(--silver);font-size:13px;line-height:1.45;text-wrap:pretty}
.plans-foot{display:flex;flex-wrap:wrap;gap:12px 28px;margin:24px 0 0;font-size:15px}
.plans-foot a{color:var(--white);font-weight:600}
@media (max-width:860px){
.plans{grid-template-columns:1fr}
.plan,.plan:first-child,.plan:last-child{border-left:0;padding:28px 0 4px}
.plan+.plan{border-top:1px solid var(--line)}
}
`.trim();

const PRICING_PAGE_CSS = `
body{font-family:system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,sans-serif}
.page-head{padding-top:48px;padding-bottom:40px;border-top:0}
.page-head h1{font-size:56px;margin:0 0 12px}
.page-head .sub{margin-bottom:0}
.billing{display:inline-grid;grid-template-columns:1fr 1fr;gap:4px;margin:28px 0 0;padding:4px;border:1px solid var(--line);border-radius:12px}
.billing[hidden]{display:none}
.billing button{min-height:40px;padding:0 16px;border:0;border-radius:8px;background:var(--black);color:var(--silver);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.billing button[aria-pressed="true"]{background:var(--white);color:var(--black)}
.pricing-main{padding-top:0;border-top:0}
.compare{width:100%;border-collapse:collapse;font-size:15px}
.compare th,.compare td{padding:14px 12px;border-top:1px solid var(--line);text-align:center;vertical-align:top;font-variant-numeric:tabular-nums}
.compare thead td,.compare thead th{border-top:0;font-weight:700;font-size:16px}
.compare th[scope="row"]{text-align:left;font-weight:400;color:var(--silver);padding-left:0;width:40%}
.faq>*{max-width:760px}
.faq details{border-top:1px solid var(--line)}
.faq details:last-child{border-bottom:1px solid var(--line)}
.faq summary{display:flex;justify-content:space-between;gap:16px;padding:20px 0;font-size:18px;font-weight:600;cursor:pointer;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--silver);font-weight:400}
.faq details[open] summary::after{content:"\\2212"}
.faq details p{margin:0 0 20px;color:var(--silver);font-size:16px;max-width:42em}
@media (max-width:860px){.page-head h1{font-size:44px}}
@media (max-width:480px){
.page-head{padding-top:24px}
.page-head h1{font-size:36px}
.compare{font-size:13px}
.compare th,.compare td{padding:12px 4px}
.compare th[scope="row"]{width:auto}
}
`.trim();

/**
 * Optional web-only yearly prices. Only runs on /pricing. The endpoint is
 * public and returns { plans: [] } until a STRIPE_PRICE_<TIER>_ANNUAL_WEB is
 * set, so by default nothing on the page changes.
 */
function annualScript(catalogue) {
  const monthly = {};
  for (const p of catalogue.plans) monthly[p.id] = { cents: p.priceCents, name: p.name };
  return `(function(){
  if (!window.fetch) return;
  var monthly = ${JSON.stringify(monthly)};
  ${formatPrice.toString()}
  ${annualCheckoutHref.toString()}
  fetch(${JSON.stringify(WEB_ANNUAL_ENDPOINT)}, { credentials: 'omit', headers: { accept: 'application/json' } })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      var offers = {};
      var list = data && Array.isArray(data.plans) ? data.plans : [];
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o && monthly[o.planId] && typeof o.amountCents === 'number' && o.amountCents > 0 && Math.floor(o.amountCents) === o.amountCents) offers[o.planId] = o.amountCents;
      }
      if (!Object.keys(offers).length) return;
      var toggle = document.querySelector('.billing');
      var originals = {};
      document.querySelectorAll('[data-price-for]').forEach(function(el){ originals[el.getAttribute('data-price-for')] = el.innerHTML; });
      function show(yearly){
        toggle.querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', String((b.getAttribute('data-billing') === 'yearly') === yearly)); });
        Object.keys(monthly).forEach(function(id){
          var price = document.querySelector('[data-price-for="' + id + '"]');
          var cta = document.querySelector('[data-cta-for="' + id + '"]');
          if (!price || !cta) return;
          if (yearly && offers[id]) {
            var full = monthly[id].cents * 12;
            var save = full > offers[id] ? Math.floor((full - offers[id]) * 100 / full) : 0;
            price.innerHTML = '<strong>' + formatPrice(offers[id]) + '</strong><span>USD/year</span><em>Billed yearly on the web' + (save > 0 ? '. Save ' + save + '% compared with monthly.' : '.') + '</em>';
            cta.setAttribute('href', annualCheckoutHref(id));
            cta.removeAttribute('data-flow');
          } else {
            price.innerHTML = originals[id];
            cta.setAttribute('href', ${JSON.stringify(PRICING_ROUTES.startTrial)});
            cta.setAttribute('data-flow', 'seller');
          }
        });
      }
      toggle.hidden = false;
      toggle.addEventListener('click', function(e){
        var b = e.target.closest('button');
        if (b) show(b.getAttribute('data-billing') === 'yearly');
      });
    })
    .catch(function(){});
})();`;
}

function flowScript(pendingFlowKey) {
  return `(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[data-flow]');
    if (!a) return;
    try { localStorage.setItem(${JSON.stringify(pendingFlowKey)}, a.getAttribute('data-flow')); } catch (err) {}
  });
})();`;
}

/** The standalone /pricing page. `shell` supplies the landing page's shared chrome. */
function renderPricingHtml(catalogue, shell) {
  const { CANONICAL_ORIGIN, LOGO_URL, BASE_CSS, ROUTES, PENDING_FLOW_KEY } = shell;
  const canonical = `${CANONICAL_ORIGIN}${PRICING_PATH}`;
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: PRICING_TITLE,
    description: PRICING_DESCRIPTION,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'Brandthread', url: CANONICAL_ORIGIN },
  }).replace(/</g, '\\u003c');
  const faq = faqItems(catalogue)
    .map(({ q, a }) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${PRICING_TITLE}</title>
<meta name="description" content="${PRICING_DESCRIPTION}" />
<meta name="theme-color" content="#000000" />
<meta name="color-scheme" content="dark" />
<link rel="canonical" href="${canonical}" />
<link rel="icon" type="image/png" href="/brandthread-logo.png" />
<meta name="robots" content="index,follow" />
<meta property="og:site_name" content="Brandthread" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${PRICING_TITLE}" />
<meta property="og:description" content="${PRICING_DESCRIPTION}" />
<meta property="og:image" content="${LOGO_URL}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${PRICING_TITLE}" />
<meta name="twitter:description" content="${PRICING_DESCRIPTION}" />
<meta name="twitter:image" content="${LOGO_URL}" />
<script type="application/ld+json">${ld}</script>
<style>${BASE_CSS}
${PRICING_CSS}
${PRICING_PAGE_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <div class="wrap bar">
    <a class="brand" href="/welcome" aria-label="Brandthread home"><img src="/brandthread-logo.png" alt="" width="36" height="36" /><span>Brandthread</span></a>
    <nav class="nav" aria-label="Account">
      <a class="text" href="${ROUTES.signIn}">Log in</a>
      <a class="btn solid small" href="${ROUTES.signUp}" data-flow="seller">Start selling</a>
    </nav>
  </div>
</header>
<main id="main">
  <section class="page-head" aria-labelledby="pricing-title">
    <div class="wrap">
      <h1 id="pricing-title">Choose a plan.</h1>
      <p class="sub">${escapeHtml(introLine(catalogue))}</p>
      <div class="billing" role="group" aria-label="Billing" hidden><button type="button" data-billing="monthly" aria-pressed="true">Monthly</button><button type="button" data-billing="yearly" aria-pressed="false">Yearly on the web</button></div>
    </div>
  </section>
  <section class="pricing-main" aria-label="Plans">
    <div class="wrap">
      ${plansGrid(catalogue, { full: true })}
      <p class="plans-foot"><a href="${PRICING_ROUTES.signInToPlans}">Already selling on Brandthread? Log in to choose a plan</a></p>
    </div>
  </section>
  <section aria-labelledby="compare-title">
    <div class="wrap">
      <h2 id="compare-title">Compare plans</h2>
      ${compareTable(catalogue)}
    </div>
  </section>
  <section aria-labelledby="faq-title">
    <div class="wrap faq">
      <h2 id="faq-title">Pricing FAQ</h2>
      ${faq}
    </div>
  </section>
  <section class="final" aria-labelledby="final-title">
    <div class="wrap">
      <h2 id="final-title">Start selling on Brandthread.</h2>
      <p class="sub">${escapeHtml(introLine(catalogue))}</p>
      <div class="ctas"><a class="btn solid" href="${ROUTES.signUp}" data-flow="seller">Start selling</a><a class="btn ghost" href="${PRICING_ROUTES.signInToPlans}">Log in</a></div>
    </div>
  </section>
</main>
<footer>
  <div class="wrap foot">
    <p>&copy; Brandthread</p>
    <nav aria-label="Legal and support">
      <a href="${ROUTES.privacy}">Privacy</a>
      <a href="${ROUTES.terms}">Terms</a>
      <a href="/seller-agreement">Seller agreement</a>
      <a href="${ROUTES.support}">Support</a>
    </nav>
  </div>
</footer>
<script>
${trialDateScript(catalogue)}
${flowScript(PENDING_FLOW_KEY)}
${annualScript(catalogue)}
</script>
</body>
</html>
`;
}

module.exports = {
  PRICING_CSS,
  PRICING_DESCRIPTION,
  PRICING_PATH,
  PRICING_ROUTES,
  PRICING_TITLE,
  WEB_ANNUAL_ENDPOINT,
  annualCheckoutHref,
  chargeDateLabel,
  faqItems,
  featureMatrix,
  formatPrice,
  keyRows,
  percentLabel,
  processingLabel,
  renderLandingPricingSection,
  renderPricingHtml,
  trialDateScript,
  trialLineHtml,
};
