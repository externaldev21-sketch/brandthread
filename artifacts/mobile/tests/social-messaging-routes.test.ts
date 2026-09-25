import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { activityHref } from '../lib/activity';

const APP_DIR = resolve(__dirname, '..', 'app');
const ROOT_DIR = resolve(__dirname, '..');

/**
 * Every screen/component in the Social + Messaging area (feed, comments,
 * stories, live, profiles, follower/following lists, inbox, chat threads,
 * activity) — router targets found here must resolve to a real expo-router
 * file. This is the general version of settings-routes.test.ts's
 * `routeExists()` check, scoped to this feature area so a typo'd or renamed
 * route (e.g. a push to a screen that was never built) fails CI instead of
 * shipping a dead end.
 */
const SOCIAL_MESSAGING_FILES = [
  'app/(tabs)/feed.tsx',
  'app/(buyer)/feed.tsx',
  'app/buyer-post-viewer.tsx',
  'app/buyer-post-comments.tsx',
  'app/buyer-story-viewer.tsx',
  'app/buyer-story-create.tsx',
  'app/buyer-live.tsx',
  'app/seller-live.tsx',
  'app/seller-go-live.tsx',
  'app/buyer-other-profile.tsx',
  'app/seller-profile.tsx',
  'app/connections.tsx',
  'app/(buyer)/inbox.tsx',
  'app/seller-inbox.tsx',
  'app/buyer-conversation.tsx',
  'app/seller-conversation.tsx',
  'app/activity-center.tsx',
  'app/buyer-notifications.tsx',
  'components/social/StoryTray.tsx',
  'components/social/FollowButton.tsx',
  'components/ThreadShareSheet.tsx',
  'components/ShareProfileSheet.tsx',
  'components/safety/DmSafety.tsx',
  'components/inbox/ConversationPreview.tsx',
  'components/inbox/InboxSwipeRow.tsx',
];

/** Matches expo-router group segments, e.g. "/(buyer)/orders" -> "(buyer)/orders". */
function routeExists(route: string): boolean {
  const [path] = route.split('?');
  const trimmed = path.replace(/^\//, '');
  if (!trimmed) return true; // bare "/" resolves to the root tab layout
  return (
    existsSync(resolve(APP_DIR, `${trimmed}.tsx`)) ||
    existsSync(resolve(APP_DIR, trimmed, 'index.tsx'))
  );
}

/**
 * Pulls every statically-derivable route literal passed to router.push /
 * router.replace / router.navigate / <Link href=...> in a file's source.
 * Covers plain string literals ('/foo'), template literals whose static
 * prefix is enough to resolve a file (`/foo?bar=${id}` -> '/foo'), and
 * string concatenation ('/foo?id=' + id -> '/foo'). Dynamic route names
 * built entirely from a variable (no literal path segment) can't be checked
 * this way and are skipped.
 */
function extractRouteLiterals(source: string): string[] {
  const found: string[] = [];
  const callPattern = /(?:router\s*\.\s*(?:push|replace|navigate)|href)\s*\(\s*(?:\{[^}]*pathname\s*:\s*)?[`'"]([^`'"]*)/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(source)) !== null) {
    const literal = match[1];
    if (literal.startsWith('/')) found.push(literal);
  }
  return found;
}

describe('social + messaging area route targets', () => {
  for (const relPath of SOCIAL_MESSAGING_FILES) {
    it(`every router target in ${relPath} resolves to a real screen`, () => {
      const abs = resolve(ROOT_DIR, relPath);
      expect(existsSync(abs), `expected file to exist: ${relPath}`).toBe(true);
      const source = readFileSync(abs, 'utf8');
      const literals = extractRouteLiterals(source);
      for (const literal of literals) {
        expect(routeExists(literal), `${relPath}: route "${literal}" has no matching screen file`).toBe(true);
      }
    });
  }
});

describe('activityHref() targets', () => {
  const cases: Array<[Parameters<typeof activityHref>[0], 'buyer' | 'seller']> = [
    [{ id: '1', category: 'orders', type: 'order_update', title: '', body: '', isRead: true, targetId: 'o1', targetType: 'order', createdAt: '' }, 'seller'],
    [{ id: '2', category: 'orders', type: 'order_update', title: '', body: '', isRead: true, targetId: 'o2', targetType: 'buyer_order', createdAt: '' }, 'buyer'],
    [{ id: '3', category: 'orders', type: 'sample_update', title: '', body: '', isRead: true, targetId: 's1', targetType: 'sample_order', createdAt: '' }, 'seller'],
    [{ id: '4', category: 'orders', type: 'production_update', title: '', body: '', isRead: true, targetId: 'p1', targetType: 'bulk_order', createdAt: '' }, 'seller'],
    [{ id: '5', category: 'social', type: 'manufacturer_message', title: '', body: '', isRead: true, targetId: 't1', targetType: 'manufacturer_thread', createdAt: '' }, 'seller'],
    [{ id: '6', category: 'social', type: 'post_comment', title: '', body: '', isRead: true, targetId: 'post1', targetType: 'post', createdAt: '' }, 'buyer'],
    [{ id: '7', category: 'social', type: 'post_like', title: '', body: '', isRead: true, targetId: 'post2', targetType: 'post', createdAt: '' }, 'buyer'],
    [{ id: '8', category: 'social', type: 'product_restock', title: '', body: '', isRead: true, targetId: 'prod1', targetType: 'product', createdAt: '' }, 'buyer'],
    [{ id: '9', category: 'social', type: 'new_follower', title: '', body: '', isRead: true, targetId: 'u1', targetType: 'user', createdAt: '' }, 'buyer'],
    [{ id: '10', category: 'social', type: 'new_message', title: '', body: '', isRead: true, targetId: 'c1', targetType: 'conversation', createdAt: '' }, 'buyer'],
    [{ id: '11', category: 'social', type: 'new_message', title: '', body: '', isRead: true, targetId: 'c2', targetType: 'conversation', createdAt: '' }, 'seller'],
    [{ id: '12', category: 'orders', type: 'variant_low_stock', title: '', body: '', isRead: true, targetType: 'variant', createdAt: '' }, 'seller'],
    [{ id: '13', category: 'orders', type: 'payout_sent', title: '', body: '', isRead: true, targetType: 'payout', createdAt: '' }, 'seller'],
    [{ id: '14', category: 'orders', type: 'subscription_invoice', title: '', body: '', isRead: true, targetType: 'subscription_invoice', createdAt: '' }, 'seller'],
  ];

  it.each(cases)('resolves a real screen for targetType %#', (row, role) => {
    const href = activityHref(row, role);
    expect(href).not.toBeNull();
    if (href) {
      const [path] = href.split('?');
      const trimmed = path.replace(/^\//, '');
      const exists =
        existsSync(resolve(APP_DIR, `${trimmed}.tsx`)) ||
        existsSync(resolve(APP_DIR, trimmed, 'index.tsx'));
      expect(exists, `activityHref -> ${href} has no matching screen file`).toBe(true);
    }
  });
});
