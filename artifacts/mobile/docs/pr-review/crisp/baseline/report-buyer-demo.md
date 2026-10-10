# Crisp crawl

369 screens × 1 states (buyer-demo) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| blur | yes | 9 | 3 |
| text-opacity | yes | 102 | 37 |
| text-subpixel | no | 1 | 1 |
| text-scale | yes | 6 | 3 |
| font-fraction | no | 12 | 5 |
| text-faded | no | 12 | 7 |
| image-upscaled | yes | 1 | 1 |
| smear-shadow | no | 2 | 2 |

## Allowed (by design)

- smear-shadow (buyer-bottom-tab-bar): 40
- blur (buyer-bottom-tab-bar): 60
- text-scale (buyer-bottom-tab-bar): 20

## Findings by screen

### / (buyer, demo)
- **blur** backdrop-filter: saturate(1.8) blur(12px) — <feed-gesture-guide>
- **text-opacity** opacity 0.99 —  <feed-gesture-guide>
- **text-subpixel** translate 0.00,4.22 on <div> —  <feed-gesture-guide>
- **text-scale** scale 0.904×0.904 on <div> —  <feed-gesture-guide>
- **text-opacity** opacity 0.40 —  <feed-gesture-guide>
- **text-scale** scale 0.937×0.937 on <div> — 2x <feed-gesture-guide>

### /(buyer) (buyer, demo) → /
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/cart (buyer, demo) → /cart
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/discover-feed (buyer, demo) → /discover-feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/edit-profile (buyer, demo) → /edit-profile
- **text-opacity** opacity 0.35 — Save <screen-header>
- **font-fraction** font-size 36.48px — ?
- **font-fraction** font-size 12.5px — Up to 25 seconds. Plays muted on a loop behind y
- **font-fraction** font-size 13.5px — Add
- **font-fraction** font-size 12.5px — Shown next to your name on your profile.

