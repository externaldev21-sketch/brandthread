# Crisp crawl

369 screens × 1 states (seller-demo) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| text-scale | yes | 4 | 2 |
| text-opacity | yes | 8 | 4 |
| font-fraction | no | 8 | 4 |
| text-faded | no | 3 | 3 |
| smear-shadow | no | 2 | 2 |

## Allowed (by design)

- smear-shadow (seller-global-tab-bar): 945
- blur (seller-global-tab-bar): 945
- blur (glass-over-media): 315

## Findings by screen

### /bg-removal (seller, demo) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /buyer-account-center (seller, demo)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco <scene-bottom-clearance>

### /buyer-story-viewer (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /design-bg-removal (seller, demo)
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-campaign (seller, demo)
- **text-opacity** opacity 0.50 —  <stage-continue-btn>
- **text-opacity** opacity 0.50 — Launch · $25 <stage-continue-btn>

### /design-canvas (seller, demo)
- **text-opacity** opacity 0.35 —  <btn-undo>
- **text-opacity** opacity 0.35 —  <btn-redo>
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.45) 0px 6px 14px 0px — div

### /design-templates (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.6) —  <scene-bottom-clearance>

### /live-cohost (seller, demo)
- **font-fraction** font-size 15.2px — RS
- **font-fraction** font-size 15.2px — AN
- **font-fraction** font-size 15.2px — L&
- **font-fraction** font-size 15.2px — SC

### /live-cohost-invite (seller, demo)
- **font-fraction** font-size 15.2px — AN

### /live-moderation (seller, demo)
- **font-fraction** font-size 15.2px — ML
- **font-fraction** font-size 15.2px — JR

### /story-mention-viewer (seller, demo)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /thread-cash (seller, demo)
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.28) 0px 6px 10px 0px — <scene-bottom-clearance>
