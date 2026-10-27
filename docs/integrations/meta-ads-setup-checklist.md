# Meta (Facebook + Instagram) Ads: owner setup checklist

This is everything outside the codebase that has to happen before real sellers can connect Meta and run ads from Brandthread. Names, paths and env vars are taken from the code (`artifacts/api-server/src/routes/meta-ads.ts`, `src/lib/metaGraph.ts`, `src/lib/metaConnection.ts`). Where I'm not sure how Meta behaves today, the item says so. Check those against Meta's current docs before you rely on them.

---

## 0. Before you start

- [ ] Have a **Meta Business Portfolio** (business.facebook.com) owned by the company (the LLC), not a personal profile.
- [ ] Publish a **Privacy Policy URL** and a **Terms of Service URL**. The app already links to `https://brandthread.app/privacy` and `https://brandthread.app/terms`. Before App Review, make sure the privacy policy says what Meta data is stored: the seller's encrypted long-lived Meta user token, Meta user id and name, business, ad account, Page and Instagram ids and names, the pixel id, and campaign insights. It must also say why the data is stored and how a seller removes it.
- [ ] Have a 1024×1024 **app icon** and a **contact email** ready.

## 1. Create the Meta developer app

- [ ] developers.facebook.com → **My Apps → Create App** → use case or type **Business** (the wording of this wizard changes often; pick the option for "manage business assets / ads").
- [ ] Use a name sellers will recognise, such as "Brandthread". Sellers see it on the Facebook Login consent screen.
- [ ] Link the app to your **Business Portfolio**.
- [ ] **App settings → Basic**: fill in App Domains (your API domain, e.g. `brandthread.app`), Privacy Policy URL, Terms of Service URL, App icon, Category, and Contact email.

## 2. Add products

- [ ] **Facebook Login for Business**: this powers "Connect Meta".
- [ ] **Marketing API**: needed for campaigns, ad sets, creatives, ads, insights, delivery estimates and the Conversions API.

### Facebook Login for Business settings
- [ ] **Valid OAuth Redirect URIs**: add this exact URL:
  - `https://<your-api-domain>/api/meta-ads/oauth/callback` (for example `https://brandthread.app/api/meta-ads/oauth/callback`, the value in `.env.example`)
  - Add the same path on each staging or preview API domain you test from.
  - The value must match `META_REDIRECT_URI` character for character. The server sends it in the Login dialog and again in the code exchange. (The router is also mounted at `/api/v1/...`, but only the URL in `META_REDIRECT_URI` is ever used.)
- [ ] Keep **Use Strict Mode for Redirect URIs** on, and **Client OAuth Login** and **Web OAuth Login** on.
- [ ] You do **not** need to whitelist the app's `brandthread://meta-ads-connect` deep link. The server's callback redirects the browser to it after Meta has already redirected to the https URL above.
- [ ] **Configuration (recommended):** create a Facebook Login for Business *configuration*. Choose the **User access token** type and select the permissions in section 4. Put its id in `META_LOGIN_CONFIG_ID`. When that env var is set, the server sends `config_id` instead of `scope`. *Unsure:* Meta's docs steer Business-type apps toward configurations. I could not confirm whether the plain `scope` parameter (used when `META_LOGIN_CONFIG_ID` is empty) still works for every Business app, so test both before review.

## 3. Server environment variables (api-server)

| Variable | Required | What it is |
|---|---|---|
| `META_APP_ID` | yes | App settings → Basic → App ID |
| `META_APP_SECRET` | yes | App settings → Basic → App Secret. Server only. Also used for `appsecret_proof` on every Graph call, so you can turn on **Require App Secret** under Advanced settings. |
| `META_REDIRECT_URI` | yes | Exactly the redirect URI from section 2 |
| `META_TOKEN_ENCRYPTION_KEY` | yes | Base64 of 32 random bytes (`openssl rand -base64 32`). Encrypts stored tokens with AES-256-GCM. If you lose or rotate it, every seller has to reconnect. |
| `META_OAUTH_STATE_SECRET` | yes | Any long random string (`openssl rand -hex 32`). Signs the OAuth `state` (CSRF; valid for 10 minutes). |
| `META_LOGIN_CONFIG_ID` | optional | The Facebook Login for Business configuration id from section 2 |
| `META_GRAPH_API_VERSION` | optional | Overrides the pinned version (default `v24.0` in `metaGraph.ts`). Check Meta's Marketing API changelog. Each version is retired about a year after its successor ships. |
| `META_ADS_SANDBOX` | test only | `1` routes every campaign, targeting, preview and estimate call to the sandbox ad account below. **Never set this in production.** |
| `META_SANDBOX_AD_ACCOUNT_ID` | test only | Sandbox ad account id (`act_` is added if you leave it off) |
| `META_SANDBOX_ACCESS_TOKEN` | test only, optional | The token Meta generates for the sandbox account. If you leave it out, the seller's own token is used, which only works for people with a role on the app. |
| `EXPO_PUBLIC_META_PIXEL_ID` | optional (mobile) | Already in `.env.example`, for client-side pixel events |

