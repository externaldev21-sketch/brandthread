# Store builder → publish → domains → buyers

## Build and publish (seller)

```mermaid
flowchart LR
  B[store-builder / store-editor] -->|storeService.saveStorefront → PUT /api/store<br/>title, sections, theme, branding, seo, socialLinks, analyticsCode| S[(storefronts)]
  V[store versions] -->|POST /api/store/versions/:id/restore| S
  P[store-publish.tsx] -->|publishStore → POST /api/store/publish| S2[(storefronts.status = published)]
  P -->|server call failed| X[Cannot publish + reason<br/>local status rolled back]
  P -->|success| L[Your store is live!<br/>https://slug.brandthread.app<br/>View store → brandthread.app/s/slug]
```

## Buyers reach the published store

```mermaid
flowchart LR
  SH[Share Store link<br/>brandthread.app/store/username] -->|web server 302| U[/api/store/by-username/:username/]
  PATH[brandthread.app/s/slug] -->|302| SITE[/api/store/site/:slug/]
  SUB[slug.brandthread.app/] -->|302| HS[/api/store/host-site<br/>resolves Host/]
  CD[verified custom domain /] -->|302| HS
  APP[in-app buyer screens] -->|GET /api/store/public/:slug — no session| J[public fields only]
  U & SITE & HS --> H[storefront page: sections, real products,<br/>cart and guest checkout]
  U & SITE & HS & J -.draft store.-> NF[404 / bounce to brandthread.app]
```

## Custom domains

```mermaid
flowchart LR
  A[store-domain: Add domain] -->|POST /api/store/domains| N{normalise: lowercase,<br/>strip scheme/path, a real hostname,<br/>not brandthread.app}
  N -->|taken: verified, or claimed under 48 h| T[409 DOMAIN_TAKEN]
  N -->|free, or a stale unverified claim| R[(storefront_custom_domains)]
  R -->|seller adds TXT _brandthread-verify.domain| VF[POST /domains/:id/verify — real DNS lookup]
  VF -->|verified| HS[served at the domain root]
```

## Breaks found and fixed

| # | Break | Fix |
|---|---|---|
| 1 | **Buyers could not reach a published store.** The Share Store link `brandthread.app/store/<username>` had no handler. Nothing served `<slug>.brandthread.app` or a verified custom domain. The only working address was `/api/store/site/<random slug>`, which nothing linked to. | `/api/store/by-username/:username` and `/api/store/host-site` (resolves the Host header). The web server (`server/storefrontRedirects.js`) redirects `/store/<username>`, `/s/<slug>`, store subdomains and custom-domain roots to them. Only published stores are ever served. |
| 2 | `GET /api/store/public/:slug` is meant to be public but sat **after `requireAuth`**, so signed-out buyers got 401. It also returned the **whole row**: preview-share token hash, analytics code, and other owner-only fields. | A public handler before `requireAuth` returns `publicStorefrontView` (public fields only). The old handler, now unreachable, can be deleted once #699 merges; it was left untouched to avoid a conflict. |
| 3 | **Social links and the analytics code never saved.** `PUT /api/store` and version restore wrote `social_links` / `analytics_code`, which Drizzle's `.set()` silently ignores. | They're mapped to the schema keys. |
| 4 | The publish screen showed and opened **`slug.brandthread.app.brandthread.app`** (before screenshot). | `lib/storeAddress.ts` normalises the host. "View store" opens `brandthread.app/s/<slug>`, which works without DNS. |
| 5 | **Publish reported "Your store is now live" even when the server call failed**, so the store stayed a draft to buyers. | The failure is returned (`Cannot publish: …`) and the local status rolls back. |
| 6 | **Domain squatting and a 500 on duplicates.** Domains weren't normalised; the column is globally unique even while unverified, so a duplicate threw a unique violation, and anyone could park a brand's real domain by adding it and never verifying. | Normalise and validate (400). A domain that's verified or freshly claimed by another store returns 409 `DOMAIN_TAKEN`. Unverified claims older than 48 hours are released. |
| 7 | `ad-campaigns.test.ts`: 19 tests were red on dev. The route gained `requirePermission("marketing")`, which reads Clerk directly, and the test never stubbed it. | The test stubs it, and 64/64 pass. Team gating has its own suite (#703). |

## Setup Dev needs, outside the code
- **`*.brandthread.app` subdomains:** a wildcard DNS record (`*.brandthread.app` CNAME to the deployment) plus a wildcard TLS certificate on the deployment. Until then, use `brandthread.app/s/<slug>` and the Share Store link, which already work.
- **Custom domains:** the seller adds the TXT record (verified in-app) and a CNAME to the deployment, and the deployment needs a TLS certificate for that domain (Replit Deployments → Custom domains).

## Tests
- `routes/__tests__/store-publish-buyer-reach.integration.test.ts` (real store router and Postgres; only identity is a header) checks:
  1. Social links and the analytics code persist.
  2. A draft store is invisible on every buyer path.
  3. Once published, a **signed-out** buyer gets public JSON without owner-only fields, the Share Store page (username case-insensitive), and the subdomain page. `www` never resolves to a store.
  4. Custom domains are normalised and verified before they're served, are never double-claimed, and stale squats are released.
- `server/storefrontRedirects.test.ts` covers the web-server redirects, and that app hosts are never treated as stores. `lib/__tests__/storeAddress.test.ts` covers the address helper.
- Playwright at 390×844 (`node artifacts/mobile/scripts/flows/store-publish-verify.mjs`) shows the address exactly once. The build from before the change shows the doubled address.
