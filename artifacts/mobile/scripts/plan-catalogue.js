/**
 * Build-time reader for the seller plan catalogue, used by the static landing
 * page and /pricing (scripts/pricing-page.js). Nothing here defines a price,
 * fee or limit: every number is read from the files the app and the server
 * already use, so the public pages can never drift from what is charged.
 *
 *   artifacts/mobile/lib/sellerPlans.ts             names, taglines, features (the plan screen)
 *   artifacts/api-server/src/lib/planCatalogue.ts   monthly price Stripe charges, product + team limits,
 *                                                   trial length once the shared plan config lands (#787)
 *   artifacts/api-server/src/lib/planPerks.ts       Brandthread fee per plan
 *   artifacts/api-server/src/lib/aiCredits/catalogue.ts  monthly AI credits per plan
 *   artifacts/api-server/src/lib/money/fees.ts      card processing rate
 *
 * The TypeScript sources are transpiled in memory with the `typescript`
 * package (already a dependency) and evaluated with a require() that only
 * follows relative imports inside the repo. planPerks' database import is
 * replaced by an empty stub because only its constant table is read.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCES = {
  appPlans: path.join(REPO_ROOT, 'artifacts/mobile/lib/sellerPlans.ts'),
  catalogue: path.join(REPO_ROOT, 'artifacts/api-server/src/lib/planCatalogue.ts'),
  perks: path.join(REPO_ROOT, 'artifacts/api-server/src/lib/planPerks.ts'),
  credits: path.join(REPO_ROOT, 'artifacts/api-server/src/lib/aiCredits/catalogue.ts'),
  fees: path.join(REPO_ROOT, 'artifacts/api-server/src/lib/money/fees.ts'),
};

// Dev's trial decision. Used only until the server's shared plan config
// (TRIAL_DAYS / TRIAL_REMINDER_DAYS_BEFORE in planCatalogue.ts, PR #787) is
// on the branch being built; after that the server value always wins.
const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_REMINDER_DAYS_BEFORE = 2;

// Imports that only matter at request time (database access). Their exports
// are never called while reading the constant tables.
const RUNTIME_ONLY_IMPORTS = new Set(['./nativeEntitlements']);

function resolveTs(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`plan-catalogue: cannot resolve ${specifier} from ${fromFile}`);
}

function loadTsModule(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const ts = require('typescript');
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  });
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (specifier) => {
    if (RUNTIME_ONLY_IMPORTS.has(specifier)) return {};
    if (!specifier.startsWith('.')) throw new Error(`plan-catalogue: ${file} imports ${specifier}, which is not read at build time`);
    return loadTsModule(resolveTs(file, specifier), cache);
  };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', outputText)(mod, mod.exports, localRequire, process);
  return mod.exports;
}

function positiveInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Everything the public pricing surfaces show, in tier order. Throws when a
 * source is missing or inconsistent so a broken catalogue never publishes.
 */
function loadPlanCatalogue() {
  const cache = new Map();
  const { SELLER_PLANS } = loadTsModule(SOURCES.appPlans, cache);
  const catalogue = loadTsModule(SOURCES.catalogue, cache);
  const { PLAN_PERKS } = loadTsModule(SOURCES.perks, cache);
  const { PLAN_CREDIT_POLICY } = loadTsModule(SOURCES.credits, cache);
  const { STRIPE_PROCESSING_BPS, STRIPE_PROCESSING_FIXED_CENTS } = loadTsModule(SOURCES.fees, cache);

  const plans = SELLER_PLANS.map((appPlan) => {
    const server = catalogue.PLAN_CATALOGUE[appPlan.id];
    const perks = PLAN_PERKS[appPlan.id];
    const credits = PLAN_CREDIT_POLICY[appPlan.id];
    if (!server || !perks || !credits) throw new Error(`plan-catalogue: ${appPlan.id} is missing from the server catalogue`);
    if (!positiveInt(server.amountCents)) throw new Error(`plan-catalogue: ${appPlan.id} has no valid price`);
    return {
      id: appPlan.id,
      name: appPlan.name,
      tagline: appPlan.tagline,
      highlight: Boolean(appPlan.highlight),
      // What Stripe Checkout charges on the web (routes/subscription.ts ensurePrice).
      priceCents: server.amountCents,
      appPriceCents: appPlan.priceCents,
      features: [...appPlan.features],
      productLimit: server.limits.products,
      teamSeats: server.limits.teamSeats,
      platformFeeBps: perks.platformFeeBps,
      monthlyAiCredits: credits.monthlyAllowance,
    };
  });

  const trialDays = positiveInt(catalogue.TRIAL_DAYS) ? catalogue.TRIAL_DAYS : DEFAULT_TRIAL_DAYS;
  const reminderDaysBefore = positiveInt(catalogue.TRIAL_REMINDER_DAYS_BEFORE)
    ? catalogue.TRIAL_REMINDER_DAYS_BEFORE
    : DEFAULT_REMINDER_DAYS_BEFORE;

  return {
    plans,
    trialDays,
    reminderDaysBefore,
    trialFromServerConfig: positiveInt(catalogue.TRIAL_DAYS),
    processing: { bps: STRIPE_PROCESSING_BPS, fixedCents: STRIPE_PROCESSING_FIXED_CENTS },
  };
}

module.exports = {
  DEFAULT_REMINDER_DAYS_BEFORE,
  DEFAULT_TRIAL_DAYS,
  SOURCES,
  loadPlanCatalogue,
  loadTsModule,
};
