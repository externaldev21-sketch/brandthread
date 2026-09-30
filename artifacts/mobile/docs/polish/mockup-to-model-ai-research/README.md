# Mockup to Model — AI provider research & recommendation

Dev's brief: "not half-ass AI... actually high quality... doesn't look too
AI... make sure they're able to save the photos." This doc is the
deliverable for that brief: what the backend uses today, what the
realistic alternatives are, and a recommendation.

## Important limitation, stated up front

**I do not have API credentials for FASHN, Gemini, or OpenAI in this
sandbox**, and this dispatch's instructions are explicit that API keys must
live in server env/secrets only and generation calls must be server-side —
so I cannot (and should not) wire up throwaway client-side credentials to
run a literal side-by-side image generation benchmark myself. What follows
is a **documented-capability comparison** built from each vendor's current
published docs, pricing pages, and independent third-party evaluations
(cited throughout, all fetched during this dispatch), not a hands-on
generation benchmark. The "run these 5 garments through each API"
benchmark Dev asked for is real, valuable work — it needs someone with
provider credentials (or budget to acquire a FASHN API key, which is
inexpensive — see pricing below) to actually execute. I'm recommending
exactly how to run it, and who should own it, at the end of this doc.

## What the backend already does today

`artifacts/api-server/src/routes/photography.ts`'s `/mockup-to-model`
endpoint is **already a real, reasonably sophisticated pipeline**, not a
naive prompt-and-pray call:

- Provider: OpenAI **`gpt-image-1`**, via
  `lib/integrations-openai-ai-server/src/image/client.ts`'s `editImages()`
  (an image-edit call, not text-to-image — it's given both the mockup and
  the reference photo as inputs).
- Prompt: `buildFashionPrompt()` in
  `lib/integrations-openai-ai-server/src/image/prompts.ts` has a dedicated
  `mockup_to_model` standard: *"map the exact supplied garment mockup to a
  believable body without stretching artwork, changing proportions, or
  losing seams, stitching, hems, or material behavior. Keep the requested
  model, scene, lighting, crop, and camera consistent."*
- **Quality gate**: `generateWithVisualQa()`
  (`lib/integrations-openai-ai-server/src/image/quality.ts`) runs every
  result through a second model call (`gpt-4o-mini`, vision) that checks
  *"faithful transfer from mockup to model: silhouette, fit, proportions,
  color, artwork scale and placement, logo and typography legibility,
  distortion, seams, stitching, hems, hardware, fabric hand and drape,
  pose, scene, lighting, crop, and camera treatment"* — and retries or
  rejects (`ImageQualityError`) a result that fails. This is a real,
  non-trivial fidelity check already built specifically for this exact
  "does the logo/print stay exactly right" problem Dev is worried about.

So: this is not "no real AI backend integration exists" — it's a genuine
pipeline with its own QA loop. The question is whether it's the *best*
available pipeline for this specific job, and whether it needs to change
soon regardless.

### This has to change soon either way

**`gpt-image-1` is scheduled for deprecation by OpenAI on October 23,
2026** (per OpenAI's own API pricing/lifecycle pages, cross-referenced
across multiple current pricing trackers). Today is September 30, 2026.
Whatever we decide, the current model needs to move to `gpt-image-1.5` /
`gpt-image-2` or a different provider within the next few weeks regardless
of this PR — that's a real, time-boxed forcing function Dev should know
about.

## Candidates compared

