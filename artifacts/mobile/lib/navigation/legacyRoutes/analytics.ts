import type { LegacyRoute } from './types';

/**
 * 15 analytics-* screens → Analytics (unchanged: range, key metrics, Reports
 * list) + one Reports route that shows any report by ?report=….
 */
export const ANALYTICS_LEGACY_ROUTES: LegacyRoute[] = [
  { from: '/analytics-product-stats', to: '/analytics-reports?report=product-stats', note: 'Reports → Product stats.' },
  { from: '/analytics-content', to: '/analytics-reports?report=content', note: 'Reports → Threads and videos.' },
  { from: '/analytics-audience', to: '/analytics-reports?report=audience', note: 'Reports → Audience.' },
  { from: '/analytics-goals', to: '/analytics-reports?report=goals', note: 'Reports → Goals.' },
  { from: '/analytics-export', to: '/analytics-reports?report=export', note: 'Reports → Export.' },
  { from: '/analytics-advanced', to: '/analytics-reports?report=advanced', note: 'Reports → Advanced analytics (PRO).' },
  { from: '/analytics-cohorts', to: '/analytics-reports?report=cohorts', note: 'Reports → Customer cohorts (PRO).' },
  // Older reports nothing linked to any more (superseded by the reports above).
  { from: '/analytics-sales', to: '/(tabs)/analytics', note: 'Revenue and visits are on Analytics.' },
  { from: '/analytics-products', to: '/analytics-reports?report=product-stats', note: 'Top products by revenue are in Reports → Product stats.' },
  { from: '/analytics-customers', to: '/analytics-reports?report=cohorts', note: 'Repeat buyers and lifetime value are in Reports → Customer cohorts.' },
  { from: '/analytics-store', to: '/(tabs)/analytics', note: 'Store visits are on Analytics (the Dashboard traffic card links there).' },
  // Their data service returned "unavailable": no report existed behind them.
  { from: '/analytics-marketing', to: '/(tabs)/marketing', note: 'No backend; campaign results live in Marketing.' },
  { from: '/analytics-production', to: '/manufacturer-hub', note: 'No backend; production lives in the Manufacturer hub.' },
  { from: '/analytics-profit', to: '/finance', note: 'No backend; payouts and fees live in Finance.' },
  { from: '/analytics-inventory', to: '/(tabs)/products?filter=low-stock', note: 'Removed earlier; stock lives on the Products tab.' },
];
