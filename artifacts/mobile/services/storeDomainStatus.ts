// Honest status for seller custom domains. DNS TXT ownership verification is
// real (POST /api/store/domains/:id/verify does a live DNS lookup), but
// routing the domain to the storefront and issuing SSL need a hosting
// integration that is only claimed when the API reports
// CUSTOM_DOMAIN_ROUTING_ENABLED (customDomainRoutingEnabled / routingEnabled).
import type { StoreDomain } from './storeTypes';

export type ApiCustomDomain = { id: string; domain: string; verified?: boolean; verifyToken?: string | null };

export function mapApiCustomDomain(d: ApiCustomDomain, routingEnabled: boolean): StoreDomain & { dnsToken?: string } {
  const verified = d.verified === true;
  return {
    id: d.id,
    type: 'custom',
    customDomain: d.domain,
    verificationStatus: verified ? 'verified' : 'pending',
    // Never report SSL as active unless a real routing/SSL provider exists.
    sslStatus: routingEnabled ? (verified ? 'active' : 'pending') : 'not_issued',
    isPrimary: false,
    dnsToken: d.verifyToken ?? undefined,
  };
}

export function verifiedDomainMessage(routingEnabled: boolean): { title: string; body: string } {
  return routingEnabled
    ? { title: 'Verified', body: 'Your domain is verified and SSL is being issued.' }
    : {
      title: 'DNS verified',
      body: "You own this domain. Custom domain routing isn't available yet, so it won't load your store until we turn it on.",
    };
}
