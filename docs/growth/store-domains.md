# Store addresses: `<slug>.brandthread.app` and custom domains

Nothing in the app calls a store address **live** or **verified** until it really serves the store (BT-307/316/317/318). Two switches on the API decide what the app shows:

| Env var (API deployment) | Set it when | What changes in the app |
|---|---|---|
| `STORE_SUBDOMAINS_ENABLED=true` | Steps 1–3 below are done and `https://<slug>.brandthread.app` opens a published store | Domains screen shows the subdomain as the store link with a **Live** badge; `GET /api/store/address` returns it as `liveUrl` |
| `CUSTOM_DOMAINS_ENABLED=true` and `CUSTOM_DOMAIN_CNAME_TARGET=stores.brandthread.app` | Step 4 below is done | Sellers can add a custom domain (it is refused with `CUSTOM_DOMAINS_OFF` until then), see the exact CNAME to add, and a verified domain shows as live |

While a switch is off, the Domains screen shows the store link that works today (`brandthread.app/store/<username>`), the subdomain field still saves the store's address **on the server** (`PATCH /api/store/slug`, unique, validated), and there is no Verified / SSL badge.

## 1. Put brandthread.app's DNS on Cloudflare (free plan is enough)
1. dash.cloudflare.com → **Add a site** → `brandthread.app` → Free plan.
2. Cloudflare copies the existing records. Keep the records Replit gave you for `brandthread.app` exactly as they are (Replit → Deployments → Settings → Custom domain shows them). Set those to **DNS only** (grey cloud) so Replit keeps issuing the certificate for the main site.
3. At your registrar, replace the nameservers with the two Cloudflare shows. Wait until Cloudflare says the site is **Active**.

## 2. Wildcard record + certificate
1. Cloudflare → `brandthread.app` → **DNS → Records → Add record**: Type `CNAME`, Name `*`, Target `brandthread.app`, Proxy status **Proxied** (orange cloud). Save.
2. **SSL/TLS → Overview**: mode **Full (strict)**.
3. **SSL/TLS → Edge Certificates**: Universal SSL is **Active**. It covers `brandthread.app` and `*.brandthread.app` at no cost. (Nothing to buy: Universal SSL includes one level of wildcard.)

## 3. Host routing (the Worker in this repo)
`artifacts/api-server/cloudflare/store-hosts-worker.js` maps `<slug>.brandthread.app/` to the store's public page (`/api/store/site/<slug>`) and passes other paths through to the main site. Tests: `src/lib/__tests__/storeHostsWorker.test.ts`.
1. Cloudflare → **Workers & Pages → Create → Create Worker** → name `brandthread-store-hosts` → **Deploy** → **Edit code** → paste the file's contents → **Deploy**.
2. Worker → **Settings → Variables**: `ORIGIN` = `https://brandthread.app`.
3. Worker → **Settings → Domains & Routes → Add → Route**: zone `brandthread.app`, route `*.brandthread.app/*`.
4. Add routes that **skip** the Worker for platform hosts if you use any (e.g. `www.brandthread.app/*` with "Worker: None"). The Worker also ignores `www`, `api`, `app`, `admin` and the other reserved labels.
5. Check: publish a test store, open `https://<its slug>.brandthread.app` — the store page loads with a valid certificate.
6. Set `STORE_SUBDOMAINS_ENABLED=true` on the API deployment (Replit → Deployments → Secrets) and redeploy.

## 4. Custom domains (Cloudflare for SaaS)
1. Cloudflare → `brandthread.app` → **SSL/TLS → Custom Hostnames** → enable Cloudflare for SaaS (first 100 hostnames free, then $0.10 per hostname per month).
2. Add a DNS record `stores` → CNAME `brandthread.app`, **Proxied**, and set **Fallback Origin** = `stores.brandthread.app`.
3. Add a Worker route `*/*` on the SaaS zone for `brandthread-store-hosts` (custom hostnames go through the same Worker; it asks `GET /api/store/host-lookup?host=...`, which only answers for verified domains of published stores).
4. For each verified seller domain, add it under **Custom Hostnames** (validation: HTTP). Cloudflare issues its certificate once the seller's CNAME points at `stores.brandthread.app`. (This step can be automated later with the Cloudflare API: `POST /zones/{zone_id}/custom_hostnames`, token scope *SSL and Certificates: Edit*; env `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`.)
5. Set `CUSTOM_DOMAINS_ENABLED=true` and `CUSTOM_DOMAIN_CNAME_TARGET=stores.brandthread.app` on the API deployment.

Sellers then see: add domain → TXT record (ownership) → **Verify DNS** → CNAME to `stores.brandthread.app`.
