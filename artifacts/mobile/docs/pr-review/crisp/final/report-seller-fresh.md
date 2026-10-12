# Crisp crawl

369 screens × 1 states (seller-fresh) at 390×844 @3x.

| rule | blocking | findings | screens |
|---|---|---|---|
| text-scale | yes | 4 | 2 |
| text-opacity | yes | 8 | 4 |
| font-fraction | no | 1 | 1 |
| text-faded | no | 3 | 3 |
| smear-shadow | no | 2 | 2 |

## Allowed (by design)

- smear-shadow (seller-global-tab-bar): 945
- blur (seller-global-tab-bar): 945
- blur (glass-over-media): 315

## Findings by screen

### /bg-removal (seller, fresh) → /design-bg-removal
- **text-scale** scale 1.099×1.099 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.601×0.601 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /buyer-account-center (seller, fresh)
- **font-fraction** font-size 11.5px — Security, personal details, permissions and acco <scene-bottom-clearance>

### /buyer-story-viewer (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /design-bg-removal (seller, fresh)
- **text-scale** scale 1.100×1.100 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.25 —  <bg-removal-dropzone>
- **text-scale** scale 0.600×0.600 on <div> —  <bg-removal-dropzone>
- **text-opacity** opacity 0.40 — Remove background <bg-removal-run>

### /design-campaign (seller, fresh)
- **text-opacity** opacity 0.50 —  <stage-continue-btn>
- **text-opacity** opacity 0.50 — Launch · $25 <stage-continue-btn>

### /design-canvas (seller, fresh)
- **text-opacity** opacity 0.35 —  <btn-undo>
- **text-opacity** opacity 0.35 —  <btn-redo>
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.45) 0px 6px 14px 0px — div

### /design-templates (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.6) —  <scene-bottom-clearance>

### /story-mention-viewer (seller, fresh)
- **text-faded** color rgba(255, 255, 255, 0.3) — 

### /thread-cash (seller, fresh)
- **smear-shadow** box-shadow rgba(0, 0, 0, 0.28) 0px 6px 10px 0px — <scene-bottom-clearance>
