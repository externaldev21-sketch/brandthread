# AI Photoshoot — AI quality research (extends Mockup to Model's)

Same sandbox limitation as the other two research docs in this dispatch
(Mockup to Model, Remove Background): no provider credentials here to run
a literal side-by-side, so this extends that research with the harder
question Dev specifically raised — creative, exotic reference photos
(unusual locations, dramatic lighting, multiple people, props, film-look
grading, dynamic poses) combined with a real product that must render with
zero hallucination — via documented pipeline research, not a hands-on
benchmark.

## What this screen calls today

`generatePhotoshootShot()` (new, in `services/designService.ts`) sends the
product photo(s) + any creative reference photos straight into
`/api/photography/generate` as a single `images[]` array with a text
prompt — the same single-stage `gpt-image-1` `editImages()` call used
elsewhere in this app. One model call has to simultaneously: interpret an
exotic creative reference, build a matching scene/model/pose/lighting, AND
preserve the real product's logo/print/color/texture exactly. That's a lot
to ask of one generation pass, and it's exactly where single-stage
pipelines are documented to struggle — scene/creativity and product
fidelity pull the model in two directions in the same pass.

## Single-stage vs. two-stage: what the research says

Industry practice for this exact harder case (creative/exotic reference +
must-not-hallucinate product) is converging on a **two-stage pipeline**,
not one call:

1. **Stage 1 — scene/model generation**: generate the model, pose, scene,
   lighting matching the creative reference, without the real product in
   frame yet (or with a rough placeholder). This is the "creative"
   half — a general model has more freedom to be genuinely creative here
   since there's no product fidelity constraint yet.
2. **Stage 2 — garment-accurate compositing**: composite/try-on the real
   product onto the stage-1 scene, using a fidelity-first approach (the
   same category of purpose-built compositing this dispatch's Mockup to
   Model research recommended — e.g. FASHN — rather than a second
   from-scratch generation). This stage's whole job is "don't change the
   product," which is a narrower, better-suited task for a purpose-built
   model than for a general one.
3. **Optional upscale pass**: generate at a lower/faster resolution through
   stages 1–2, then upscale only the shots the seller actually keeps,
   instead of paying full-resolution generation cost on every candidate.

This is a documented, real pattern (cited below) — not something I
invented for this doc — and it directly matches the concern Dev raised:
splitting "be creative" from "don't touch the product" into two passes
lets each stage actually be good at its one job, instead of one model
trying to do both and compromising on both when the reference gets
unusual.

## Recommendation

1. **Short term (no backend change)**: keep the current single-stage call
   for now — it's real, it works for straightforward references, and
   changing it is a backend-owned decision requiring credentialed testing
   (see "What I did NOT do" below).
2. **Recommended next step**: pilot the two-stage approach specifically
   for this tool — stage 1 on a general creative model (current
   `gpt-image-1`/successor, or a Gemini "Nano Banana" model per the
   Mockup to Model doc's comparison), stage 2 on a purpose-built
   compositing model (FASHN, same recommendation as Mockup to Model,
   since AI Photoshoot's garment-preservation requirement is the same
   underlying problem as mockup-to-model's). If Mockup to Model's FASHN
   pilot (recommended in that doc) validates well, this tool is the
   natural second adopter — same compositing stage, reused, not a new
   integration.
3. Before charging anything per-shot for this specific tool, run the real
   benchmark Dev asked for — exotic references × real products, both
   pipelines — since this is explicitly the harder, "don't push out slop"
   case Dev is most worried about.

## What I did NOT do in this PR

- Did not build a two-stage pipeline in this PR — it needs backend
  work (a second model/provider call, orchestration, and its own
  credentialed benchmark) beyond this mobile-client dispatch's scope.
  The client's `generatePhotoshootShot()` is written so that swapping
  the underlying call for a two-stage one later is a service-layer
  change, not a screen rewrite.
- Did not fabricate a per-shot cost — see the code comment next to the
  "Generate" button in `app/design-ai-photoshoot.tsx`.

## Sources

- [AI Product Photography in 2026: Tools, Prompts, and a Working Pipeline — Krea](https://www.krea.ai/blog/ai-product-photography-in-2026-tools-prompts-pipeline) (cutout-and-composite + selective-upscale pattern)
- Reuses the FASHN / Gemini / gpt-image-1 comparison and sources already cited in `docs/polish/mockup-to-model-ai-research/README.md`
