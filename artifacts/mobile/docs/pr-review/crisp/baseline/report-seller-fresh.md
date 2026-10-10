# Crisp crawl

369 screens × 1 states (seller-fresh) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| blur | yes | 10 | 10 |
| smear-shadow | no | 7 | 6 |
| text-opacity | yes | 92 | 38 |
| text-scale | yes | 13 | 3 |
| font-fraction | no | 1 | 1 |
| text-faded | no | 11 | 7 |

## Allowed (by design)

- smear-shadow (seller-global-tab-bar): 945
- blur (seller-global-tab-bar): 1260

## Findings by screen

### / (seller, fresh)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(buyer) (seller, fresh) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(buyer)/activity (seller, fresh) → /(tabs)/activity
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/discover-feed (seller, fresh) → /(tabs)/discover-feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/feed (seller, fresh) → /feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/friends (seller, fresh) → /(tabs)/friends
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/orders (seller, fresh) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs) (seller, fresh) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/analytics (seller, fresh) → /analytics
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(tabs)/feed (seller, fresh) → /feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/marketing (seller, fresh) → /marketing
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/more (seller, fresh) → /more
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — S Seller FREE Edit profile
- **text-opacity** opacity 0.70 — 
- **text-opacity** opacity 0.70 — 

### /(tabs)/profile (seller, fresh) → /profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /access-code (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /activity-people (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /add-product (seller, fresh)
- **text-opacity** opacity 0.50 — Save <add-product-save>