Restart the API after you change these. `GET /api/meta-ads/connection` answers `state: "not_configured"` until `META_TOKEN_ENCRYPTION_KEY` is set. `/oauth/start` answers 503 until `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_OAUTH_STATE_SECRET` and the encryption key are all set.

## 4. Permissions the code requests, and App Review

The Login dialog asks for exactly these (`META_OAUTH_SCOPES` in `metaGraph.ts`). If you use a Login for Business configuration, select the same set there.

| Permission | Used for | Needs Advanced Access for real sellers |
|---|---|---|
| `ads_management` | Create and pause/resume campaigns, ad sets, creatives and ads; create or read the pixel; targeting search; previews; delivery estimate | yes |
| `ads_read` | Campaign insights (spend, reach, clicks, purchases) and effective status | yes |
| `business_management` | List the seller's businesses and each business's owned ad accounts and Pages | yes |
| `pages_show_list` | List the seller's Pages | yes |
| `pages_read_engagement` | Read Page details and the linked Instagram account | yes |
| `pages_manage_ads` | Run ads as the seller's Page (creatives create Page posts) | yes |
| `instagram_basic` | Read the linked Instagram account (username) and recent media (Instagram product import) | yes |

- [ ] The server refuses a connection if the seller unticks `ads_management`, `business_management` or `pages_show_list` (`META_REQUIRED_SCOPES`). The seller sees "connect again and keep every permission switched on".
- [ ] Every permission above works with Standard Access, but only for people who have a **role on the app** (admin, developer or tester) and only on their own assets. Sellers without a role need **Advanced Access** for each permission, granted through **App Review**.
- [ ] *Related, and I'm unsure of current specifics:* the Marketing API has a separate **"Ads Management Standard Access"** feature that raises rate limits. Meta has required a history of successful API calls before you can request it. Check App Review → Permissions and Features for it.
- [ ] *Unsure:* `instagram_basic` is the Facebook-Login-based Instagram permission. Meta also has newer `instagram_business_*` permissions for "Instagram API with Instagram Login". The code uses the Facebook-Login one, so request `instagram_basic` unless App Review tells you otherwise.

## 5. Business Verification

- [ ] Business Settings → **Security Center → Business Verification**: legal name, address and phone exactly as registered, plus a supporting document (articles of organisation, utility bill or tax document in the business name).
- [ ] Advanced Access for these permissions requires a verified business. Start this first, because it can take days to weeks.
- [ ] Depending on your account, Meta may also ask you to complete **Access Verification** (tech provider) because the app accesses other businesses' assets. *Unsure whether this applies;* the dashboard will prompt you if it does.

## 6. Data use, privacy and deletion requirements

- [ ] **Data Use Checkup**: Meta asks app admins to certify each year that permission use matches policy. Do it when prompted, or the app gets restricted.
- [ ] **Data Deletion**: in App settings → Basic you must give either a *Data Deletion Request Callback URL* or a *Data Deletion Instructions URL*.
  - **The code does NOT implement Meta's signed-request data-deletion callback.** Use the **Instructions URL** option: a public page that says sellers can disconnect Meta in Brandthread (Meta Ads → Connect Meta → Disconnect, which clears the stored token), delete their Brandthread account at `/api/public/account-deletion`, and remove the app from Facebook Settings → Business Integrations.
  - If Meta later insists on a callback, a `signed_request` endpoint needs to be built. That is not done.
- [ ] *Optional:* a **Deauthorize Callback URL** is not implemented. The server finds out about a removed app the next time it calls Meta (code 190). The connection then shows "Reconnect Meta".
- [ ] Disconnect in Brandthread only deletes our copy of the token. It doesn't call `DELETE /me/permissions`. Mention this in the instructions page.

