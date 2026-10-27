# AI image tools: verification

Real outputs from the code in this branch. Nothing in this folder is mocked or hand-made, except where a file says so.

## Remove Background (`bg-removal/`)

- **Engine:** a self-hosted BiRefNet matting model (`birefnet-general-lite`), run by the API server with onnxruntime-node. It needs no keys. The output is the seller's own photo with a predicted alpha matte, so the subject is never redrawn.
- **Inputs:** seeded runway photos and the boots product photo from `artifacts/mobile/assets`.
- **Each `*-sheet.jpg`** shows four panels, left to right: the original, then the cutout on a checkerboard, on white and on black.
- **Each `*-edge.jpg`** is a zoomed hair edge on mid-grey, where halos and lost strands would show.
- **`stats.txt`** gives the alpha breakdown and timing for each photo.

Regenerate with `pnpm --filter @workspace/api-server run verify:ai-image-tools -- --bg`.

The opt-in route test `src/routes/__tests__/bg-removal-remove.real.test.ts` sends a photo through the real `POST /api/bg-removal/remove`. It checks:
- the output size;
- that the background is fully transparent;
- that the subject is solid with a soft edge;
- that deep inside the subject, pixels match the original photo to within 2 levels (no redraw).

## The app at 390×844 (`app/`)

Captured by `artifacts/mobile/scripts/ai-image-tools-verify.mjs`. The web build runs as a signed-in seller, and its `/api/bg-removal/*` and `/api/photography/*` calls go to the **real routers**, served by `artifacts/api-server/scripts/aiImageVerification/serveTools.ts`. Only Clerk sign-in is stubbed.

| File | What it shows |
| --- | --- |
| `bg-01-empty` | Empty state: "Tap to choose a photo", plus a pinned "Choose a photo" button. |
| `bg-02-working-*` | Photo picked; removal started on its own. Silver sheen, twinkling glitter and the scanline while the real model runs (~16 s on this 4-core container). |
| `bg-03-frame-*ms` | The real cutout arrived. The line runs down, and the background breaks into silver glitter over a dark veil, then clears to the checkerboard. At ~2.7–3.3 s, the silver rim glisten around the cutout edge. |
| `bg-05-done` … `bg-09-saved` | Same screen: backdrop swatches, Refine / Share / Use / Save, the Refine brush overlay, and Save, which downloads a PNG. |
| `m2m-01-ready` | Mockup to Model with a mockup and two references. The Create dock sits 34 pt above the bottom, clear of the reference row. |
| `m2m-02-after-create`, `shoot-03-after-generate` | What a seller sees while no image-model key is set. The real API answers 503 `ai_image_engine_not_configured`, and the screens show "AI photos aren't switched on yet. Nothing was charged." with no pointless Retry. |
| `shoot-01-setup`, `shoot-02-options` | AI Photoshoot setup: separate product (4) and reference (6) budgets, Model label, ratio chips. |

## Mockup to Model and AI Photoshoot (`generation/`)

**These were not generated: this environment has no image-model key.** `generation/STATUS.txt` records that. No output was faked.

Once **`GEMINI_API_KEY`** is set on the API server, run:

```
pnpm --filter @workspace/api-server run verify:ai-image-tools -- --generate
```

It writes `mockup-to-model.jpg` and `ai-photoshoot-shot-1.jpg` / `-shot-2.jpg` here. Inputs:
- **Product:** `artifacts/api-server/scripts/aiImageVerification/fixtures/brandthread-logo-tee-mockup.jpg`. This is a flat digital mockup drawn for this test: a black tee with the real Brandthread chrome "B" mark and wordmark, a hard test of logo fidelity.
- **References:** seeded runway photos.
