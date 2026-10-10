/**
 * In-memory stand-in for the growth API, used ONLY in the dev web seller
 * preview so the signed-out preview never calls a protected endpoint.
 * Fresh preview = empty; `&demo=1` = populated fixtures.
 */
import { isPreviewDemoMode } from './devPreview';
import { PREVIEW_SELLER_IDENTITY } from './previewIdentity';
import type {
  BioLink, BioPage, BioPageInput, BioStats, GrowthDestinations, LinkDetail, NewLinkInput, PixelIds, TrackedLink,
} from '@/services/growthTypes';

const demo = () => isPreviewDemoMode();
let links: TrackedLink[] | null = null;
let bio: BioPage | null = null;
let pixels: PixelIds = { metaPixelId: null, tiktokPixelId: null };
let n = 100;

function seedLinks(): TrackedLink[] {
  if (!demo()) return [];
  const mk = (i: number, label: string, src: string, med: string, clicks: number, orders: number, rev: number): TrackedLink => ({
    id: `demo-link-${i}`, code: `demo${i}abcd`.slice(0, 8), url: `https://brandthread.app/l/demo${i}abcd`.slice(0, 35), label,
    destinationType: 'store', destinationRef: null, utmSource: src, utmMedium: med, utmCampaign: 'spring-drop', utmTerm: null, utmContent: null,
    archived: false, createdAt: new Date(Date.now() - i * 86_400_000).toISOString(), clicks, orders, revenueCents: rev,
  });
  return [mk(1, 'Instagram bio', 'instagram', 'social', 412, 9, 58400), mk(2, 'TikTok profile', 'tiktok', 'social', 268, 4, 24900), mk(3, 'Spring email', 'newsletter', 'email', 97, 6, 41200)];
}
const L = () => (links ??= seedLinks());

