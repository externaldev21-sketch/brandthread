# AI image-provider benchmark — infrastructure + fal.ai research (extends #555 / #559)

PR #555 (Mockup to Model) and PR #559 (AI Photoshoot) each shipped a
literature-based provider comparison with an explicit caveat: no provider
credentials existed in either sandbox to run a real, hands-on benchmark.
Dev has since asked for more rigor. This PR does the part that doesn't
need credentials — routing through fal.ai as an aggregator, an actual
provider interface, both pipelines, a benchmark runner, and a contact-sheet
generator — and is written so the real benchmark is a single command the
moment Dev's FASHN/fal.ai accounts exist. **No live benchmark was run.**
Anything below presented as a live result is explicitly labeled MOCK.

## fal.ai as an aggregator — what's actually there

Confirmed via fal.ai's own model pages and blog as of this research pass
(sources below), fal.ai currently hosts all four models this research
needs behind one `FAL_KEY`:

| Model (fal.ai listing) | Role | Notes |
|---|---|---|
| **FASHN v1.6** (`fal-ai/fashn/tryon/v1.6`) | garment-fidelity | Same model as calling FASHN directly; fal.ai's own comparison names it one of the three best 2026 virtual try-on APIs, alongside Kling and FLUX Virtual Try-On Pro. Renders logo/print text accurately per fal's own product page. |
| **Kling Kolors v1.5** (`fal-ai/kling/v1-5/kolors-virtual-try-on` — slug to confirm at integration time) | garment-fidelity | Documented to hold pose, skin tone, and body shape through the composite — second garment-fidelity candidate to benchmark against FASHN, not just a fallback. |
| **Nano Banana / Nano Banana Pro** (`fal-ai/nano-banana-pro/edit` — slug to confirm) | creative-scene | Google's Gemini 2.5 Flash Image Edit / Gemini 3 Pro Image, publicly available on fal. Nano Banana Pro adds up to 4K output and better text rendering. Per PR #555's research, it produces "neutral fit" try-on results when asked to do garment fidelity directly — this is why it's slotted here as a **stage-1 creative-scene** provider in the two-stage pipeline, not a garment-fidelity one. |
| **Qwen Image (edit)** (`fal-ai/qwen-image-edit` — slug to confirm) | creative-scene | General-purpose editor, cheapest of the four; a lower-cost stage-1 alternative to Nano Banana when creative polish matters less than cost. |

Exact fal model slugs move as fal repaves its catalog; `getFalModelSlug()`
in `artifacts/api-server/src/lib/aiImageProviders/config.ts` reads an env
override per model (`FAL_MODEL_SLUG_FAL_FASHN`, etc.) so confirming/pinning
the current slug at integration time is a config change, not a code
change. **Action for whoever runs the real benchmark**: open each model's
fal.ai page, copy the exact slug and required input field names, and set
the override env var if it differs from the default coded here.

Direct FASHN (`FASHN_API_KEY`, `fashn-direct` provider) is kept as an
alternate path in case a FASHN release isn't live on fal.ai's wrapper yet,
per the task brief.

## The two pipelines

- **Pipeline A — single-stage**: one garment-fidelity provider call
  directly on the reference photo. What production runs today (OpenAI).
  Cheapest and fastest; risks asking one model to be both creative
  (match an exotic reference) and exacting (preserve the product) at once.
- **Pipeline B — two-stage**: a creative-scene provider (OpenAI/Nano
  Banana/Qwen) generates the scene/model/pose matching the reference
  first; a garment-fidelity provider (FASHN/Kling) then composites the
  real product onto that scene. Two calls, more cost and latency, but
  separates "be creative" from "don't touch the product."

Both are implemented as real, callable code —
`artifacts/api-server/src/lib/aiImageProviders/pipelines.ts`
(`runSingleStage`, `runTwoStage`) — not pseudocode. `runBenchmark.ts` runs
every garment-fidelity provider through pipeline A, and every
(creative-scene, garment-fidelity) pair through pipeline B, so a serious
candidate provider is tested in both roles it's plausible for, not just
pipeline A.

## Provider interface — pick a winner per tool via config, no code change

`artifacts/api-server/src/lib/aiImageProviders/`:

- `types.ts` — `ImageProvider`, `GenerationInput/Result`, `ProviderId`, `PipelineId`.
- `config.ts` — `getToolProviderConfig('mockup-to-model' | 'ai-photoshoot')`
  reads `AI_IMAGE_<TOOL>_PIPELINE` / `_PROVIDER` / `_SCENE_PROVIDER` env
  vars, defaulting to today's production behavior (`openai` /
  `single-stage`) so importing this module changes nothing until a route
  opts in. Mockup to Model and AI Photoshoot can land on different
  providers — Photoshoot's exotic-reference case is explicitly the harder
  one, so nothing here assumes they converge.
- `providers/openai.ts`, `providers/fashnDirect.ts`, `providers/fal.ts` —
  one `ImageProvider` implementation each; `fal.ts` covers all four fal
  models via one HTTP call shape, parameterized by slug.
