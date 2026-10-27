# Import from Shopify (full catalog, official OAuth)

Seller dashboard → "Import from Shopify" (also Products → ⋯ → Import from
Shopify) brings a seller's **whole** Shopify catalog into Brandthread:
names, descriptions, every photo, variants with their options (Size, Color,
…), prices and stock per variant. Products land as **drafts** in Products,
ready to review and publish.

## How it works

1. The seller types their store name (`northline` → `northline.myshopify.com`)
   and taps **Continue to Shopify**.
2. `POST /api/shopify/connect/start` returns Shopify's own authorize URL
   (`https://<shop>.myshopify.com/admin/oauth/authorize`, scopes
   `read_products,read_inventory`). The app opens it in an in-app browser:
   the seller signs in **on Shopify** and approves read-only access.
3. Shopify redirects to `GET /api/shopify/oauth/callback`. The server checks
   Shopify's HMAC and our one-time `state`, exchanges the code for an access
   token server-side, encrypts it (AES-256-GCM) and stores the connection.
   The page sends the seller back to `brandthread://shopify-import`.
4. The app starts `POST /api/shopify/catalog-import`. A background job pages
   the catalog over the **GraphQL Admin API** (`2026-10`, active + draft
   products), maps each product with `toBrandthreadProduct`, copies photos
   from `cdn.shopify.com` into object storage, and writes progress the app
   polls (`GET /api/shopify/catalog-import/:id` → "23 of 61 products").
5. Re-running updates the same Brandthread products (matched through
   `shopify_product_links`), never duplicates, and never re-downloads a photo
   it already copied (`image_map`).

There is no route that accepts a pasted token, API key or password — the
only way to connect is Shopify's consent screen.

Until the two credentials below are set, `GET /api/shopify/status` reports
`configured: false`, `connect/start` answers `503 not_configured`, and the
screen says "Shopify import is almost ready" — it never pretends to connect.

## Server secrets

| Secret | Value | Required |
| --- | --- | --- |
| `SHOPIFY_APP_API_KEY` | the app's **Client ID** | yes |
| `SHOPIFY_APP_API_SECRET` | the app's **Client secret** | yes |
| `SHOPIFY_APP_REDIRECT_URI` | override for the callback URL | no — defaults to `https://brandthread.app/api/shopify/oauth/callback` in production |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 | no — derived from the client secret when unset. Set one before you ever rotate the client secret, or sellers will have to reconnect. |

## One-time setup in Shopify (owner)

1. Sign in to the Shopify **Dev Dashboard** (dev.shopify.com — reached from
   the Partner Dashboard, partners.shopify.com, with a free Partner account).
2. **Apps → Create app → Start from Dev Dashboard**, name it `Brandthread`,
   **Create**.
3. **Versions → Create version** (labels as of Oct 2026; Shopify renames
   these occasionally):
   - **App URL**: `https://brandthread.app`
   - **Embed in Shopify admin**, if offered: off (Brandthread is not an embedded app)
   - **Use legacy install flow**, if offered: on — Brandthread sends the
     scopes itself on Shopify's authorize URL (authorization code grant)
   - **Redirect URLs**: `https://brandthread.app/api/shopify/oauth/callback`
     (exactly — this must match the server's redirect URL)
   - **Scopes**: `read_products`, `read_inventory`
     (add `read_orders`, `write_orders`, `read_fulfillments` too only if you
     also want "Fulfill orders through my Shopify store")
   - **Webhooks API version**: the newest, `2026-10`
   - **Compliance webhooks** (`customers/data_request`, `customers/redact`,
     `shop/redact`): `https://brandthread.app/api/webhooks/shopify` — required
     for public apps; the server already answers all three
   - **Release**.
4. App **Settings** → copy **Client ID** and **Client secret** into the two
   server secrets above.
5. **Distribution** card → **Public distribution** (this can't be changed
   later). Sellers on stores you don't own can only install a publicly
   distributed app, and Shopify reviews public apps before they can be
   installed on stores outside your development stores. You can submit it
   unlisted. Until approval, test end to end on a development store
   (Dev Dashboard → Stores → create a dev store, add a few products).
