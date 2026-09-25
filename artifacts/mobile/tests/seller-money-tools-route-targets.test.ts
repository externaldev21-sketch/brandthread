import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static route-existence check for the "seller money + tools + global" area:
 * payouts/subscriptions, Manufacturer Hub, Design Studio / AI tools, seller
 * settings + help, and the global auth/onboarding/account-switch screens.
 *
 * Scans every router.push/router.replace/router.navigate/<Link href> call in
 * these files for a literal string target and asserts the target resolves to
 * a real expo-router file. Dynamic targets (template literals, variables) are
 * skipped — they can't be statically resolved — but every literal path
 * (including the pathname of an object literal) is checked.
 */

const mobileRoot = path.resolve(__dirname, '..');
const appDir = path.join(mobileRoot, 'app');

const AREA_FILES = [
  'app/account-switcher.tsx',
  'app/account-type-settings.tsx',
  'app/account-type.tsx',
  'app/ai-assistant.tsx',
  'app/ai-brain.tsx',
  'app/ai-brand-memory.tsx',
  'app/ai-mockup-chat.tsx',
  'app/ai-photography-chat.tsx',
  'app/ai-settings.tsx',
  'app/ai-studio.tsx',
  'app/bg-removal.tsx',
  'app/billing.tsx',
  'app/design-ai-photoshoot.tsx',
  'app/design-bg-removal.tsx',
  'app/design-bg-replace.tsx',
  'app/design-brand-assets.tsx',
  'app/design-campaign.tsx',
  'app/design-canvas.tsx',
  'app/design-export.tsx',
  'app/design-garment.tsx',
  'app/design-mockup-preview.tsx',
  'app/design-mockup-to-model.tsx',
  'app/design-project.tsx',
  'app/design-prompt-edit.tsx',
  'app/design-templates.tsx',
  'app/design-text-to-design.tsx',
  'app/design-upload-sketch.tsx',
  'app/design-versions.tsx',
  'app/design.tsx',
  'app/general-settings.tsx',
  'app/help.tsx',
  'app/invite-manufacturer.tsx',
  'app/manufacturer-compare.tsx',
  'app/manufacturer-hub.tsx',
  'app/manufacturer-messages.tsx',
  'app/manufacturer-onboard.tsx',
  'app/manufacturer-product.tsx',
  'app/manufacturer-profile.tsx',
  'app/manufacturer.tsx',
  'app/onboarding.tsx',
  'app/payouts.tsx',
  'app/plans.tsx',
  'app/quote-compare.tsx',
  'app/quote-detail.tsx',
  'app/quote-request.tsx',
  'app/request-sample.tsx',
  'app/rfq-compare.tsx',
  'app/rfq-list.tsx',
  'app/rfq-post.tsx',
  'app/sample-detail.tsx',
  'app/seller-settings.tsx',
  'app/settings.tsx',
  'app/sign-in.tsx',
  'app/splash.tsx',
  'app/subscription.tsx',
  'app/tech-pack-generator.tsx',
];

// Route groups like (tabs)/(buyer) are stripped by expo-router at runtime,
// so `/(tabs)/products` and `/products` both resolve — treat group segments
// as optional when checking existence.
function routeExists(rawTarget: string): boolean {
  const withoutQuery = rawTarget.split('?')[0].split('#')[0];
  if (!withoutQuery || withoutQuery === '/') return true;
  const trimmed = withoutQuery.replace(/^\//, '');
  const candidates = [trimmed];
  // Also try resolving with any `(group)` segments removed, and vice versa.
  const withoutGroups = trimmed.replace(/\([^/]+\)\//g, '');
  if (withoutGroups !== trimmed) candidates.push(withoutGroups);

  return candidates.some((candidate) => {
    const full = path.join(appDir, candidate);
    return (
      fs.existsSync(`${full}.tsx`) ||
      fs.existsSync(`${full}.ts`) ||
      fs.existsSync(path.join(full, 'index.tsx')) ||
      fs.existsSync(path.join(full, 'index.ts'))
    );
  });
}

const ROUTE_CALL_RE = /router\.(?:push|replace|navigate)\(\s*(\{[^}]*pathname\s*:\s*)?(['"`])((?:(?!\2).)+)\2/g;
const HREF_RE = /href=\{?\s*(?:\{[^}]*pathname\s*:\s*)?(['"`])((?:(?!\1).)+)\1/g;

function extractLiteralTargets(source: string): string[] {
  const targets: string[] = [];
  for (const match of source.matchAll(ROUTE_CALL_RE)) targets.push(match[3]);
  for (const match of source.matchAll(HREF_RE)) targets.push(match[2]);
  return targets.filter((t) => !/^(https?:|mailto:|tel:)/.test(t));
}

describe('seller money + tools + global area: router targets resolve', () => {
  for (const relativeFile of AREA_FILES) {
    const absolute = path.join(mobileRoot, relativeFile);
    if (!fs.existsSync(absolute)) continue;

    it(`${relativeFile} only pushes to routes that exist`, () => {
      const source = fs.readFileSync(absolute, 'utf8');
      const targets = extractLiteralTargets(source);
      const missing = targets.filter((t) => !routeExists(t));
      expect(missing, `Missing route file(s) for targets: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
