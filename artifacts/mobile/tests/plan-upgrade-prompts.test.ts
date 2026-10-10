import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// Every action the server gates by plan (api-server planCatalogue.ts → planTierFeatures)
// answers a 403 with the upgrade prompt, not a generic error.
const GATED_SCREENS = [
  'app/seller-drop-create.tsx',      // drops and pre-orders
  'app/featured-slot.tsx',           // Featured slots
  'app/store-domain.tsx',            // custom domain
  'app/email-campaign-compose.tsx',  // email marketing
  'app/rfq-post.tsx',                // Manufacturer Hub RFQs
  'app/analytics-export.tsx',        // analytics export (Pro)
];

describe('plan upgrade prompts', () => {
  it.each(GATED_SCREENS)('%s shows the upgrade prompt on a plan gate', (file) => {
    expect(read(file)).toContain('promptUpgradeOnPlanGate(e, router)');
  });

  it('labels the analytics reports with the plan that unlocks them', () => {
    const list = read('components/analytics/AnalyticsReportsList.tsx');
    expect(list).toContain("href: '/analytics-advanced', badge: 'GROWTH'");
    expect(list).toContain("href: '/analytics-cohorts', badge: 'GROWTH'");
    expect(list).toContain("href: '/analytics-export', badge: 'PRO'");
    expect(read('app/analytics-advanced.tsx')).toContain("plan === 'pro' || plan === 'growth'");
  });
});