### /(buyer)/feed (buyer, demo) → /feed
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/friends (buyer, demo) → /friends
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(buyer)/profile (buyer, demo) → /profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/analytics (buyer, demo) → /(buyer)/analytics
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/following (buyer, demo) → /following
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/more (buyer, demo) → /(buyer)/more
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /(tabs)/profile (buyer, demo) → /profile
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /account-type (buyer, demo) → /onboarding
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /activity-people (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /add-product (buyer, demo)
- **text-opacity** opacity 0.50 — Save <add-product-save>

### /ai-assistant (buyer, demo) → /ai-brain
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-brand-memory (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ai-helper (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-audience (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-content (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-export (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-marketing (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-products (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /analytics-sales (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /app-icon (buyer, demo) → /appearance
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /automation (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /bg-removal (buyer, demo) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /biometric-unlock (buyer, demo)
- **text-opacity** opacity 0.50 — Require Biometrics
- **text-opacity** opacity 0.50 — Off

### /boost (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-account-center (buyer, demo)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-account-control (buyer, demo)
- **text-opacity** opacity 0.50 — Continue

### /buyer-addresses (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-category (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-collection (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-download-data (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-drop-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-gift-cards (buyer, demo)
- **text-opacity** opacity 0.50 — Add
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-invite (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-login-activity (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-my-sizes (buyer, demo)
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

### /buyer-notifications (buyer, demo)
- **text-opacity** opacity 0.48 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-other-profile (buyer, demo)
- **text-opacity** opacity 0.50 — Follow <buyer-other-profile>
- **text-opacity** opacity 0.50 —  <buyer-profile-message>
- **text-opacity** opacity 0.50 — Message <buyer-profile-message>
- **text-opacity** opacity 0.50 —  <buyer-other-profile>
- **text-opacity** opacity 0.50 — Stories <buyer-other-profile>

### /buyer-payment-methods (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-post-viewer (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-problem-report (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-report (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-saved (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-search-history (buyer, demo)
- **text-opacity** opacity 0.40 — Clear all <screen-header>

### /buyer-security (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-settings-detail (buyer, demo)
- **text-opacity** opacity 0.50 — Sensitive content
- **text-opacity** opacity 0.50 — standard
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.50 — Reset suggested content

### /buyer-settings-menu (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-story-create (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.5) — POST
- **text-faded** color rgba(255, 255, 255, 0.5) — Tap for photo · Hold for video

### /buyer-story-viewer (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /buyer-your-activity (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /camera-capture (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-chat (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /community-create (buyer, demo)
- **text-opacity** opacity 0.50 — Open

### /community-members (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-details (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /conversation-privacy-safety (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /create-post (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /creator-program (buyer, demo)
- **text-opacity** opacity 0.45 — Continue

### /creator-program-join (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /customer-privacy (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /delete-account (buyer, demo)
- **text-opacity** opacity 0.50 — Continue

### /design (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-ai-photoshoot (buyer, demo)
- **blur** backdrop-filter: saturate(1.8) blur(4.8px) — div

### /design-bg-removal (buyer, demo)
- **text-scale** scale 1.100×1.100 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.600×0.600 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-export (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.7) — –

### /design-garment (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-project (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /design-templates (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.6) — 

### /design-text-to-design (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /disable-two-factor (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /dispute-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /drafts (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /edit-profile (buyer, demo)
- **text-opacity** opacity 0.40 — Save <screen-header>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-campaign-compose (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /email-campaigns (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fees (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /first-run-tips-settings (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /forgot-password (buyer, demo)
- **text-opacity** opacity 0.50 — Send reset code

### /freelancer-jobs (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /fulfill-batch (buyer, demo)
- **text-opacity** opacity 0.50 — Print labels
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.50 — Mark shipped
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /general-settings (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /gift-cards-manage (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /growth-link-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /growth-link-new (buyer, demo)
- **text-opacity** opacity 0.50 — Create link

### /growth-links (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /help (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /integrations/klaviyo (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /invite-manufacturer (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /ip-report (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /launch-publish (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /link-in-bio-stats (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live (buyer, demo)
- **image-upscaled** 1080×1920 source painted at 1170×2532 device px (1.32×) http://127.0.0.1:45947/assets/assets/videos/fashion_runway_01.959b2c27c7e9e40b44 — <live-page-preview-live-01>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-host-identity>
- **text-faded** color rgba(255, 255, 255, 0.8) —  <live-host-identity>
- **text-faded** color rgba(255, 255, 255, 0.85) — 2.4K <live-viewer-count>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-follow>
- **text-faded** color rgba(255, 255, 255, 0.9) — Midnight tailoring — coat fittings <live-page-preview-live-01>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-sound>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-like>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-bag>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-share>
- **text-opacity** opacity 0.28 — ava_in_black obsessed with the Sculpted Wool Coa <live-chat>
- **text-opacity** opacity 0.28 — ava_in_black <live-chat>
- **text-opacity** opacity 0.50 — kaito what size is the model wearing? <live-chat>
- **text-opacity** opacity 0.50 — kaito <live-chat>
- **text-opacity** opacity 0.70 — jun_archive does it run true to size? <live-chat>
- **text-opacity** opacity 0.70 — jun_archive <live-chat>
- **blur** backdrop-filter: blur(22px) saturate(1.6) — <live-chat>
- **text-opacity** opacity 0.88 — 🛍️ lune.studio just bought the Sculpted Wool Co <live-chat>
- **text-faded** color rgba(255, 255, 255, 0.9) — 🛍️ lune.studio just bought the Sculpted Wool Co <live-chat>
- **text-opacity** opacity 0.88 — lune.studio <live-chat>
- error: Failed to load because no supported source was found.
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-cohost (buyer, demo)
- **font-fraction** font-size 15.2px — RS
- **font-fraction** font-size 15.2px — AN
- **font-fraction** font-size 15.2px — L&
- **font-fraction** font-size 15.2px — SC

### /live-cohost-invite (buyer, demo)
- **font-fraction** font-size 15.2px — AN
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-moderation (buyer, demo)
- **text-opacity** opacity 0.50 — Add
- **font-fraction** font-size 15.2px — ML
- **font-fraction** font-size 15.2px — JR
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /live-replays (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /login-activity (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /loyalty (buyer, demo)
- **text-opacity** opacity 0.50 — Use points in Cart

### /manufacturer (buyer, demo) → /manufacturer-hub
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- **text-opacity** opacity 0.80 — 
- **text-opacity** opacity 0.80 — Manufacturer Hub and 7 more tools are available
- **text-opacity** opacity 0.80 — Manufacturer Hub
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-hub (buyer, demo)
- **text-opacity** opacity 0.90 — Broadcast one request to up to 10 manufacturers <button-post-rfq>
- **text-opacity** opacity 0.80 — 
- **text-opacity** opacity 0.80 — Manufacturer Hub and 7 more tools are available
- **text-opacity** opacity 0.80 — Manufacturer Hub

### /manufacturer-messages (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /manufacturer-profile (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /meta-ads-setup (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /muted-words (buyer, demo)
- **text-opacity** opacity 0.50 — 
- **text-opacity** opacity 0.17 — Mute
- **text-opacity** opacity 0.50 — spoilers
- **text-opacity** opacity 0.50 — giveaway
- **text-opacity** opacity 0.50 — dm me
- **text-opacity** opacity 0.50 — resell
- **text-opacity** opacity 0.50 — crypto
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /notification-channels (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /onboarding (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /orders (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payments (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /payout-setup (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /place/demo-place (buyer, demo) → /location/demo-place
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /post-analytics (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /privacy (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-bundles (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-editor (buyer, demo) → /add-product
- **text-opacity** opacity 0.50 — Save <add-product-save>
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-launches (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-pairings (buyer, demo)
- **text-opacity** opacity 0.50 — Save

### /product-reviews (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-size-chart (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /product-video (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /profile-products (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /push-notifications (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /quote-request (buyer, demo)
- **text-opacity** opacity 0.50 — Back

### /refund-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /return-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-list (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /rfq-post (buyer, demo)
- **text-opacity** opacity 0.50 — Send RFQ to manufacturers

### /sample-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-activity (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-creator-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-data-export (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-drops (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-giveaway-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-inbox (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-push-broadcast-results (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-schedule-live (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /seller-verification (buyer, demo)
- **text-opacity** opacity 0.48 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /setup (buyer, demo)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — div
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shipping (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shipping-label (buyer, demo) → /orders
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /shopping-preferences (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /size-chart-template-edit (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /statements (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-builder (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.7) — Store Builder
- **text-faded** color rgba(255, 255, 255, 0.75) — Every Brandthread store begins with one focused,
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-domain (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-editor (buyer, demo)
- **text-opacity** opacity 0.40 —  <screen-header>
- **text-opacity** opacity 0.40 —  <screen-header>

### /store-from-moodboard (buyer, demo)
- **text-opacity** opacity 0.50 — Analyze Mood Board
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-from-social (buyer, demo)
- **text-opacity** opacity 0.50 — Analyze Screenshots

### /store-generate (buyer, demo)
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 

### /store-generating (buyer, demo) → /store-generate
- **text-opacity** opacity 0.50 — Continue
- **text-opacity** opacity 0.50 — 
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-pages (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-pixels (buyer, demo)
- **text-opacity** opacity 0.50 — Save

### /store-policies (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-publish (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-seo (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-setup-brand (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-setup-socials (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /store-versions (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /story-mention-viewer (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /subscription (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /team (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /tech-pack-generator (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-cash (buyer, demo)
- **smear-shadow** box-shadow rgba(255, 255, 255, 0.4) 0px 4px 16px 0px — Your balance $0.00 Thread Cash isn't money — it
- **text-faded** color rgba(255, 255, 255, 0.7) — Thread Cash isn't money — it can't be cashed out

### /thread-checkout (buyer, demo) → /
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /thread-product-detail (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /users (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js

### /waitlist-demand (buyer, demo)
- error: Clerk: Failed to load Clerk JS, failed to load script: https://clerk.brandthread.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js