## 7. Test before review (Development mode)

- [ ] Leave the app in **Development** mode. Add yourself and any testers under **App roles → Roles** (Facebook test users can't own real Pages or ad accounts, so use real accounts with a tester or developer role).
- [ ] **Sandbox ad account (no spend):** Marketing API → Tools (or the "Sandbox ad accounts" section; the location varies) → create a sandbox ad account and generate its token. Set `META_ADS_SANDBOX=1`, `META_SANDBOX_AD_ACCOUNT_ID`, and `META_SANDBOX_ACCESS_TOKEN` on a **staging** API. Sandbox accounts accept the same create calls but never deliver or bill. The app shows "Sandbox mode" on the connected card.
  - *Unsure:* whether a sandbox ad account accepts creatives that use a real Page id and image uploads by URL. Expect some creative or preview calls to behave differently there.
- [ ] Run the whole flow in a native or EAS build (Expo Go can't receive `brandthread://` redirects):
  1. Meta Ads → Connect Meta → Facebook Login → pick Business, Ad account and Page → Finish.
  2. Run a Meta ad: product, copy, goal (Sales / Traffic / Awareness → `OUTCOME_SALES` / `OUTCOME_TRAFFIC` / `OUTCOME_AWARENESS`), audience, budget, dates → Launch.
  3. In Ads Manager (or the sandbox account), confirm: the campaign is created PAUSED and then switched ACTIVE, the ad set has the budget in cents and the right start and end times, and the creative and ad exist.
  4. Manage: refresh insights, pause/resume, edit budget.
  5. Expiry: set `token_expires_at` in the past for your row. The screens should show **Reconnect Meta**, not "Connect Meta".
- [ ] Before review, run at least one real low-budget campaign on a real ad account (with a role on the app). Reviewers want to see real delivery data for `ads_read`.

## 8. App Review submission (screencast)

For each permission, Meta asks how it is used and for a **screen recording of the real app**. One continuous recording per permission (or one recording covering all of them, referenced from each) works best. Show:

- [ ] Signing in to Brandthread as a seller → Marketing → Meta Ads → **Connect Meta**.
- [ ] The **Facebook Login dialog** with the requested permissions visible, then granting them.
- [ ] Choosing the **Business** (`business_management`), **Ad account**, and **Facebook Page with its Instagram account** (`pages_show_list`, `pages_read_engagement`, `instagram_basic`).
- [ ] Building and **launching** a campaign (`ads_management`, `pages_manage_ads`), then the same campaign in **Meta Ads Manager**.
- [ ] The **Manage** screen showing real spend, reach and clicks after a refresh (`ads_read`).
- [ ] The Instagram product import screen, if you keep `instagram_basic` for it.
- [ ] Turn on captions or add a voice-over explaining each step, and give reviewers a working test login. Make sure the reviewer account can reach the Meta screens (seller account on a plan that includes marketing).
- [ ] Usage text, plainly: "Brandthread lets independent clothing sellers create and manage Facebook and Instagram ads for their own store, billed to their own ad account. We never spend on their behalf."
- [ ] Submit all seven permissions in one review request.

## 9. Go live

- [ ] After Advanced Access is approved: switch the app from **Development to Live** (the App Mode toggle at the top of the dashboard). Live mode requires the privacy policy URL, data deletion URL, icon and category to be set.
- [ ] Make sure production does **not** set `META_ADS_SANDBOX`.
- [ ] Optionally turn on **Require App Secret** (Advanced settings). The server already sends `appsecret_proof`.
- [ ] Put a reminder in the calendar: bump `META_GRAPH_API_VERSION` / `META_GRAPH_API_VERSION_DEFAULT` before Meta retires the pinned version, and redo the yearly Data Use Checkup.

## How the integration behaves (for support)

- **Long-lived tokens last about 60 days.** In the last 7 days the server tries to extend the token through `fb_exchange_token` (at most every 12 hours). *Meta doesn't promise that this extends a long-lived token.* If it doesn't, the seller sees **Reconnect Meta** once the token expires. Campaigns keep running on Meta in the meantime.
- Any Meta error with code 190 (expired 463, invalidated 467, password change, app removed) marks the connection `needs_reauth`. The API answers `409 META_RECONNECT_REQUIRED` and the app shows Reconnect.
- If Brandthread or Meta can't be reached, the app shows "Couldn't reach Meta or Brandthread — Retry", never the Connect button.
