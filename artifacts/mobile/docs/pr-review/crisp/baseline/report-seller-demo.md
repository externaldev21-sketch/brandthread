# Crisp crawl

369 screens × 1 states (seller-demo) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| blur | yes | 10 | 10 |
| smear-shadow | no | 7 | 6 |
| text-opacity | yes | 94 | 39 |
| text-scale | yes | 13 | 3 |
| font-fraction | no | 8 | 4 |
| text-faded | no | 11 | 7 |

## Allowed (by design)

- smear-shadow (seller-global-tab-bar): 945
- blur (seller-global-tab-bar): 1260

## Findings by screen

### / (seller, demo)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(buyer) (seller, demo) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/discover (seller, demo) → /(tabs)/discover
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/edit-profile (seller, demo) → /(tabs)/edit-profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/friends (seller, demo) → /(tabs)/friends
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/orders (seller, demo) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs) (seller, demo) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(tabs)/analytics (seller, demo) → /analytics
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /(tabs)/following (seller, demo) → /following
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/more (seller, demo) → /more
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — S Seller FREE Edit profile
- **text-opacity** opacity 0.70 — 
- **text-opacity** opacity 0.70 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/studio (seller, demo) → /studio
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /add-product (seller, demo)
- **text-opacity** opacity 0.50 — Save <add-product-save>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-assistant (seller, demo) → /ai-brain
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-credits (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-photography-chat (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-advanced (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-audience (seller, demo)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /analytics-content (seller, demo)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-export (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-marketing (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-product-stats (seller, demo)
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /analytics-production (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-profit (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /app-icon (seller, demo) → /appearance
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /appearance (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /bg-removal (seller, demo) → /design-bg-removal
- **text-opacity** opacity 0.99 —  <bg-removal-dropzone>
- **text-scale** scale 1.097×1.097 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.26 —  <bg-removal-dropzone>
- **text-scale** scale 0.603×0.603 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /billing (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /biometric-unlock (seller, demo)
- **text-opacity** opacity 0.50 — Require Biometrics <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Off <scene-bottom-clearance>

### /brand (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-account-center (seller, demo)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco <scene-bottom-clearance>

### /buyer-account-control (seller, demo)
- **text-opacity** opacity 0.50 — Continue <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-category (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-checkout (seller, demo) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /buyer-close-friends (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-conversation (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-drop-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-gift-cards (seller, demo)
- **text-opacity** opacity 0.50 — Add <scene-bottom-clearance>

### /buyer-highlight-stories (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-invite (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-login-activity (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-my-sizes (seller, demo)
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
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-other-profile (seller, demo)
- **text-opacity** opacity 0.50 — Follow <buyer-other-profile>
- **text-opacity** opacity 0.50 —  <buyer-profile-message>
- **text-opacity** opacity 0.50 — Message <buyer-profile-message>
- **text-opacity** opacity 0.50 —  <buyer-other-profile>
- **text-opacity** opacity 0.50 — Stories <buyer-other-profile>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-personal-details (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-post-viewer (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-problem-report (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-refund-request (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-return-request (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search-history (seller, demo)
- **text-opacity** opacity 0.40 — Clear all <screen-header>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-settings-detail (seller, demo)
- **text-opacity** opacity 0.50 — Sensitive content <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — standard <scene-bottom-clearance>
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Reset suggested content <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-story-create (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.5) — POST
- **text-faded** color rgba(255, 255, 255, 0.5) — LIVE
- **text-faded** color rgba(255, 255, 255, 0.5) — Tap for photo · Hold for video

### /buyer-story-viewer (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-your-activity (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /call-screen (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /change-phone (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-chat (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-create (seller, demo)
- **text-opacity** opacity 0.50 — Open <scene-bottom-clearance>

### /community-guidelines (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /connections (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-group-create (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-search (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /creator-program (seller, demo)
- **text-opacity** opacity 0.45 — Continue <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /customer-privacy (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /delete-account (seller, demo)
- **text-opacity** opacity 0.50 — Continue <scene-bottom-clearance>

### /design (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-ai-photoshoot (seller, demo)
- **blur** backdrop-filter: saturate(1.8) blur(4.8px) — div

### /design-bg-removal (seller, demo)
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-brand-assets (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-campaign (seller, demo)
- **text-opacity** opacity 0.50 —  <stage-continue-btn>
- **text-opacity** opacity 0.50 — Launch · $25 <stage-continue-btn>

### /design-canvas (seller, demo)
- **text-opacity** opacity 0.35 —  <btn-undo>
- **text-opacity** opacity 0.35 —  <btn-redo>
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.45) 0px 6px 14px 0px — div
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-export (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.7) — – <scene-bottom-clearance>

### /design-garment (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-prompt-edit (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-templates (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.6) —  <scene-bottom-clearance>

### /disable-two-factor (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /dispute-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /edit-profile (seller, demo)
- **text-opacity** opacity 0.40 — Save <screen-header>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-audience (seller, demo)
- **text-opacity** opacity 0.35 — Export CSV <scene-bottom-clearance>

### /email-settings (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fees (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /find-friends-contacts (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /forgot-password (seller, demo)
- **text-opacity** opacity 0.50 — Send reset code
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /freelancer-apply (seller, demo)
- **text-opacity** opacity 0.40 — Continue <scene-bottom-clearance>

### /freelancer-profile (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fulfill-batch (seller, demo)
- **text-opacity** opacity 0.50 — Print labels <scene-bottom-clearance>
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — Mark shipped <scene-bottom-clearance>

### /fulfill-order (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /gift-cards-manage (seller, demo)
- **text-opacity** opacity 0.50 — Add <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /growth-link-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /growth-link-new (seller, demo)
- **text-opacity** opacity 0.50 — Create link <scene-bottom-clearance>

### /hashtag/streetwear (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations/shopify-fulfillment (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ip-report (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /launch-checklist (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /lifestyle-images (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /link-in-bio-stats (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-cohost (seller, demo)
- **font-fraction** font-size 15.2px — RS
- **font-fraction** font-size 15.2px — AN
- **font-fraction** font-size 15.2px — L&
- **font-fraction** font-size 15.2px — SC
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-cohost-invite (seller, demo)
- **font-fraction** font-size 15.2px — AN

### /live-moderation (seller, demo)
- **text-opacity** opacity 0.50 — Add
- **font-fraction** font-size 15.2px — ML
- **font-fraction** font-size 15.2px — JR
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-replays (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /login-methods (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer (seller, demo) → /manufacturer-hub
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-hub (seller, demo)
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>

### /manufacturer-messages (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-product (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /meta-ads-connect (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /metafields (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /muted-words (seller, demo)
- **text-opacity** opacity 0.50 —  <scene-bottom-clearance>
- **text-opacity** opacity 0.17 — Mute <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — spoilers <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — giveaway <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — dm me <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — resell <scene-bottom-clearance>
- **text-opacity** opacity 0.50 — crypto <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /notifications-settings (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /order-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /p/post_demo_1 (seller, demo) → /buyer-post-viewer
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payouts (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /post-captions-edit (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-bundles (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-editor (seller, demo) → /add-product
- **text-opacity** opacity 0.50 — Save <add-product-save>

### /product-import (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-pairings (seller, demo)
- **text-opacity** opacity 0.50 — Save <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-reviews (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-size-chart (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /production-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /profile-products (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /push-notifications (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-compare (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-post (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-request (seller, demo)
- **text-opacity** opacity 0.50 — Back

### /refund-policy (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /return-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-compare (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-post (seller, demo)
- **text-opacity** opacity 0.50 — Send RFQ to manufacturers <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /sales (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /security (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-conversation (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-creator-program (seller, demo)
- **text-opacity** opacity 0.45 — Send invite <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drop-create (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drops (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-giveaway-detail (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-inbox (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-push-broadcast-results (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-reviews (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-settings (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /setup (seller, demo)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Next: Create your seller account <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /share-store (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shipping-label (seller, demo) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shopping-preferences (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /size-chart-template-apply (seller, demo)
- **text-opacity** opacity 0.50 — Choose products <scene-bottom-clearance>

### /splash (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-ai-improve (seller, demo)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — conversion Hero button is hard to spot PROBLEM:  <scene-bottom-clearance>
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — copy Shorten homepage copy PROBLEM: Long text bl <scene-bottom-clearance>

### /store-builder (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.7) — Store Builder <scene-bottom-clearance>
- **text-faded** color rgba(255, 255, 255, 0.75) — Every Brandthread store begins with one focused, <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-domain (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-editor (seller, demo)
- **text-opacity** opacity 0.40 —  <screen-header>
- **text-opacity** opacity 0.40 —  <screen-header>

### /store-from-logo (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-from-moodboard (seller, demo)
- **text-opacity** opacity 0.50 — Analyze Mood Board <scene-bottom-clearance>

### /store-from-social (seller, demo)
- **text-opacity** opacity 0.50 — Analyze Screenshots <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-generate (seller, demo)
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 

### /store-generating (seller, demo) → /store-generate
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-pixels (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-preview (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-publish (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-seo (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-setup-name (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-versions (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store/product/prod_nl_jacket_rust (seller, demo) → /product-detail
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /story-mention-viewer (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 
- **text-faded** color rgba(255, 255, 255, 0.7) — Story unavailable

### /subscription (seller, demo)
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

### /taxes-duties (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /tech-pack-generator (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash (seller, demo)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Your balance $0.00 Thread Cash isn't money — it  <scene-bottom-clearance>
- **text-faded** color rgba(255, 255, 255, 0.7) — Thread Cash isn't money — it can't be cashed out <scene-bottom-clearance>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash-ledger (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-checkout (seller, demo) → /
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <seller-dashboard-range-indicator>

### /thread-explainer (seller, demo) → /onboarding
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /u/northlinestudio (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /vacation-mode (seller, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
