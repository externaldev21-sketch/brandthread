import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));

import { ApiError } from '../lib/networkNotice';
import {
  REPORT_REASONS, apiErrorCode, apiErrorDetails, apiErrorMessage, normalizeReportTarget, reportHref,
} from '../lib/safety';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('report reasons and targets', () => {
  it('offers exactly the reasons App Review expects, with "other" last', () => {
    expect(REPORT_REASONS.map((r) => r.id)).toEqual([
      'spam', 'harassment', 'nudity', 'hate', 'violence', 'ip_counterfeit', 'scam', 'other',
    ]);
  });

  it('maps legacy target names onto the server contract', () => {
    expect(normalizeReportTarget('seller')).toBe('profile');
    expect(normalizeReportTarget('dm')).toBe('message');
    expect(normalizeReportTarget('live_comment')).toBe('live_comment');
    expect(normalizeReportTarget(undefined)).toBe('post');
  });

  it('builds an encoded report route that carries the owner for "Also block"', () => {
    const href = reportHref({ targetType: 'comment', targetId: 'c1', label: 'Maya: “hi & bye”', ownerId: 'user_1', ownerName: 'Maya' });
    const params = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/buyer-report?')).toBe(true);
    expect(params.get('targetType')).toBe('comment');
    expect(params.get('targetLabel')).toBe('Maya: “hi & bye”');
    expect(params.get('targetUserId')).toBe('user_1');
  });
});

describe('API error presentation', () => {
  it('shows the server message without the transport prefix and exposes code/details', () => {
    const error = new ApiError(409, JSON.stringify({
      error: { code: 'DELETION_BLOCKED', message: 'Settle the items below first.', details: { blockers: [{ code: 'seller_open_orders' }] } },
    }));
    expect(apiErrorMessage(error, 'fallback')).toBe('Settle the items below first.');
    expect(apiErrorCode(error)).toBe('DELETION_BLOCKED');
    expect(apiErrorDetails<{ blockers: unknown[] }>(error)?.blockers).toHaveLength(1);
  });

  it('never leaks server errors', () => {
    expect(apiErrorMessage(new ApiError(500, 'stack trace'), 'Try again.')).toBe('Try again.');
    expect(apiErrorMessage(new Error('boom'), 'Try again.')).toBe('Try again.');
  });
});

describe('safety entry points', () => {
  it('lets people report every kind of content', () => {
    expect(read('app/buyer-story-viewer.tsx')).toContain("targetType: 'story'");
    expect(read('app/buyer-product-detail.tsx')).toContain("targetType: 'product'");
    expect(read('app/buyer-live.tsx')).toContain("targetType: 'live'");
    expect(read('app/buyer-live.tsx')).toContain("targetType: 'live_comment'");
    expect(read('app/buyer-post-comments.tsx')).toContain("targetType: 'comment'");
    expect(read('components/safety/DmSafety.tsx')).toContain("targetType: 'message'");
    expect(read('app/seller-profile.tsx')).toContain("targetType: 'profile'");
  });

  it('blocks through the server, never only on the device', () => {
    const social = read('services/socialService.ts');
    expect(social).toContain("serviceRequest('/api/social/block'");
    expect(read('app/buyer-blocked.tsx')).toContain('api.social.blocks()');
  });

  it('shows real Clerk sessions instead of seeded devices', () => {
    expect(read('lib/accountService.ts')).not.toContain('SEED_SESSIONS');
    expect(read('components/security/LoginActivity.tsx')).toContain('api.auth.sessions()');
    expect(read('components/security/LoginActivity.tsx')).toContain('api.auth.revokeOtherSessions()');
  });

  it('exposes account deletion, legal documents and safety tools from settings', async () => {
    const { SETTINGS_CATALOG } = await import('../services/settingsCatalog');
    const items = SETTINGS_CATALOG.flatMap((group) => group.items);
    for (const route of ['/terms', '/privacy', '/community-guidelines', '/buyer-blocked', '/muted-words']) {
      expect(items.some((item) => item.route === route), route).toBe(true);
    }
    expect(items.find((item) => item.action === 'delete-account')).toBeTruthy();
    expect(items.find((item) => item.route === '/admin-reports')?.requiresModerator).toBe(true);
    expect(read('app/buyer-settings.tsx')).toContain("router.push('/delete-account' as never)");
    expect(read('app/seller-settings.tsx')).toContain("router.push('/delete-account' as never)");
  });
});
