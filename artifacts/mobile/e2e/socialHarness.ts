/**
 * Shared helpers for the social E2E specs (e2e/social-*.spec.ts).
 *
 * These drive the Expo web build against the REAL api-server + Postgres
 * started by artifacts/api-server/src/__e2e__/socialHarness.e2e.ts, as two
 * real seeded accounts. Only Clerk is stubbed: the stub's session token is
 * `e2e:<clerkId>`, which the harness resolves to that account.
 *
 *   1. api-server harness:  cd artifacts/api-server && TEST_DATABASE_URL=… \
 *        AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=x \
 *        npx vitest run --config vitest.harness.config.ts
 *   2. Expo web:  EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:5055 \
 *        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuYnJhbmR0aHJlYWQudGVzdCQ \
 *        npx expo start --web --port 8081 --no-dev
 *        (--no-dev: a production-mode bundle, so the dev-web preview shortcuts
 *        in lib/devPreview.ts never stand in for the real API)
 *   3. BASE_URL=http://127.0.0.1:8081 npx playwright test -c e2e/playwright.config.ts e2e/social-*.spec.ts
 */
import type { Browser, Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';
import { LEGAL_VERSION } from '../content/legal';

export const API = process.env.SOCIAL_E2E_API ?? 'http://127.0.0.1:5055';
export const BUYER = { id: 'e2e_social_buyer', firstName: 'Maya', lastName: 'Brooks', username: 'mayabrooks', email: 'e2e_social_buyer@example.test' };
export const SELLER = { id: 'e2e_social_seller', firstName: 'Atelier', lastName: 'North', username: 'ateliernorth', email: 'e2e_social_seller@example.test' };
export type E2eUser = typeof BUYER;

const STUB_USER = {
  id: 'user_preview_verify',
  firstName: 'Preview',
  lastName: 'Verify',
  username: 'previewverify',
  email: 'preview-verify@example.com',
  imageUrl: '',
};

/** The shared Clerk stub, signed in as `user`, with a token the harness maps to that account. */
export function signedInAs(user: E2eUser): string {
  return clerkStubScript()
    .replace(JSON.stringify(STUB_USER), JSON.stringify({ ...user, imageUrl: '' }))
    .split("'demo-token'").join(`'e2e:${user.id}'`);
}

/** iPhone 15/16 logical size — what Dev reviews screens at. */
export const VIEWPORT = { width: 393, height: 852 };

export async function pageAs(browser: Browser, user: E2eUser): Promise<Page> {
  // A real account has accepted the current terms; record it the real way.
  await apiAs(user, 'POST', '/api/auth/legal-acceptance', { version: LEGAL_VERSION });
  const context = await browser.newContext({
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8081',
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  // Skip one-time cookie/consent and coach-mark chrome that is not under test.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, timestamp: Date.now(), necessary: true, analytics: false, marketing: false }));
    } catch { /* storage unavailable */ }
  });
  // The returning-user state a real signed-in device has after onboarding
  // (what AuthGate restores from GET /api/auth/sync on a fresh install).
  const role = user.id === SELLER.id ? 'seller' : 'buyer';
  await context.addInitScript(({ id, role }) => {
    try {
      localStorage.setItem('splash_seen', 'true');
      localStorage.setItem('onboarding_complete', 'true');
      localStorage.setItem('onboarding_owner_id', id);
      localStorage.setItem('user_role', role);
      localStorage.setItem(`thread_explainer_seen:${id}`, 'true');
    } catch { /* storage unavailable */ }
  }, { id: user.id, role });
  await context.addInitScript(signedInAs(user));
  return context.newPage();
}

/** Call the harness API directly as `user` (to set up or assert the other side). */
export async function apiAs<T = any>(user: E2eUser, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user-id': user.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
