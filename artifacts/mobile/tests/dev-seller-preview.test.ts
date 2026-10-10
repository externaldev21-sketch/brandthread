import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDevSellerPreview } from '../lib/buildFlags';

const root = resolve(__dirname, '..');

describe('temporary seller preview flag', () => {
  it('activates only for the explicit seller flag in a development build', () => {
    expect(resolveDevSellerPreview(true, false, 'seller')).toBe(true);
    expect(resolveDevSellerPreview(true, false, undefined)).toBe(false);
    expect(resolveDevSellerPreview(true, false, '')).toBe(false);
    expect(resolveDevSellerPreview(true, false, 'buyer')).toBe(false);
    expect(resolveDevSellerPreview(true, false, 'true')).toBe(false);
  });

  it('is disabled in a native release build even if the environment leaks the flag', () => {
    expect(resolveDevSellerPreview(false, true, 'seller')).toBe(false);
    expect(resolveDevSellerPreview(true, true, 'seller')).toBe(false);
  });

  it('keeps native seller preview out of persistent onboarding/account writes', () => {
    const layout = readFileSync(resolve(root, 'app/_layout.tsx'), 'utf8');
    const bypass = readFileSync(resolve(root, 'lib/devBypass.ts'), 'utf8');
    expect(layout).toContain("DEV_BYPASS_ROLE === 'seller'");
    expect(layout).toMatch(
      /if \(Platform\.OS !== 'web' && DEV_BYPASS_ROLE === 'seller'\) \{\s*setOnboardingChecked\(true\);\s*setOnboardingDone\(true\);\s*setStoredRole\('seller'\);[\s\S]*?return;\s*\}\s*if \(!isSignedIn\)[\s\S]*?AsyncStorage\.multiGet/,
    );
    expect(layout).not.toContain("AsyncStorage.setItem('onboarding_complete', 'true')");
    expect(bypass).not.toContain('AsyncStorage');
  });

  it('short-circuits app API and service requests during seller preview', () => {
    const api = readFileSync(resolve(root, 'lib/api.ts'), 'utf8');
    const services = readFileSync(resolve(root, 'lib/serviceConfig.ts'), 'utf8');
    const generated = readFileSync(resolve(root, '../../lib/api-client-react/src/custom-fetch.ts'), 'utf8');
    const layout = readFileSync(resolve(root, 'app/_layout.tsx'), 'utf8');
    expect(api).toContain("error: { message: 'This action is unavailable in the signed-out seller preview.', code: 'dev_preview_offline' }");
    expect(services).toContain("error: { message: 'This action is unavailable in the signed-out seller preview.', code: 'dev_preview_offline' }");
    expect(generated).toContain('if (_requestGuard?.())');
    expect(layout).toContain('setRequestGuard(() => isSellerDevPreview())');
  });

  it('guards direct paid service fetches and retains screen-level demo fixture branches', () => {
    const aiService = readFileSync(resolve(root, 'services/aiService.ts'), 'utf8');
    const memory = readFileSync(resolve(root, 'services/aiBrandMemory.ts'), 'utf8');
    const removal = readFileSync(resolve(root, 'app/design-bg-removal.tsx'), 'utf8');
    const orders = readFileSync(resolve(root, 'lib/previewSellerOrders.ts'), 'utf8');
    const products = readFileSync(resolve(root, 'lib/previewSellerProducts.ts'), 'utf8');
    expect(aiService).toContain('if (isSellerDevPreview())');
    expect(memory).toContain('isSellerDevPreview() || !API_BASE || !authToken');
    expect(removal).toContain('const demo = isSellerDevPreview() && isPreviewDemoMode()');
    expect(orders).toContain('allPreviewSellerOrders');
    expect(products).toContain('getPreviewSellerProducts');
  });
});