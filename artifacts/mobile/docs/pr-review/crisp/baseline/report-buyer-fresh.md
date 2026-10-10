# Crisp crawl

369 screens × 1 states (buyer-fresh) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| blur | yes | 2 | 2 |
| text-opacity | yes | 93 | 35 |
| text-subpixel | no | 1 | 1 |
| text-scale | yes | 6 | 3 |
| font-fraction | no | 5 | 2 |
| text-faded | no | 8 | 6 |
| smear-shadow | no | 2 | 2 |

## Allowed (by design)

- smear-shadow (buyer-bottom-tab-bar): 40
- blur (buyer-bottom-tab-bar): 60

## Findings by screen

### / (buyer, fresh)
- **blur** backdrop-filter: saturate(1.8) blur(12px) — <feed-gesture-guide>
- **text-opacity** opacity 0.69 —  <feed-gesture-guide>
- **text-subpixel** translate 0.00,5.06 on <div> —  <feed-gesture-guide>
- **text-scale** scale 0.855×0.855 on <div> —  <feed-gesture-guide>
- **text-opacity** opacity 0.35 —  <feed-gesture-guide>
- **text-scale** scale 0.920×0.920 on <div> — 2x <feed-gesture-guide>

### /(buyer) (buyer, fresh) → /
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/discover (buyer, fresh) → /discover
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/edit-profile (buyer, fresh) → /edit-profile
- **text-opacity** opacity 0.35 — Save <screen-header>
- **font-fraction** font-size 36.48px — ?
- **font-fraction** font-size 12.5px — Up to 25 seconds. Plays muted on a loop behind y
- **font-fraction** font-size 13.5px — Add
- **font-fraction** font-size 12.5px — Shown next to your name on your profile.
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/following (buyer, fresh) → /following
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/orders (buyer, fresh) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs) (buyer, fresh) → /
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/feed (buyer, fresh) → /feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/marketing (buyer, fresh) → /(buyer)/marketing
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/orders (buyer, fresh) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/profile (buyer, fresh) → /profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /access-code (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /activity-center (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /add-product (buyer, fresh)
- **text-opacity** opacity 0.50 — Save <add-product-save>

### /admin-invites (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /admin-reports (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-brand-memory (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-photography-chat (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-advanced (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-content (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-goals (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-profit (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-store (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /app-theme (buyer, fresh) → /appearance
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /automation (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /bg-removal (buyer, fresh) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /biometric-unlock (buyer, fresh)
- **text-opacity** opacity 0.50 — Require Biometrics
- **text-opacity** opacity 0.50 — Off
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /brand (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-account-center (buyer, fresh)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco

### /buyer-account-control (buyer, fresh)
- **text-opacity** opacity 0.50 — Continue

### /buyer-addresses (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-blocked (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-close-friends (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-download-data (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-drop-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-gift-cards (buyer, fresh)
- **text-opacity** opacity 0.50 — Add
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-highlights-manager (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-login-activity (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-my-sizes (buyer, fresh)
- **text-opacity** opacity 0.50 — XXS
- **text-opacity** opacity 0.50 — XS
- **text-opacity** opacity 0.50 — S
- **text-opacity** opacity 0.50 — M
- **text-opacity** opacity 0.50 — L
- **text-opacity** opacity 0.50 — XL
- **text-opacity** opacity 0.50 — XXL
- **text-opacity** opacity 0.50 — 3XL
- **text-opacity** opacity 0.50 — 26
- **text-opacity** opacity 0.50 — 28
- **text-opacity** opacity 0.50 — 29
- **text-opacity** opacity 0.50 — 30
- **text-opacity** opacity 0.50 — 31
- **text-opacity** opacity 0.50 — 32
- **text-opacity** opacity 0.50 — 33
- **text-opacity** opacity 0.50 — 34
- **text-opacity** opacity 0.50 — 36
- **text-opacity** opacity 0.50 — 38
- **text-opacity** opacity 0.50 — 40
- **text-opacity** opacity 0.50 — 6
- **text-opacity** opacity 0.50 — 7
- **text-opacity** opacity 0.50 — 8
- **text-opacity** opacity 0.50 — 8.5
- **text-opacity** opacity 0.50 — 9
- **text-opacity** opacity 0.50 — 9.5
- **text-opacity** opacity 0.50 — 10
- **text-opacity** opacity 0.50 — 10.5
- **text-opacity** opacity 0.50 — 11
- **text-opacity** opacity 0.50 — 12
- **text-opacity** opacity 0.50 — 13
- **text-opacity** opacity 0.50 — 14

### /buyer-notifications (buyer, fresh)
- **text-opacity** opacity 0.48 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-other-profile (buyer, fresh)
- **text-opacity** opacity 0.50 — Follow <buyer-other-profile>
- **text-opacity** opacity 0.50 —  <buyer-profile-message>
- **text-opacity** opacity 0.50 — Message <buyer-profile-message>
- **text-opacity** opacity 0.50 —  <buyer-other-profile>
- **text-opacity** opacity 0.50 — Stories <buyer-other-profile>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-personal-details (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-post-viewer (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-product-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-report (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-return-request (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search-history (buyer, fresh)
- **text-opacity** opacity 0.40 — Clear all <screen-header>

### /buyer-security (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-settings-detail (buyer, fresh)
- **text-opacity** opacity 0.50 — Sensitive content
- **text-opacity** opacity 0.50 — standard
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.50 — Reset suggested content
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-story-create (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.5) — POST
- **text-faded** color rgba(255, 255, 255, 0.5) — Tap for photo · Hold for video

### /buyer-story-viewer (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /buyer-trending (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /c/col_demo_1 (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /change-phone (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-chat (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-create (buyer, fresh)
- **text-opacity** opacity 0.50 — Open

### /community-join (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /connections (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-details (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-nicknames (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /create-post (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /creator-program (buyer, fresh)
- **text-opacity** opacity 0.45 — Continue

### /customer-accounts (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /customer-privacy (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /delete-account (buyer, fresh)
- **text-opacity** opacity 0.50 — Continue

### /design (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-ai-photoshoot (buyer, fresh)
- **blur** backdrop-filter: saturate(1.8) blur(4.8px) — div

### /design-bg-removal (buyer, fresh)
- **text-scale** scale 1.098×1.098 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.602×0.602 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-bg-replace (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-campaign (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-export (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.7) — –

### /design-garment (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-mockup-to-model (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-templates (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.6) — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /disable-two-factor (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /dispute-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /edit-profile (buyer, fresh)
- **text-opacity** opacity 0.40 — Save <screen-header>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-campaign-compose (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-settings (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /first-run-tips-settings (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /forgot-password (buyer, fresh)
- **text-opacity** opacity 0.50 — Send reset code

### /freelancer-jobs (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fulfill-batch (buyer, fresh)
- **text-opacity** opacity 0.50 — Print labels
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.50 — Mark shipped

### /fulfill-order (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /gift-card-buy (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /giveaway (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /growth-link-new (buyer, fresh)
- **text-opacity** opacity 0.50 — Create link

### /growth-links (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations/shopify-fulfillment (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /invite/DEMO2026 (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /launch-checklist (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /link-in-bio (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-feed (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-replays (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /loyalty (buyer, fresh)
- **text-opacity** opacity 0.50 — Use points in Cart
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer (buyer, fresh) → /manufacturer-hub
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- **text-opacity** opacity 0.80 — 
- **text-opacity** opacity 0.80 — Manufacturer Hub and 7 more tools are available
- **text-opacity** opacity 0.80 — Manufacturer Hub

### /manufacturer-hub (buyer, fresh)
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- **text-opacity** opacity 0.80 — 
- **text-opacity** opacity 0.80 — Manufacturer Hub and 7 more tools are available
- **text-opacity** opacity 0.80 — Manufacturer Hub

### /manufacturer-onboard (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /meta-ads-connect (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /meta-ads-setup (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /mobile-app-builder (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /muted-words (buyer, fresh)
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.17 — Mute
- **text-opacity** opacity 0.50 — spoilers
- **text-opacity** opacity 0.50 — giveaway
- **text-opacity** opacity 0.50 — dm me
- **text-opacity** opacity 0.50 — resell
- **text-opacity** opacity 0.50 — crypto

### /navigation-isolation-probe (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /onboarding (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /orders (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payments (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payouts (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /post-analytics (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /privacy (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-bundles (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-editor (buyer, fresh) → /add-product
- **text-opacity** opacity 0.50 — Save <add-product-save>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-launches (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-pairings (buyer, fresh)
- **text-opacity** opacity 0.50 — Save

### /product-reviews (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-store (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /profile-products (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /push-notifications (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-request (buyer, fresh)
- **text-opacity** opacity 0.50 — Back

### /refund-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /return-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-compare (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-post (buyer, fresh)
- **text-opacity** opacity 0.50 — Send RFQ to manufacturers

### /sales (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /security (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-agreement (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-creator-detail (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-data-export (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drops (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-giveaways (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-inbox (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-push-broadcast (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-questions (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-settings (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-verification (buyer, fresh)
- **text-opacity** opacity 0.48 — 

### /settings (buyer, fresh) → /buyer-settings
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /setup (buyer, fresh)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — div

### /share-store (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shipping-delivery (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shopify-import (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /size-chart-template-apply (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /statements (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-builder (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.7) — Store Builder
- **text-faded** color rgba(255, 255, 255, 0.75) — Every Brandthread store begins with one focused,

### /store-collections (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-editor (buyer, fresh)
- **text-opacity** opacity 0.40 —  <screen-header>
- **text-opacity** opacity 0.40 —  <screen-header>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-from-moodboard (buyer, fresh)
- **text-opacity** opacity 0.50 — Analyze Mood Board
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-from-social (buyer, fresh)
- **text-opacity** opacity 0.50 — Analyze Screenshots

### /store-generate (buyer, fresh)
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-generating (buyer, fresh) → /store-generate
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 

### /store-nav (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-pixels (buyer, fresh)
- **text-opacity** opacity 0.50 — Save

### /store-policies (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-preview-as-buyer (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-settings (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-setup-name (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-theme-picker (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store/northlinestudio (buyer, fresh) → /u/northlinestudio
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /story-mentions (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /tag/streetwear (buyer, fresh) → /hashtag/streetwear
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /team (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /terms (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash (buyer, fresh)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Your balance $0.00 Thread Cash isn't money — it
- **text-faded** color rgba(255, 255, 255, 0.7) — Thread Cash isn't money — it can't be cashed out

### /thread-cash-ledger (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-explainer (buyer, fresh) → /onboarding
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /u/northlinestudio (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /waitlist-demand (buyer, fresh)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
