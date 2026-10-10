# AI safety: prompt filter, output filter, AI-generated label

Why: App Store Review 1.1 / 5.2 (objectionable content, IP, likeness) and Google Play's AI-Generated Content and Impersonation policies make the publisher responsible for what the AI tools produce. Every AI tool now goes through one shared server-side guard.

## How it works

One middleware, `artifacts/api-server/src/middlewares/aiSafetyGuard.ts`, mounted in `routes/index.ts` in front of each AI router. No route file was edited, so tools owned by other sessions are untouched.

| Stage | What it does | Code |
|---|---|---|
| Prompt filter | Local deterministic rules first, then OpenAI `omni-moderation-latest` (text) when a key exists. Blocked requests get `422 { error, code: "AI_PROMPT_BLOCKED", category }` before any paid model is called. | `lib/aiSafety/promptFilter.ts`, `lib/aiSafety/denylist.ts` |
| Output filter | Every base64 image in a JSON response (`b64_json`) is checked with omni-moderation (image) before it reaches the client. Flagged: `422 { code: "AI_OUTPUT_BLOCKED" }` and the image is dropped. | `lib/aiSafety/outputModeration.ts` (reuses `lib/imageModeration.ts`) |
| Label | Clean responses get `ai_generated: true`; the SHA-256 of each image is stored in `ai_generated_media` (migration `240_ai_generated_media.sql`). Mobile shows a small solid "AI" tag on the image. | `lib/aiSafety/provenance.ts`, `components/AiGeneratedBadge.tsx` |

Two rule sets:
- **media** (logo, mockup, photography, lifestyle, bg-removal, onboarding sample): full rules. Celebrity and public-figure names, likeness phrases (face swap, deepfake, "looks exactly like"), other companies' brands and logos, copyrighted characters, sexual, violent, hateful and minor-safety terms.
- **chat / text** (AI assistant, Brandthread agent, support chat, store-ai, tech pack): safety rules only (sexual, violent, hateful, minor-safety). Brand and celebrity names are allowed because people legitimately ask a chatbot about them. Chat endpoints read only the user's latest typed turn, never history or context.

