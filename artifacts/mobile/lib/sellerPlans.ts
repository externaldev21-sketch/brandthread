import type { SellerPlanId } from './sellerBilling';

export type SellerBrandStage = 'idea' | 'build' | 'selling' | 'scale';

export interface SellerPlanDefinition {
  id: SellerPlanId;
  name: string;
  onboardingName: string;
  tagline: string;
  priceCents: number;
  priceLabel: string;
  features: string[];
  notIncluded: string[];
}

export const SELLER_PLANS: SellerPlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    onboardingName: 'Starter',
    tagline: 'Launch and run your storefront',
    priceCents: 2900,
    priceLabel: '$29',
    features: [
      'Storefront, products, checkout, and orders',
      'Sales and product analytics',
      'AI Store Builder and seller assistant',
      'Community and freelancer marketplace',
    ],
    notIncluded: ['AI visual creation suite', 'Manufacturer Hub', 'Team operations and live selling'],
  },
  {
    id: 'growth',
    name: 'Growth',
    onboardingName: 'Growth',
    tagline: 'Create products and source production',
    priceCents: 7900,
    priceLabel: '$79',
    features: [
      'Everything in Starter',
      'AI logos, mockups, product photography, and lifestyle imagery',
      'Background removal and replacement',
      'Manufacturer Hub sourcing and production workflows',
    ],
    notIncluded: ['Team operations', 'Live shopping', 'Promotion management'],
  },
  {
    id: 'scale',
    name: 'Scale',
    onboardingName: 'Pro',
    tagline: 'Operate and promote a growing brand',
    priceCents: 19900,
    priceLabel: '$199',
    features: [
      'Everything in Growth',
      'Team roles and collaborative operations',
      'Live shopping tools',
      'Boost and promotion management',
      'Advanced customer analytics',
    ],
    notIncluded: [],
  },
];

const GOAL_WEIGHTS: Record<string, number> = {
  'Create designs': 1,
  'Find manufacturers': 2,
  'Launch my store': 0,
  'Manage production': 2,
  'Grow sales': 1,
  'Build content': 1,
  'Manage inventory': 1,
  'Ship orders': 1,
  'Understand analytics': 1,
  'Manage customers': 1,
};

const STAGE_SCORES: Record<string, number> = {
  idea: 0,
  build: 1,
  selling: 3,
  scale: 5,
};

const STAGE_LABELS: Record<string, string> = {
  idea: 'starting with an idea',
  build: 'actively building your product line',
  selling: 'already selling',
  scale: 'ready to scale',
};

export interface SellerPlanRecommendation {
  planId: SellerPlanId;
  reason: string;
  score: number;
}

export function recommendSellerPlan(stage: string, goals: string[]): SellerPlanRecommendation {
  const score = (STAGE_SCORES[stage] ?? 0) + goals.reduce((total, goal) => total + (GOAL_WEIGHTS[goal] ?? 0), 0);
  const planId: SellerPlanId = score >= 6 ? 'scale' : score >= 2 ? 'growth' : 'starter';
  const plan = SELLER_PLANS.find((candidate) => candidate.id === planId)!;
  const strongestGoals = goals
    .filter((goal) => (GOAL_WEIGHTS[goal] ?? 0) > 0)
    .sort((a, b) => (GOAL_WEIGHTS[b] ?? 0) - (GOAL_WEIGHTS[a] ?? 0))
    .slice(0, 2);
  const stagePhrase = STAGE_LABELS[stage] ?? 'your current brand stage';
  const goalPhrase = strongestGoals.length > 0
    ? ` and your goals around ${strongestGoals.map((goal) => goal.toLowerCase()).join(' and ')}`
    : '';
  return {
    planId,
    score,
    reason: `Because you’re ${stagePhrase}${goalPhrase}, ${plan.onboardingName} is the best fit for what you need right now.`,
  };
}