export const previewGrowth = {
  presetsOnly: true,
  async destinations(): Promise<GrowthDestinations> {
    return {
      store: { available: demo() }, bio: { available: !!bio?.exists, url: bio?.url ?? null },
      products: demo() ? [{ id: 'demo-p1', name: 'Heavyweight Tee', image: null }, { id: 'demo-p2', name: 'Oversized Hoodie', image: null }] : [],
    };
  },
  async listLinks() { return [...L()]; },
  async createLink(i: NewLinkInput): Promise<TrackedLink> {
    const code = `pv${n++}abcdef`.slice(0, 8);
    const row: TrackedLink = {
      id: `pv-${code}`, code, url: `https://brandthread.app/l/${code}`, label: i.label, destinationType: i.destinationType, destinationRef: i.destinationRef,
      utmSource: i.utmSource, utmMedium: i.utmMedium, utmCampaign: i.utmCampaign || null, utmTerm: null, utmContent: null,
      archived: false, createdAt: new Date().toISOString(), clicks: 0, orders: 0, revenueCents: 0,
    };
    L().unshift(row);
    return row;
  },
  async linkDetail(id: string): Promise<LinkDetail> {
    const l = L().find((x) => x.id === id);
    if (!l) throw new Error('Link not found');
    const series = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      const c = l.clicks > 0 ? Math.round((l.clicks / 30) * (0.6 + ((i * 7) % 10) / 12)) : 0;
      return { day, clicks: c, orders: 0, revenueCents: 0 };
    });
    return {
      ...l, conversionRate: l.clicks ? l.orders / l.clicks : 0, series,
      countries: l.clicks ? [{ label: 'US', count: Math.round(l.clicks * 0.6) }, { label: 'GB', count: Math.round(l.clicks * 0.2) }] : [],
      referrers: l.clicks ? [{ label: l.utmSource === 'tiktok' ? 'tiktok.com' : 'instagram.com', count: Math.round(l.clicks * 0.7) }, { label: 'Direct', count: Math.round(l.clicks * 0.3) }] : [],
    };
  },
  async archiveLink(id: string) { links = L().filter((x) => x.id !== id); },
  async getBio(): Promise<BioPage> {
    // The one preview identity (lib/previewIdentity); demo=1 adds a bio,
    // socials, links and the preview catalog's products.
    const siteUrl = `https://brandthread.app/@${PREVIEW_SELLER_IDENTITY.username}`;
    // Loaded lazily: the preview catalog pulls in bundled images (expo-asset).
    const catalog = demo() ? (await import('./previewSellerProducts')).getPreviewSellerProducts() : [];
    return (bio ??= {
      exists: false, slug: null, url: siteUrl, published: true,
      displayName: PREVIEW_SELLER_IDENTITY.brandName, bio: demo() ? PREVIEW_SELLER_IDENTITY.bio : '', avatarUrl: null,
      showShopButton: true, shopButtonLabel: 'Shop my store', featuredProductIds: [],
      socials: demo() ? { instagram: 'https://www.instagram.com/preview_studio', tiktok: 'https://www.tiktok.com/@preview_studio' } : {},
      theme: 'dark', accentColor: null, storeAccentColor: null,
      links: demo() ? [
        { id: 'demo-bl-1', title: 'Drop waitlist', url: 'https://preview.example/waitlist', enabled: true, position: 0, clicks30: 84 },
        { id: 'demo-bl-2', title: 'Lookbook', url: 'https://preview.example/lookbook', enabled: true, position: 1, clicks30: 12 },
      ] : [],
      siteUrl, username: PREVIEW_SELLER_IDENTITY.username, logoUrl: null, bannerUrl: null, showBanner: true,
      siteTheme: 'black', buttonStyle: 'rounded', font: 'system',
      products: catalog.slice(0, 6).map((p) => ({
        id: p.id, name: p.name, image: p.media?.[0]?.uri ?? null,
        priceLabel: `$${((p.pricing?.priceCents ?? 0) / 100).toFixed(2)}`,
      })),
    });
  },
  async saveBio(i: BioPageInput): Promise<BioPage> {
    const cur = await this.getBio();
    bio = { ...cur, ...i, exists: true, slug: cur.slug ?? PREVIEW_SELLER_IDENTITY.username } as BioPage;
    return bio;
  },
  async addBioLink(title: string, url: string): Promise<BioLink> {
    const cur = await this.getBio();
    const l: BioLink = { id: `pv-bl-${n++}`, title, url, enabled: true, position: cur.links.length, clicks30: 0 };
    bio = { ...cur, links: [...cur.links, l] };
    return l;
  },
  async patchBioLink(id: string, p: Partial<Pick<BioLink, 'title' | 'url' | 'enabled'>>) {
    const cur = await this.getBio();
    bio = { ...cur, links: cur.links.map((l) => (l.id === id ? { ...l, ...p } : l)) };
  },
  async deleteBioLink(id: string) {
    const cur = await this.getBio();
    bio = { ...cur, links: cur.links.filter((l) => l.id !== id) };
  },
  async reorderBioLinks(ids: string[]) {
    const cur = await this.getBio();
    bio = { ...cur, links: ids.map((id, i) => ({ ...cur.links.find((l) => l.id === id)!, position: i })) };
  },
  async bioStats(): Promise<BioStats> {
    const cur = await this.getBio();
    return {
      days: 30, views: demo() ? 640 : 0, clicks: demo() ? 131 : 0, shopClicks: demo() ? 35 : 0, productClicks: 0, clickThroughRate: demo() ? 0.2 : 0,
      links: cur.links.filter((l) => (l.clicks30 ?? 0) > 0).map((l) => ({ id: l.id, title: l.title, url: l.url, clicks: l.clicks30 ?? 0 })),
      referrers: demo() ? [{ label: 'instagram.com', count: 410 }, { label: 'Direct', count: 230 }] : [], countries: demo() ? [{ label: 'US', count: 380 }, { label: 'PT', count: 120 }] : [],
    };
  },
  async getPixels(): Promise<PixelIds> { return pixels; },
  async savePixels(p: PixelIds): Promise<PixelIds> { pixels = p; return pixels; },
};
