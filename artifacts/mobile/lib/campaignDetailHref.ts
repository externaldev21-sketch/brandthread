import type { CampaignAnalytics } from '@/services/analyticsTypes';

/**
 * Where a Marketing-analytics campaign row leads: the email or push results
 * screen for that send. SMS and automation have no detail route, so they get
 * null and their rows aren't tappable (no dead or unrelated navigation).
 */
export function campaignDetailHref(c: Pick<CampaignAnalytics, 'type' | 'campaignId'>): string | null {
  if (!c.campaignId) return null;
  if (c.type === 'email') return `/email-campaign-results?id=${encodeURIComponent(c.campaignId)}`;
  if (c.type === 'push') return `/seller-push-broadcast-results?id=${encodeURIComponent(c.campaignId)}`;
  return null;
}