| | **FASHN API** (purpose-built virtual try-on) | **Google Gemini image models** ("Nano Banana" family) | **OpenAI `gpt-image-1`** (current) → `gpt-image-1.5`/`2` |
|---|---|---|---|
| **What it is** | A model trained specifically for garment-on-model compositing (virtual try-on), not a general image editor | General-purpose multimodal image generation/editing (`gemini-3-pro-image` = Nano Banana Pro, `gemini-3.1-flash-image` = Nano Banana 2) | General-purpose image generation/editing |
| **Garment fidelity (documented)** | Independent evaluations (arXiv 2608.29804; ionio.ai's 2026 VTON comparison) find FASHN "class-leading on the virtual try-on task with high garment fidelity and clean output," correctly preserving fine texture (e.g. sequins) other models lose | The same ionio.ai comparison found Nano Banana Pro "holds onto enough of the sparkle to read as sequins" (worse than FASHN on the same test) and, more importantly: *"even when given explicit garment and body size prompts, it produces 'neutral fit' try-on results... fitting fidelity cannot be obtained from language prompts alone."* Also documented: Gemini's safety classifier misflags some legitimate try-on requests (silky/revealing garments) as unsafe, causing outright failures | No independent head-to-head found specifically for garment-on-model fidelity; general-purpose editing models are known to be weaker at preserving exact logos/text/fine print than purpose-built try-on models, which is exactly why this app's own QA-retry loop exists — it's compensating for that gap, not eliminating it |
| **Cost per image** | **$0.075/generation** (v1.5 and v1.6), credit-based, no subscription required; min purchase $7.50/100 credits | Nano Banana Pro: ~$0.13 (1K–2K) to $0.24 (4K); Nano Banana 2: ~$0.045–$0.15; a cheaper "Lite" tier ~$0.034/1K image | `gpt-image-1`: $0.011 (low) / $0.042 (medium) / **$0.167 (high)** per 1024×1024 image. (`gpt-image-1.5`/`2` pricing wasn't separately published yet as of this research — treat this row as the outgoing baseline, not the future number) |
| **Plus our QA-retry pass** | N/A — fidelity is the model's actual job, so a second-pass QA check is far less necessary | Would still need our own QA-retry loop (same problem it has today) | This is what we pay for *today*: generation + a second `gpt-4o-mini` vision call per attempt, so the *effective* cost per accepted result is higher than the sticker price above |
| **Latency** | Try-On Max: ~10s (fast/1K) to ~55s (quality/4K) per FASHN's own docs | Not separately benchmarked here; general-purpose image models are typically in the same ballpark (single-digit to tens of seconds) | Comparable; our own two-call (generate + QA) pipeline adds the QA call's latency on top |
| **Rate limits** | 50 req/60s on `/run`, 6 concurrent predictions (FASHN's published limits) | Governed by standard Gemini API tier limits (not specifically investigated here) | Governed by standard OpenAI tier limits |
| **Integration shape** | Async: POST to `/v1/run`, poll `/v1/status/{id}` — would need a small polling wrapper server-side, unlike our current single-call pattern | Synchronous image API call, closer to a drop-in replacement for the current `editImages()` call shape | Already what we have |

## Recommendation

**Pilot FASHN for this specific tool** (garment-on-model photos), keep
`gpt-image-1.5`/`2` (whichever OpenAI recommends as the `gpt-image-1`
successor) for the *other* AI tools in this dispatch that aren't literally
virtual try-on (AI Design/text-to-design, Campaign Gen, general photoshoot
backgrounds) — this is a "right tool for the job" recommendation, not
"replace the whole AI stack":

1. It's purpose-built for exactly this problem (garment fidelity onto a
   person), and every independent source found says it's currently
   best-in-class at the one thing Dev explicitly complained about
   ("doesn't look too AI," implicitly: doesn't warp the logo/print).
2. It's **cheaper per image** ($0.075) than our *current* high-quality
   `gpt-image-1` call alone ($0.167), before even counting the extra QA
   call we run on top of that today — so this is very plausibly a
   quality *and* cost win simultaneously, not a trade-off.
3. `gpt-image-1` is being retired in ~3 weeks regardless, so a migration
   is mandatory on some timeline either way; better to migrate to the
   right tool than to the same category of tool under a new name.
4. It removes the need for our own QA-retry pass for *this* endpoint
   specifically (garment fidelity is the model's actual training
   objective, not a side effect we're checking for after the fact) —
   likely lowers effective latency and cost further.

**Before shipping this for real money**, per Dev's own ask, someone with
FASHN + current Gemini + OpenAI credentials needs to actually run the 5
garments × 2 references benchmark Dev specified (graphic tee w/ logo, knit
sweater, denim, jacket, dress) and eyeball the real outputs — the research
above is a strong, well-sourced directional signal, not a substitute for
looking at real pixels. I'd scope that as a short, focused follow-up: get
a FASHN API key (cheap, no subscription commitment required), run the 10
test generations against FASHN and against the current `gpt-image-1`
pipeline, and have Dev (or whoever signs off on model quality) pick a
winner before the backend route is actually switched.

## What I did NOT do in this PR

- I did **not** change `artifacts/api-server/src/routes/photography.ts` or
  the OpenAI integration — swapping the production AI provider is a
  backend-owned, credentialed decision that needs the live-benchmark step
  above first, and is out of scope for a mobile-client UI dispatch anyway.
- No fabricated cost-per-photo number was added to the "Create photos"
  button — see the code comment in `app/design-mockup-to-model.tsx` next
  to the button. This is a "needs backend" item: there's currently no
  per-generation cost/credit field returned by `/mockup-to-model`, so
  displaying one would mean inventing a number Dev hasn't approved.

## Sources

- [FASHN API pricing](https://help.fashn.ai/plans-and-pricing/api-pricing) · [FASHN API product page](https://fashn.ai/products/api) · [FASHN rate limits / Try-On Max docs](https://docs.fashn.ai/api-reference/tryon-max)
- [Best Virtual Try-On AI Models Compared (2026) — ionio.ai](https://www.ionio.ai/blog/vton) (garment fidelity / fit-accuracy / safety-filter findings)
- [Dimension-wise Garment Fidelity Assessment — arXiv 2608.29804](https://arxiv.org/pdf/2608.29804)
- [Gemini API pricing (Sep 2026) — developer.puter.com](https://developer.puter.com/tutorials/gemini-api-pricing/) · [Gemini image generation cost calculator — aifreeapi.com](https://www.aifreeapi.com/en/posts/gemini-image-generation-api-pricing)
- [GPT Image 1 pricing breakdown — buildmvpfast.com](https://www.buildmvpfast.com/api-costs/ai-image) · [GPT Image deprecation date — Wikipedia "GPT Image"](https://en.wikipedia.org/wiki/GPT_Image)