### /admin-promotions (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-brain (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-helper (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-photography-chat (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-advanced (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-audience (seller, fresh)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /analytics-cohorts (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-content (seller, fresh)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /analytics-export (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-product-stats (seller, fresh)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-products (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-sales (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /app-icon (seller, fresh) → /appearance
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /appearance (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /bg-removal (seller, fresh) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /biometric-unlock (seller, fresh)
- **text-opacity** opacity 0.50 — Require Biometrics <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Off <scene-bottom-clearance>

### /boost (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-account-center (seller, fresh)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco <scene-bottom-clearance>

### /buyer-account-control (seller, fresh)
- **text-opacity** opacity 0.50 — Continue <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-blocked (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-checkout (seller, fresh) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /buyer-collection (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-drafts (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-drops (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-gift-cards (seller, fresh)
- **text-opacity** opacity 0.50 — Add <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-highlights-manager (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-login-activity (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-my-sizes (seller, fresh)
- **text-opacity** opacity 0.50 — XXS <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — XS <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — S <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — M <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — L <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — XL <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — XXL <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 3XL <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 26 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 28 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 29 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 30 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 31 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 32 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 33 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 34 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 36 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 38 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 40 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 6 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 7 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 8 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 8.5 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 9 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 9.5 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 10 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 10.5 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 11 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 12 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 13 <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — 14 <scene-bottom-clearance>

### /buyer-other-profile (seller, fresh)
- **text-opacity** opacity 0.50 — Follow <buyer-other-profile>
- **text-opacity** opacity 0.50 —  <buyer-profile-message>
- **text-opacity** opacity 0.50 — Message <buyer-profile-message>
- **text-opacity** opacity 0.50 —  <buyer-other-profile>
- **text-opacity** opacity 0.50 — Stories <buyer-other-profile>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-post-comments (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-problem-report (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-refund-request (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-restricted (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search-history (seller, fresh)
- **text-opacity** opacity 0.40 — Clear all <screen-header>

### /buyer-security (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-settings-detail (seller, fresh)
- **text-opacity** opacity 0.50 — Sensitive content <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — standard <scene-bottom-clearance>
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Reset suggested content <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-story-create (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.5) — POST
- **text-faded** color rgba(255, 255, 255, 0.5) — LIVE
- **text-faded** color rgba(255, 255, 255, 0.5) — Tap for photo · Hold for video

### /buyer-story-viewer (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-your-activity (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /call-screen (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /change-email (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /checkout (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-create (seller, fresh)
- **text-opacity** opacity 0.50 — Open <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-join (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /connections (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-group-create (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-privacy-safety (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /create-post (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /creator-program (seller, fresh)
- **text-opacity** opacity 0.45 — Continue <scene-bottom-clearance>

### /creator-program-join (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /customer-privacy (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /delete-account (seller, fresh)
- **text-opacity** opacity 0.50 — Continue <scene-bottom-clearance>

### /design (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-ai-photoshoot (seller, fresh)
- **blur** backdrop-filter: saturate(1.8) blur(4.8px) — div

### /design-bg-removal (seller, fresh)
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-bg-replace (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-campaign (seller, fresh)
- **text-opacity** opacity 0.50 —  <stage-continue-btn>
- **text-opacity** opacity 0.50 — Launch · $25 <stage-continue-btn>

### /design-canvas (seller, fresh)
- **text-opacity** opacity 0.35 —  <btn-undo>
- **text-opacity** opacity 0.35 —  <btn-redo>
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.45) 0px 6px 14px 0px — div
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-export (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.7) — – <scene-bottom-clearance>

### /design-mockup-preview (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-project (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-templates (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.6) —  <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-versions (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /dispute-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /drops/drop_demo_1 (seller, fresh) → /buyer-drop-detail
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /edit-profile (seller, fresh)
- **text-opacity** opacity 0.40 — Save <screen-header>

### /email-audience (seller, fresh)
- **text-opacity** opacity 0.35 — Export CSV <scene-bottom-clearance>

### /email-campaign-compose (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-settings (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /finance (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /first-run-tips-settings (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /forgot-password (seller, fresh)
- **text-opacity** opacity 0.50 — Send reset code

### /freelancer-apply (seller, fresh)
- **text-opacity** opacity 0.40 — Continue <scene-bottom-clearance>

### /freelancer-jobs (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fulfill-batch (seller, fresh)
- **text-opacity** opacity 0.50 — Print labels <scene-bottom-clearance>
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Mark shipped <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /general-settings (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /gift-cards-manage (seller, fresh)
- **text-opacity** opacity 0.50 — Add <scene-bottom-clearance>

### /growth-link-new (seller, fresh)
- **text-opacity** opacity 0.50 — Create link <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /help (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations/shopify-fulfillment (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ip-report (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /launch-publish (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /link-in-bio (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-cohost (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-feed (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-replays (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /locations (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /login-methods (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer (seller, fresh) → /manufacturer-hub
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-hub (seller, fresh)
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>

### /manufacturer-messages (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-profile (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /meta-ads-setup (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /mobile-app-builder (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /muted-words (seller, fresh)
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.17 — Mute <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — spoilers <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — giveaway <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — dm me <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — resell <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — crypto <scene-bottom-clearance>

### /navigation-isolation-probe (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /notifications-settings (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /order-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /p/post_demo_1 (seller, fresh) → /buyer-post-viewer
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payouts (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /post-captions-edit (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-editor (seller, fresh) → /add-product
- **text-opacity** opacity 0.50 — Save <add-product-save>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-launches (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-pairings (seller, fresh)
- **text-opacity** opacity 0.50 — Save <scene-bottom-clearance>

### /product-questions (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-size-chart (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-video (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /products-bulk-edit (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /profile-videos (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quick-replies (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-post (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-request (seller, fresh)
- **text-opacity** opacity 0.50 — Back

### /refund-policy (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /return-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-list (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-post (seller, fresh)
- **text-opacity** opacity 0.50 — Send RFQ to manufacturers <scene-bottom-clearance>

### /sample-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-activity (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-creator-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-creator-program (seller, fresh)
- **text-opacity** opacity 0.45 — Send invite <scene-bottom-clearance>

### /seller-creator-settings (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drop-create (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drops (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-giveaway-detail (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-inbox (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-push-broadcast-results (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-reviews (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-verification (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /setup (seller, fresh)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Next: Create your seller account <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /share-store (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shipping-delivery (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /size-chart-template-apply (seller, fresh)
- **text-opacity** opacity 0.50 — Choose products <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /splash (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-ai-improve (seller, fresh)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — accessibility Low text contrast detected PROBLEM <scene-bottom-clearance>
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — layout Move Best Sellers higher PROBLEM: Best se <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-builder (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.7) — Store Builder <scene-bottom-clearance>
- **text-faded** color rgba(255, 255, 255, 0.75) — Every Brandthread store begins with one focused, <scene-bottom-clearance>

### /store-domain (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-editor (seller, fresh)
- **text-opacity** opacity 0.40 —  <screen-header>
- **text-opacity** opacity 0.40 —  <screen-header>

### /store-from-logo (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-from-moodboard (seller, fresh)
- **text-opacity** opacity 0.50 — Analyze Mood Board <scene-bottom-clearance>

### /store-from-social (seller, fresh)
- **text-opacity** opacity 0.50 — Analyze Screenshots <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-generate (seller, fresh)
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 

### /store-generating (seller, fresh) → /store-generate
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-pixels (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-preview-as-buyer (seller, fresh) → /seller-profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-seo (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-setup-name (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-theme-picker (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store/product/prod_nl_jacket_rust (seller, fresh) → /product-detail
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /story-mention-viewer (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 
- **text-faded** color rgba(255, 255, 255, 0.7) — Story unavailable

### /subscription (seller, fresh)
- **text-opacity** opacity 0.60 — + 5% platform commission on sales <scene-bottom-clearance>
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.32) 0px 5px 14px 0px — MOST POPULAR Growth Create products and source p <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — MOST POPULAR <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — Growth <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — Create products and source production <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — $79 <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — /mo <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> —  <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — Everything in Starter <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — AI logos, mockups, product photography, and life <scene-bottom-clearance>
- **text-scale** scale 1.015×1.015 on <div> — Background removal and replacement <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /team (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /tech-pack-generator (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash (seller, fresh)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Your balance $0.00 Thread Cash isn't money — it  <scene-bottom-clearance>
- **text-faded** color rgba(255, 255, 255, 0.7) — Thread Cash isn't money — it can't be cashed out <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash-ledger (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-checkout (seller, fresh) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /thread-explainer (seller, fresh) → /onboarding
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /u/northlinestudio (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /vacation-mode (seller, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