Local rules: whole-word matching on text normalized for case, accents, apostrophes, punctuation, leetspeak (`b3yonce`), stretched letters and spaced letters (`N i k e`). Ambiguous English words that are also brands (Apple, Gap, Polo, Coach, Guess...) are blocked only next to a trademark-context word (logo, monogram, replica, swoosh, "inspired by"). Minor-safety: a minor term or age under 18 plus any sexualizing term anywhere in the prompt is blocked. Fashion-legitimate text (lingerie, nude colour, children's wear, polo shirt) passes; see the allowed rows in the tests.

Maintaining the list: edit `lib/aiSafety/denylist.ts` (plain arrays, commented) and add a row to `lib/__tests__/aiSafety.test.ts`.

## Fail-safe behaviour

- Never crashes: every provider call is wrapped; the guard itself falls through to `next()` if it errors.
- No OpenAI key: prompt filter runs on local rules only; output check reports "unavailable" and the image is returned (logged). Set `AI_OUTPUT_MODERATION_STRICT=1` to withhold unchecked images instead (recommended for production once the key is set).
- Signed-out requests pass straight through (the route's own auth rejects them), so no moderation API calls are spent on anonymous or web-preview traffic.
- Key lookup (shared with every AI feature, `lib/integrations-openai-ai-server/src/config.ts`): the Replit pair `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`, otherwise `OPENAI_API_KEY` with `OPENAI_BASE_URL` or api.openai.com. No new key is required.

## Coverage table

| AI tool (endpoint) | Prompt-filtered | Output-filtered | Labeled |
|---|---|---|---|
| Mockup generate (`POST /api/mockup/generate`) | Yes, media rules | Yes | Yes (API `ai_generated`, app tag in AI mockup chat) |
| Photography generate (`/api/photography/generate`) | Yes, media | Yes | Yes (AI photo chat tag) |
| Mockup to model + retry (`/photography/mockup-to-model[/retry]`) | Yes, media | Yes (incl. `results[]`) | API flag yes; app tag on AI photo chat results; the dedicated results screen is not tagged (see gaps) |
| Outfit swap + retry (`/photography/outfit-swap[/retry]`) | Yes, media | Yes | Same as above |
| Lifestyle images (`/api/lifestyle/generate`) | Yes, media | Yes | Yes (tag on result) |
| Logo generate (`/api/logo/generate`) | Yes, media | Yes | Yes (tag on Brand logo picker) |
| Onboarding logo sample (`/api/onboarding-sample/logo`) | Yes, media | Yes | Yes (tag on sample card) |
| Remove / replace background (`/api/bg-removal/remove`, `/replace`) | Yes (any text fields) | Yes (`b64_json`) | Yes (tag on result stage); stored copy at `/results/*` is written by the route before the guard sees it, see gaps |
| Tech pack (`/api/techpack/generate`) | Yes, safety rules, all fields | N/A (PDF, text) | N/A (document) |
| Store AI (`/api/store/ai/generate`, `from-logo`, `from-moodboard`, `from-social`) | Yes, safety rules, all fields | N/A (JSON config text) | N/A; generated store copy in Store Policies already carries `aiGenerated` |
| AI assistant (`/api/ai/chat`, `/chat/stream`, `/suggestions`, `/brand-memory/rebuild`) | Yes, safety rules on latest user turn | No (text; streamed) | N/A (text chat; assistant UI is labeled as AI) |
| Brandthread agent (`/api/brandthread-agent/message`) | Yes, safety rules | No (text) | N/A |
| Support chat (`/api/support-chat/message`, `/escalate`) | Yes, safety rules | No (text) | N/A |
| Avatar video (`/api/profile/avatar-video`) | N/A (user-recorded upload, not generative) | Existing upload checks | N/A |
| Design Studio (`/api/design-studio/*`) | N/A (user-authored canvas, not generative; generation goes through the mockup/logo/photography endpoints above) | N/A | N/A |
| Shopify import description cleanup (`/api/shopify-import`) | Not gated: input is the merchant's own catalog, output is text | N/A | N/A |

## Known gaps (need an owner decision or another session's file)

1. Posts: no `ai_generated` column on `posts` (create flow is owned by another session). The registry `ai_generated_media` plus `isAiGeneratedHash(sha256)` in `lib/aiSafety/provenance.ts` is the hook: the post-create handler can hash the uploaded bytes and set a flag/label. Until then AI media posted to the feed is not auto-tagged; brand assets saved from AI tools already carry the `ai-generated` tag client-side.
2. Background removal stores its result in object storage before the JSON response is produced, so a blocked result is not returned but the stored object persists until cleanup. Owner of that feature should delete the stored key on `AI_OUTPUT_BLOCKED`, or move storage after the check.
3. `design-mockup-to-model` results screen is not tagged (file under active work by another session); `ai-photography-chat` and `design-bg-removal` get the tag instead.
4. Output moderation is image-only. Text returned by chat tools is not re-moderated.
5. The client shows its existing generic failure UI for blocked prompts and images (e.g. "Couldn't create that mockup. Try rewording it."); it does not yet show the server's specific message.

## Owner actions

- Keep `OPENAI_API_KEY` (or the Replit `AI_INTEGRATIONS_OPENAI_*` pair) set in the API environment so OpenAI moderation is active; without it only local rules run, production logs an error at boot and `/api/healthz/ready` reports `degraded: true`.
- Set `AI_OUTPUT_MODERATION_STRICT=1` in production so unchecked images are never delivered.
- Run migration `240_ai_generated_media.sql`.

## Tests

`pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/aiSafety.test.ts src/middlewares/__tests__/aiSafetyGuard.test.ts` (73 tests, no network, no database): table-driven prompt rows (allowed fashion prompts, likeness, trademarks, characters, sexual, minor safety, violence, hate, chat-mode exemptions), provider-degradation cases, and guard behaviour (block before route, output withheld, label + provenance, signed-out passthrough, strict mode, chat scanning).
