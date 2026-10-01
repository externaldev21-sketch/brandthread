# Remove Background — AI provider research

Same limitation as the Mockup to Model research doc
(`docs/polish/mockup-to-model-ai-research/README.md`): no provider
credentials in this sandbox to run a hands-on side-by-side, so this is a
documented-capability comparison from current published pricing/docs and
independent reviews, cited throughout.

## What the backend already does today

`artifacts/api-server/src/routes/bg-removal.ts`'s `/api/bg-removal/remove`
uses the **same general-purpose OpenAI `gpt-image-1` edit-and-regenerate
pipeline** as Mockup to Model (`editImages`/`generateWithVisualQa`), not a
purpose-built background-removal/matting model.

This matters more here than it might sound: background removal is
fundamentally a **segmentation problem** (classify every pixel as
subject-or-background, keep the subject's pixels exactly as they were) —
not a generation problem. A generative image-edit model doesn't literally
mask out the background; it *repaints* the image against a checkerboard
per the prompt, which risks subtly altering the actual product's pixels
(color, shape, fine detail) even when it "gets it right" — a real fidelity
concern for e-commerce product photos specifically, separate from and in
addition to raw edge quality.

## Purpose-built alternatives

| | **remove.bg** | **Photoroom API** | **Current (gpt-image-1)** |
|---|---|---|---|
| **What it is** | The longest-established purpose-built background-removal/matting API | Purpose-built removal + broader photo-editing API | General-purpose image generation/edit model |
| **Hair/fine-detail edge quality** | Widely cited as still the benchmark for "nightmare" edge cases — frizzy hair, fur, semi-transparent fabric | Strong (~9/10 in the same 2026 comparison), slightly behind remove.bg specifically on wispy hair against busy backgrounds | Not a matting model — no independent hair/fur edge-quality benchmark exists because that's not what it's built to do; the product's own `generateWithVisualQa` pass exists specifically to catch cases where it alters something it shouldn't |
| **Fidelity to the original product pixels** | True alpha-matte segmentation — background pixels are removed, subject pixels are untouched | Same segmentation approach | Full regeneration — the "subject" is redrawn, not preserved pixel-for-pixel |
| **Cost per image** | ~$0.105–$0.20/image at low volume, down to ~$0.178 at higher volume tiers (pricing varies by plan/volume) | Not directly priced in this research pass — comparable purpose-built tier | `gpt-image-1`: $0.042 (medium) – $0.167 (high) per image, **plus** a second `gpt-4o-mini` vision call for the quality-check pass on top of that |
| **Speed** | Purpose-built matting models are typically sub-second to a few seconds per image — much faster than a two-pass generate+verify LLM pipeline | Similarly fast | Slower: one image-generation call + one vision-QA call, sequentially, per attempt |

## Recommendation

**Switch this specific endpoint to a purpose-built segmentation API**
(remove.bg or Photoroom's API — a final pick needs a real side-by-side on
actual seller photos, same caveat as the Mockup to Model doc) instead of
routing background removal through the general image-generation pipeline.
Reasoning:

1. It's the right tool for the job — segmentation, not generation — which
   directly addresses Dev's "not half-ass, doesn't look too AI" bar in the
   way that matters most for background removal specifically: the
   product's actual pixels stay untouched instead of being regenerated.
2. It removes the need for the `generateWithVisualQa` safety-net pass on
   this endpoint (the pass exists to catch generative drift, which a real
   matting model doesn't have in the first place) — likely faster *and*
   cheaper in practice once you count that second call.
3. `gpt-image-1` itself is being deprecated October 23, 2026 (see the
   Mockup to Model doc) — another reason this endpoint needs to move
   regardless of which way it moves.

## What I did NOT do in this PR

Did not touch `artifacts/api-server/src/routes/bg-removal.ts` — swapping
the provider is a backend-owned, credentialed decision (same reasoning as
Mockup to Model's research doc), and this dispatch is scoped to the mobile
client. Flagging the recommendation here for whoever owns that route.

## Sources

- [remove.bg API pricing comparison — dev.to](https://dev.to/om_prakash_3311f8a4576605/removebg-charges-0105image-heres-a-0009-alternative-2026-comparison-59hi) · [Background Removal Pricing 2026 — clippingworld.com](https://www.clippingworld.com/background-removal-service-pricing/)
- [Best Background Removal APIs 2026 — banuba.com](https://www.banuba.com/blog/best-background-removal-apis-developer-comparison) · [Top 6 background remover APIs (tested) — runflow.io](https://www.runflow.io/blog/best-background-remover-api)
