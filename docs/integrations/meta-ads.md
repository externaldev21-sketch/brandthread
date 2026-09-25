# Meta Ads (Facebook + Instagram) — Owner Setup

Brandthread's Create Ad flow lets sellers launch real Meta (Facebook +
Instagram) ad campaigns using the official Marketing API. All Graph API
calls happen server-side (`artifacts/api-server/src/lib/metaGraph.ts`,
`src/routes/meta-ads.ts`); the mobile app never sees a raw access token.
Ad spend is billed by Meta directly to each seller's own ad account payment
method — Brandthread never touches or moves that money.

This doc is **only** the setup the app owner must do once, by hand, in
Meta's own dashboards. Brandthread's engineering side (OAuth exchange,
campaign creation, insights, Conversions API) is already implemented and
does not require further setup from you beyond the steps below.

Nobody but you (or someone you explicitly authorize) should create these
accounts or submit this app for review — this doc does not do that for you.

## 1. Create a Meta Developer app (Business type)

1. Go to [developers.facebook.com](https://developers.facebook.com) and log
   in with the Facebook account that manages your business.
2. **My Apps → Create App**. Choose app type **Business**.
3. Name it something recognizable, e.g. "Brandthread Ads" — sellers will see
   this name on the Meta OAuth consent screen.
4. Link the app to your Meta **Business Portfolio** (create one at
   [business.facebook.com](https://business.facebook.com) first if you don't
   have one — it should be under your LLC, not a personal profile).

## 2. Add products to the app

In the app dashboard, **Add Product** and set up both of these:

- **Facebook Login for Business** — this is what powers "Connect Meta" in
  Brandthread. During setup it will ask for OAuth redirect URIs (see below).
- **Marketing API** — this unlocks campaign/ad-set/ad creation and the
  Insights and Conversions API endpoints Brandthread calls.

## 3. Set OAuth redirect URIs

In **Facebook Login for Business → Settings**, add these to
**Valid OAuth Redirect URIs**:

- `https://<your-api-server-domain>/api/meta-ads/oauth/callback`
  (production — this must exactly match the `META_REDIRECT_URI` env var set
  on the api-server, see §6)
- Add your staging/preview API domain's equivalent URL too if you test there.

Also set **App Domains** to your API server's domain, and fill in the
**Privacy Policy URL**, **Terms of Service URL**, and **App Icon** — Meta
requires all three before it will let you submit for review in step 5.

## 4. Business Verification

Under **Business Settings → Security Center → Business Verification**,
complete verification for your Business Portfolio:

- Legal business name, registered address, and phone number matching your
  LLC's official registration exactly (mismatches are the most common
  rejection reason).
- A document proving the business exists — articles of incorporation, a
  recent utility bill in the business name, or a business tax filing all
  work. Have this ready as a clear PDF or photo before starting.

Verification can take anywhere from a few hours to a couple of weeks. You
cannot get **Advanced Access** (step 5) without it, so start this first —
do it in parallel with steps 1–3 rather than waiting.

## 5. App Review — request Advanced Access

By default a new app only has **Standard Access**, which is rate-limited
hard enough that it cannot support real advertisers (roughly 200 calls/hour
per user, shared across everyone using your app) and — critically — Meta
will not let non-admins' ad accounts spend through it at all. You must
request **Advanced Access** for these permissions before any seller other
than you can use Connect Meta for real:

- `ads_management`
- `ads_read`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`

Check Meta's current Marketing API docs when you do this — the exact
permission list occasionally changes, and some placements (e.g. Instagram
Reels ads) have historically needed an extra scope on top of this list.

To submit:

1. **App Review → Permissions and Features**, find each permission above,
   click **Request Advanced Access**.
2. For each, Meta asks for a **screencast** showing the real user flow
   through your actual app (not a mockup). Record, in one continuous take,
   from Brandthread's seller Create Ad screen:
   - Tapping "Connect Meta" and completing the Facebook Login for Business
     consent screen (showing the exact scopes being granted).
   - Picking a Business, Ad Account, Facebook Page, and Instagram account.
   - Building a campaign end to end (creative, goal, audience, budget) and
     tapping Launch.
   - The resulting live campaign visible both in Brandthread's Manage
     screen (spend/reach/clicks) and in Meta Ads Manager, to prove the
     write actually landed on Meta's side.
   - `ads_read`/`insights` specifically needs the Manage screen showing
     real delivered numbers, not just zeros.
3. Write the "how is this permission used" text plainly: e.g. for
   `ads_management`, "Brandthread is a platform used by independent online
   sellers to create and manage Facebook/Instagram ad campaigns for their
   own stores, paid for with their own ad account's payment method."
4. Submit all six permissions in one review batch — Meta reviews them
   together faster than one at a time.

## 6. Configure the app's own environment

Once you have the App ID/Secret, set these on the api-server's environment
(never commit real values — see `.env.example` for the placeholder names):

| Variable | Value |
|---|---|
| `META_APP_ID` | From the app dashboard's Basic Settings |
| `META_APP_SECRET` | From the app dashboard's Basic Settings — keep this secret, server-side only |
| `META_REDIRECT_URI` | Must exactly match what you added in step 3 |
| `META_GRAPH_API_VERSION` | The current Marketing API version, e.g. `v21.0` — check Meta's changelog periodically and bump this before Meta sunsets the old version |
| `META_TOKEN_ENCRYPTION_KEY` | A random 32-byte key, base64-encoded (e.g. `openssl rand -base64 32`) — used to encrypt sellers' stored tokens at rest. Losing this key invalidates every connected seller's token and they'll need to reconnect. |
| `META_OAUTH_STATE_SECRET` | A random secret used to sign the OAuth `state` parameter — any long random string, e.g. `openssl rand -hex 32` |

Restart the api-server after setting these.

## 7. Until App Review is approved

While your app only has Standard Access (i.e. before step 5 is approved):

- **Development mode only works for ad accounts where you are personally an
  admin.** Add any test sellers as admins on your Meta app
  (**App Roles → Roles**) and add their ad accounts under your Business
  Portfolio if you want to test with someone other than yourself.
- Standard Access rate limits (shared across all app users, roughly
  200 calls/user/hour) are not workable for real, unrelated sellers — treat
  anything before Advanced Access approval as internal testing only. Do not
  announce "Connect Meta" to real sellers until Advanced Access is granted.
- Live campaigns you create during this period still spend real money on
  Meta and behave identically to post-approval campaigns — only the ability
  for *other people's* ad accounts to connect is restricted.

## 8. Re-verification

Meta periodically re-reviews apps with Advanced Access (typically annually,
or whenever you materially change how a permission is used). Keep a current
screencast on hand and update the "how this permission is used" text if the
Create Ad flow changes meaningfully.
