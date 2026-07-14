---
name: AI Brain Architecture
description: Brandthread AI Brain — unified seller AI assistant built into the mobile app and API server.
---

# Brandthread AI Brain Architecture

## API Server
- New route: `artifacts/api-server/src/routes/ai.ts` → `POST /api/ai/chat`
- Uses `openai` client from `@workspace/integrations-openai-ai-server` (already set up — env vars AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL)
- Rate limit: 30 requests/user/minute
- Extracts optional `json:action` block from AI response for structured action cards
- Registered in `routes/index.ts` at `/ai`
- System prompt builder uses screen context + brand memory

## Mobile Service Layer
- `services/aiTypes.ts` — all types: AIMessage, AISession, AIScreenContext, AIActionCard, BrandMemory, AISettings, AISuggestion, NextBestAction, SCREEN_PROMPTS, contextLabel()
- `services/aiService.ts` — sendMessage, cancelGeneration, loadSession, startNewSession, clearSession, applyAction, undoAction, getAISuggestions, getNextBestActions, getAISettings, saveAISettings
- `services/aiBrandMemory.ts` — getBrandMemory, saveBrandMemory, toggleMemoryField, clearBrandMemory, rebuildBrandMemory, getEnabledMemorySummary
- `services/aiAuditLog.ts` — addAuditEntry, getAuditLog, clearAuditLog, markAuditEntryUndone

**AsyncStorage keys:** `bt:ai:settings:v1`, `bt:ai:session:v1`, `bt:ai:brand-memory:v1`, `bt:ai:audit:v1`, `bt:ai:suggestions:v1`

**nanoid replacement:** inline `nanoid()` function (Date.now().toString(36) + Math.random().toString(36).slice(2,9)) — do NOT use nanoid package

## Mobile Screens
- `app/ai-brain.tsx` — main premium chat interface (full-screen modal)
- `app/ai-brand-memory.tsx` — brand memory management
- `app/ai-settings.tsx` — AI settings

## AIBrainFAB Component
- `components/AIBrainFAB.tsx` — floating action button (purple, 52px circle, Brandthread logo)
- Hides with keyboard via Keyboard.addListener
- Navigates to `/ai-brain?context=<JSON>`
- bottomOffset=72 for screens with tab bar, bottomOffset=0 for detail screens

## Screens with FAB wired
- (tabs)/index.tsx → screen:'home', offset:72
- (tabs)/products.tsx → screen:'products', offset:72
- (tabs)/orders.tsx → screen:'orders', offset:72
- (tabs)/studio.tsx → screen:'design_studio', offset:72
- (tabs)/analytics.tsx → screen:'analytics', offset:72
- (tabs)/marketing.tsx → screen:'marketing', offset:72
- app/customers.tsx → screen:'customers', offset:0
- app/content.tsx → screen:'content', offset:0
- app/product-detail.tsx → screen:'product_detail', offset:0

## Routes registered in _layout.tsx
- `ai-brain` → fullScreenModal, slide_from_bottom
- `ai-brand-memory` → slide_from_right
- `ai-settings` → slide_from_right

## Critical Rules
- API keys NEVER in Expo client — all AI calls go through api-server proxy
- Mock fallback in aiService.ts when API is unreachable (context-aware demo responses)
- Destructive actions always require Alert.alert confirmation before applying
- feedEligibility still enforced at write for buyer posts (unchanged)
- No action card auto-executes — always pending → confirmed flow
