/** GET /api/store/address and PATCH /api/store/slug (BT-307/317/318). */
export type StoreAddress = {
  slug: string | null;
  subdomainHost: string | null;
  subdomainsLive: boolean;
  customDomainsLive: boolean;
  cnameTarget: string | null;
  published: boolean;
  liveUrl: string;
};
