---
name: AI Brain system wiring
description: What was pre-existing vs newly wired for the AI assistant, brand memory, and proactive suggestions system.
---

## What was already working
- `ai-brain.tsx` — Full sophisticated AI chat already wired to real `/api/ai/chat` via `aiService.sendMessage()`. Gets Clerk auth token, passes brand memory summary in context. **Already live before this session.**
- `ai-settings.tsx` — AsyncStorage-based settings (local preference, no backend needed). Already functional.
- `ai-studio.tsx` — Design canvas launcher. No AI wiring needed.

## What was newly built

### Backend: /api/ai/ (3 new sub-routes in ai.ts)
- `POST /api/ai/brand-memory/rebuild` — queries seller's products (name/desc/price), posts (captions), and storefront (title/subtitle/description) from DB → GPT-4o-mini with JSON response format → returns `{ fields: Record<string, string> }` with brand voice profile keys.
- `GET /api/ai/suggestions` — queries real DB: low-inventory productVariants (stock ≤ lowStockThreshold), unfulfilled orders (status='paid'), caption-less posts. Returns typed AISuggestion[] with real urgency levels.
- `GET /api/ai/sessions` — calls `clerkClient.sessions.getSessionList({ userId })` → returns last 20 sessions.

### Mobile services
- `aiBrandMemory.ts` — `rebuildBrandMemory(authToken?)`: tries `POST /api/ai/brand-memory/rebuild` first, maps returned fields into BrandMemory shape; falls back to demo defaults if no auth or API unreachable.
- `aiService.ts` — `getAISuggestions(authToken?)`: tries `GET /api/ai/suggestions` first, merges with stored dismissals in AsyncStorage; falls back to hardcoded DEMO array. `getNextBestActions(authToken?)`: maps real suggestions → NextBestAction shape; falls back to demo.

### Mobile screens
- `ai-assistant.tsx` — Rewritten to use `aiService.sendMessage()` with real Clerk auth token via `useAuth().getToken()`. Maintains AISession via `sessionRef`. Fallback error message on network failure. Same UI.
- `ai-brand-memory.tsx` — `handleRebuild` now async: gets Clerk token via `useAuth`, passes it to `rebuildBrandMemory(token)`. Shows loading state during rebuild. Shows success/failure alert.

## Key decisions
- Services accept `authToken?: string | null` as parameter (not hook) because they run outside React components.
- Suggestions are merged with stored dismissals so dismiss state survives API re-fetch.
- `POST /api/ai/brand-memory/rebuild` uses `response_format: { type: "json_object" }` for reliable JSON output.