- **Not wired into `routes/photography.ts`** — swapping the live
  production provider is a credentialed, tested decision per both
  #555/#559's explicit scope calls; this PR ships the infrastructure to
  make that swap a config change once a real benchmark picks a winner.

## Benchmark runner + contact sheet

`artifacts/api-server/scripts/aiProviderBenchmark/`:

- `matrix.ts` — the 5 garments (logo tee w/ logo, knit sweater, denim,
  jacket, dress) × 3 reference styles (studio-clean, street-at-night,
  exotic-location) = 15 cases, each with a garment-preservation prompt.
- `runBenchmark.ts` — the real, reusable script. Checks for fixture images
  first and tells you exactly which are missing rather than failing
  silently or faking data; runs pipeline A for each configured
  garment-fidelity provider and pipeline B for each scene×garment pair;
  writes every output PNG plus a `results.json` (provider, pipeline, cost,
  latency, ok/error) to a timestamped folder.
- `contactSheet.ts` — turns `results.json` + images into one static HTML
  grid, labeled provider/pipeline/test-case/cost/latency per tile, split
  into a Pipeline A section and a Pipeline B section — the actual artifact
  Dev scans by eye.

### Exact command to run once Dev's FASHN/fal.ai keys exist

```bash
# 1. Set whichever of these exist in the api-server's env:
#      FASHN_API_KEY=...
#      FAL_KEY=...
#      (OpenAI: the existing AI_INTEGRATIONS_OPENAI_* vars already used in prod)
# 2. Drop 8 fixture files (see scripts/aiProviderBenchmark/fixtures/README.md)
# 3. Run:
pnpm --filter @workspace/api-server exec tsx ./scripts/aiProviderBenchmark/runBenchmark.ts
# or: pnpm --filter @workspace/api-server run benchmark:ai-providers
```

This produces `scripts/aiProviderBenchmark/results/<timestamp>/contact-sheet.html`
— open it directly in a browser.

### Proof the wiring is correct today, without any keys

```bash
pnpm --filter @workspace/api-server run benchmark:ai-providers:mock
```

A saved copy of that mock run's contact sheet (placeholder images, clearly
badged `MOCK` on every tile) is committed at
`docs/polish/ai-provider-benchmark/sample-mock-contact-sheet/contact-sheet.html`
— proof the runner, both pipelines, cost/latency aggregation, and the
contact-sheet layout all work end-to-end today. **Every value in it is
fabricated placeholder data for wiring verification only — it is not a
quality or cost signal for any real provider.**

## gpt-image-1 retirement — successor confirmed

PR #555 flagged `gpt-image-1` retiring Oct 23, 2026 without a confirmed
successor name. Confirmed this pass: OpenAI's replacement line is
**`gpt-image-2.5`**, shipped Sept 8, 2026, in two variants — `-flare`
(faster) and `-sunburst` (more detailed). `providers/openai.ts` here
defaults to `gpt-image-2.5-flare` (overridable via `OPENAI_IMAGE_MODEL`)
rather than hardcoding `gpt-image-1` — new code should not be written
against a model retiring in three weeks. **This PR does not touch the
production route's own `gpt-image-1` call in
`@workspace/integrations-openai-ai-server`** — that migration is a
one-line model-string change in that package once its owner signs off,
tracked separately from this research/infra PR.

## Scoring criteria for the real run

Once real results exist, score each cell on:

1. **Garment fidelity** — logo/print/text/colour exact, zero hallucination.
2. **Realism** — "doesn't look AI": hands, faces, skin.
3. **Reference match** — does the output actually match the reference's
   scene/pose/lighting, not just "a nice photo."
4. **Cost per image** (from `results.json`).
5. **Latency** (from `results.json`).

`contactSheet.ts` already surfaces cost/latency per tile; fidelity,
realism, and reference-match are eyeball judgments the contact sheet is
laid out to make fast (same case, all providers/pipelines, side by side).

## Sources

- [10 Best Virtual Try-On APIs in 2026 — fal.ai](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026)
- [FASHN v1.6 on fal.ai](https://fal.ai/models/fal-ai/fashn/tryon/v1.6/examples)
- [Nano Banana Pro on fal.ai](https://fal.ai/nano-banana-pro)
- [Introducing Gemini 2.5 Flash Image Edit aka "nano-banana" — fal.ai blog](https://blog.fal.ai/introducing-gemini-2-5-flash-image-edit-aka-nano-banana/)
- [10 Best Image Editing Tools & Models In 2026 — fal.ai](https://fal.ai/learn/tools/ai-image-editing-tools)
- [Best Virtual Try-On AI Models Compared (2026): CatVTON vs Kling vs FASHN vs Qwen vs Nano Banana — ionio.ai](https://www.ionio.ai/blog/vton)
- [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations) — gpt-image-1 shutdown Oct 23, 2026, replacement gpt-image-2.5-sunburst/flare
- Reuses/extends the FASHN/Gemini/gpt-image-1 comparisons already cited in
  `docs/polish/mockup-to-model-ai-research/README.md` (PR #555) and
  `docs/polish/ai-photoshoot-ai-research/README.md` (PR #559).
