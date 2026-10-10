# Crisp crawl

369 screens × 1 states (buyer-fresh) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| text-opacity | yes | 8 | 5 |
| text-subpixel | no | 1 | 1 |
| text-scale | yes | 6 | 3 |
| font-fraction | no | 5 | 2 |
| text-faded | no | 2 | 2 |
| smear-shadow | no | 1 | 1 |

## Allowed (by design)

- smear-shadow (buyer-bottom-tab-bar): 40
- blur (buyer-bottom-tab-bar): 40
- blur (glass-over-media): 20

## Findings by screen

### / (buyer, fresh)
- **text-opacity** opacity 0.94 —  <feed-gesture-guide>
- **text-subpixel** translate 0.00,3.21 on <div> —  <feed-gesture-guide>
- **text-scale** scale 0.962×0.962 on <div> —  <feed-gesture-guide>
- **text-opacity** opacity 0.46 —  <feed-gesture-guide>
- **text-scale** scale 0.958×0.958 on <div> — 2x <feed-gesture-guide>

### /(buyer)/edit-profile (buyer, fresh) → /edit-profile
- **font-fraction** font-size 36.48px — ?
- **font-fraction** font-size 12.5px — Up to 25 seconds. Plays muted on a loop behind y
- **font-fraction** font-size 13.5px — Add
- **font-fraction** font-size 12.5px — Shown next to your name on your profile.

### /bg-removal (buyer, fresh) → /design-bg-removal
- **text-scale** scale 1.100×1.100 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.600×0.600 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /buyer-account-center (buyer, fresh)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco

### /buyer-notifications (buyer, fresh)
- **text-opacity** opacity 0.47 — 

### /buyer-story-viewer (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /design-bg-removal (buyer, fresh)
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-templates (buyer, fresh)
- **text-faded** color rgba(255, 255, 255, 0.6) — 

### /seller-verification (buyer, fresh)
- **text-opacity** opacity 0.48 — 

### /thread-cash (buyer, fresh)
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.28) 0px 6px 10px 0px — div
