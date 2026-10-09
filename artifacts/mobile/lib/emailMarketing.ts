/**
 * Seller email marketing: shared helpers + demo fixtures.
 * Fixtures are only ever returned for the `?bt_preview=seller&demo=1` web preview.
 * In any dev preview (signed out) no protected API is called at all.
 */
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import type {
  EmailAudience, EmailAudienceResponse, EmailCampaign, EmailCampaignBody, EmailMarketingStatus, EmailSettings,
} from '@/lib/api';

export type EmailMode = 'live' | 'fresh' | 'demo';

export function emailMode(): EmailMode {
  if (isPreviewDemoMode()) return 'demo';
  if (isSellerDevPreview()) return 'fresh';
  return 'live';
}

export const SUBJECT_MAX = 150;
export const PREHEADER_MAX = 200;
export const HEADLINE_MAX = 120;
export const TEXT_MAX = 5000;
export const CTA_LABEL_MAX = 40;
export const MAX_PRODUCT_CARDS = 3;

export const AUDIENCE_LABEL: Record<EmailAudience, string> = {
  subscribers: 'All subscribers',
  customers: 'Subscribers who ordered',
  followers: 'Subscribers who follow you',
};

export function emptyBody(): EmailCampaignBody {
  return { headline: '', text: '', imageUrl: null, productIds: [], cta: null };
}

export const STATUS_LABEL: Record<EmailCampaign['status'], string> = {
  draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent',
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

// ─── Fixtures (demo only) ────────────────────────────────────────────────────
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

export const FRESH_STATUS: EmailMarketingStatus = {
  enabled: false, provider: null, message: null, dailyCap: 1000, sentToday: 0, remainingToday: 1000,
  tracking: { delivered: false, opened: false, clicked: false }, missing: [],
};

export const DEMO_STATUS: EmailMarketingStatus = {
  enabled: true, provider: 'resend', message: null, dailyCap: 1000, sentToday: 0, remainingToday: 1000,
  tracking: { delivered: false, opened: false, clicked: false }, missing: [],
};

export const DEMO_SETTINGS: EmailSettings = {
  fromName: 'Northline Supply', replyTo: 'hello@northline.co', postalAddress: '240 Canal St, New York, NY 10013',
  doubleOptIn: false, defaultFromName: 'Northline Supply',
};

export const EMPTY_SETTINGS: EmailSettings = { fromName: '', replyTo: '', postalAddress: '', doubleOptIn: false, defaultFromName: 'Your store' };

export const DEMO_AUDIENCE: EmailAudienceResponse = {
  counts: { subscribers: 128, customers: 41, followers: 57 },
  byStatus: { subscribed: 128, unsubscribed: 6, pending: 0, bounced: 1 },
  hasMore: false,
  subscribers: [
    ['maya.chen@example.com', 0], ['jordan.ellis@example.com', 1], ['sam.ortiz@example.com', 1],
    ['priya.nair@example.com', 2], ['leo.martin@example.com', 3], ['ava.brooks@example.com', 4],
  ].map(([email, d], i) => ({ id: `demo-sub-${i}`, email: email as string, status: 'subscribed', source: 'store_site', createdAt: iso(d as number) })),
};

export const EMPTY_AUDIENCE: EmailAudienceResponse = {
  counts: { subscribers: 0, customers: 0, followers: 0 }, byStatus: {}, subscribers: [], hasMore: false,
};

export const DEMO_CAMPAIGNS: EmailCampaign[] = [
  {
    id: 'demo-c1', subject: 'The spring drop is live', preheader: 'Five new pieces, limited run.', audience: 'subscribers',
    body: { headline: 'The spring drop is live', text: 'Five new pieces, made in small batches. Once they are gone, they are gone.', imageUrl: null, productIds: [], cta: { label: 'Shop the drop', url: 'https://example.com' } },
    status: 'sent', scheduledAt: null, sentAt: iso(6), recipientCount: 122, createdAt: iso(7), updatedAt: iso(6),
    stats: { sent: 120, failed: 1, skipped: 1, queued: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 }, tracking: false,
  },
  {
    id: 'demo-c2', subject: 'Restock: Heavyweight Hoodie', preheader: 'Back in every size.', audience: 'customers',
    body: { headline: 'Back in stock', text: '', imageUrl: null, productIds: [], cta: null },
    status: 'draft', scheduledAt: null, sentAt: null, recipientCount: 0, createdAt: iso(1), updatedAt: iso(1), stats: null,
  },
];
