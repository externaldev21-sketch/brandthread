# Crisp crawl

369 screens × 1 states (buyer-demo) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| text-opacity | yes | 16 | 6 |
| text-subpixel | no | 1 | 1 |
| text-scale | yes | 6 | 3 |
| font-fraction | no | 12 | 5 |
| text-faded | no | 3 | 3 |
| image-upscaled | yes | 1 | 1 |
| smear-shadow | no | 1 | 1 |

## Allowed (by design)

- smear-shadow (buyer-bottom-tab-bar): 40
- blur (buyer-bottom-tab-bar): 40
- blur (glass-over-media): 27
- text-scale (buyer-bottom-tab-bar): 20

## Findings by screen

### / (buyer, demo)
- **text-opacity** opacity 0.90 —  <feed-gesture-guide>
- **text-subpixel** translate 0.00,2.65 on <div> —  <feed-gesture-guide>
- **text-scale** scale 0.995×0.995 on <div> —  <feed-gesture-guide>
- **text-opacity** opacity 0.50 —  <feed-gesture-guide>
- **text-scale** scale 0.970×0.970 on <div> — 2x <feed-gesture-guide>

### /(buyer)/edit-profile (buyer, demo) → /edit-profile
- **font-fraction** font-size 36.48px — ?
- **font-fraction** font-size 12.5px — Up to 25 seconds. Plays muted on a loop behind y
- **font-fraction** font-size 13.5px — Add
- **font-fraction** font-size 12.5px — Shown next to your name on your profile.

### /bg-removal (buyer, demo) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /buyer-account-center (buyer, demo)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco

### /buyer-notifications (buyer, demo)
- **text-opacity** opacity 0.48 — 

### /buyer-story-viewer (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /design-bg-removal (buyer, demo)
- **text-scale** scale 1.100×1.100 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.600×0.600 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-templates (buyer, demo)
- **text-faded** color rgba(255, 255, 255, 0.6) — 

### /live (buyer, demo)
- **image-upscaled** 1080×1920 source painted at 1170×2532 device px (1.32×) http://127.0.0.1:38113/assets/assets/videos/fashion_runway_01.959b2c27c7e9e40b44 — <live-page-preview-live-01>
- **text-faded** color rgba(255, 255, 255, 0.8) —  <live-host-identity>
- **text-opacity** opacity 0.28 — ava_in_black obsessed with the Sculpted Wool Coa <live-chat>
- **text-opacity** opacity 0.28 — ava_in_black <live-chat>
- **text-opacity** opacity 0.50 — kaito what size is the model wearing? <live-chat>
- **text-opacity** opacity 0.50 — kaito <live-chat>
- **text-opacity** opacity 0.70 — jun_archive does it run true to size? <live-chat>
- **text-opacity** opacity 0.70 — jun_archive <live-chat>
- **text-opacity** opacity 0.88 — 🛍️ lune.studio just bought the Sculpted Wool Co <live-chat>
- **text-opacity** opacity 0.88 — lune.studio <live-chat>
- error: Failed to load because no supported source was found.

### /live-cohost (buyer, demo)
- **font-fraction** font-size 15.2px — RS
- **font-fraction** font-size 15.2px — AN
- **font-fraction** font-size 15.2px — L&
- **font-fraction** font-size 15.2px — SC

### /live-cohost-invite (buyer, demo)
- **font-fraction** font-size 15.2px — AN

### /live-moderation (buyer, demo)
- **font-fraction** font-size 15.2px — ML
- **font-fraction** font-size 15.2px — JR

### /seller-verification (buyer, demo)
- **text-opacity** opacity 0.48 — 

### /thread-cash (buyer, demo)
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.28) 0px 6px 10px 0px — div
