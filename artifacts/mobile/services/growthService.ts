/**
 * Growth links service: tracked UTM links, link-in-bio, store pixels.
 * Talks to /api/growth/* (seller-scoped). In the signed-out dev web preview it
 * uses lib/previewGrowth.ts and never calls the API.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isSellerDevPreview } from '@/lib/devPreview';
import { previewGrowth } from '@/lib/previewGrowth';
import type {
  BioLink, BioPage, BioPageInput, BioStats, GrowthDestinations, LinkDetail, NewLinkInput, PixelIds, TrackedLink, UtmPreset,
} from './growthTypes';

export * from './growthTypes';

export const UTM_PRESETS: UtmPreset[] = [
  { id: 'instagram', label: 'Instagram', source: 'instagram', medium: 'social' },
  { id: 'tiktok', label: 'TikTok', source: 'tiktok', medium: 'social' },
  { id: 'email', label: 'Email', source: 'newsletter', medium: 'email' },
  { id: 'facebook', label: 'Facebook', source: 'facebook', medium: 'social' },
  { id: 'youtube', label: 'YouTube', source: 'youtube', medium: 'video' },
  { id: 'x', label: 'X', source: 'x', medium: 'social' },
  { id: 'sms', label: 'SMS', source: 'sms', medium: 'sms' },
  { id: 'whatsapp', label: 'WhatsApp', source: 'whatsapp', medium: 'messaging' },
  { id: 'influencer', label: 'Influencer', source: 'influencer', medium: 'referral' },
  { id: 'qr', label: 'QR code', source: 'qr', medium: 'offline' },
];

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const pv = () => isSellerDevPreview();

export async function getDestinations(): Promise<GrowthDestinations> {
  return pv() ? previewGrowth.destinations() : serviceRequest('/api/growth/destinations');
}
export async function listLinks(): Promise<TrackedLink[]> {
  return pv() ? previewGrowth.listLinks() : serviceRequest('/api/growth/links');
}
export async function createLink(input: NewLinkInput): Promise<TrackedLink> {
  if (pv()) return previewGrowth.createLink(input);
  return serviceRequest('/api/growth/links', {
    method: 'POST',
    ...json({
      label: input.label, destinationType: input.destinationType, destinationRef: input.destinationRef,
      utmSource: input.utmSource, utmMedium: input.utmMedium, utmCampaign: input.utmCampaign || undefined,
    }),
  });
}
export async function getLinkDetail(id: string): Promise<LinkDetail> {
  return pv() ? previewGrowth.linkDetail(id) : serviceRequest(`/api/growth/links/${encodeURIComponent(id)}`);
}
export async function archiveLink(id: string): Promise<void> {
  if (pv()) return previewGrowth.archiveLink(id);
  await fetchNoBody(`/api/growth/links/${encodeURIComponent(id)}`, 'DELETE');
}

export async function getBio(): Promise<BioPage> {
  return pv() ? previewGrowth.getBio() : serviceRequest('/api/growth/bio');
}
export async function saveBio(input: BioPageInput): Promise<BioPage> {
  return pv() ? previewGrowth.saveBio(input) : serviceRequest('/api/growth/bio', { method: 'PUT', ...json(input) });
}
export async function addBioLink(title: string, url: string): Promise<BioLink> {
  return pv() ? previewGrowth.addBioLink(title, url) : serviceRequest('/api/growth/bio/links', { method: 'POST', ...json({ title, url }) });
}
export async function patchBioLink(id: string, patch: Partial<Pick<BioLink, 'title' | 'url' | 'enabled'>>): Promise<void> {
  if (pv()) return previewGrowth.patchBioLink(id, patch);
  await serviceRequest(`/api/growth/bio/links/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(patch) });
}
export async function deleteBioLink(id: string): Promise<void> {
  if (pv()) return previewGrowth.deleteBioLink(id);
  await fetchNoBody(`/api/growth/bio/links/${encodeURIComponent(id)}`, 'DELETE');
}
export async function reorderBioLinks(ids: string[]): Promise<void> {
  if (pv()) return previewGrowth.reorderBioLinks(ids);
  await serviceRequest('/api/growth/bio/links/order', { method: 'PUT', ...json({ ids }) });
}
export async function getBioStats(): Promise<BioStats> {
  return pv() ? previewGrowth.bioStats() : serviceRequest('/api/growth/bio/stats');
}

export async function getPixels(): Promise<PixelIds> {
  return pv() ? previewGrowth.getPixels() : serviceRequest('/api/growth/pixels');
}
export async function savePixels(ids: PixelIds): Promise<PixelIds> {
  return pv() ? previewGrowth.savePixels(ids) : serviceRequest('/api/growth/pixels', { method: 'PUT', ...json(ids) });
}

/** DELETE endpoints answer 204 (no JSON body), which serviceRequest would fail to parse. */
async function fetchNoBody(path: string, method: 'DELETE'): Promise<void> {
  try {
    await serviceRequest(path, { method });
  } catch (e) {
    if (e instanceof SyntaxError) return; // empty 204 body
    throw e;
  }
}
