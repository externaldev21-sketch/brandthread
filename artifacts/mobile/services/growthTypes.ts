export type LinkDestinationType = 'store' | 'product' | 'bio';

export interface UtmPreset { id: string; label: string; source: string; medium: string }

export interface TrackedLink {
  id: string; code: string; url: string; label: string;
  destinationType: LinkDestinationType; destinationRef: string | null;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmTerm: string | null; utmContent: string | null;
  archived: boolean; createdAt: string;
  clicks: number; orders: number; revenueCents: number;
}

export interface LinkDetail extends TrackedLink {
  conversionRate: number;
  series: { day: string; clicks: number; orders: number; revenueCents: number }[];
  countries: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
}

export interface GrowthDestinations {
  store: { available: boolean };
  bio: { available: boolean; url: string | null };
  products: { id: string; name: string; image: string | null }[];
}

export interface NewLinkInput {
  label: string; destinationType: LinkDestinationType; destinationRef: string | null;
  utmSource: string; utmMedium: string; utmCampaign: string;
}

export interface BioLink { id: string; title: string; url: string; enabled: boolean; position: number; clicks30?: number }

export interface BioPage {
  exists: boolean; slug: string | null; url: string | null; published: boolean;
  displayName: string; bio: string; avatarUrl: string | null;
  showShopButton: boolean; shopButtonLabel: string; featuredProductIds: string[];
  socials: Record<string, string>; theme: 'mono' | 'dark'; accentColor: string | null; storeAccentColor: string | null;
  links: BioLink[];
}

export type BioPageInput = Partial<Pick<BioPage,
  'displayName' | 'bio' | 'avatarUrl' | 'showShopButton' | 'shopButtonLabel' | 'featuredProductIds' | 'socials' | 'theme' | 'accentColor' | 'published'>>;

export interface BioStats {
  days: number; views: number; clicks: number; shopClicks: number; productClicks: number; clickThroughRate: number;
  links: { id: string; title: string; url: string | null; clicks: number }[];
  referrers: { label: string; count: number }[]; countries: { label: string; count: number }[];
}

export interface PixelIds { metaPixelId: string | null; tiktokPixelId: string | null }
