---
name: Support Chatbot Architecture
description: AI support chatbot — floating bubble, account-aware backend, escalation flow
---

## Overview
Brandthread has two separate AI systems:
1. **AIBrainFAB** (seller-only, bottom-right, purple) — business advisor at `/api/ai/chat`, navigates to `ai-brain.tsx` screen
2. **SupportChatBubble** (buyer + seller, bottom-left, teal #22D3EE) — support chatbot via Modal, calls `/api/support-chat/message`

## Backend: `/api/support-chat`
- File: `artifacts/api-server/src/routes/support-chat.ts`
- Registered in `routes/index.ts` at `/api/support-chat`
- Two endpoints:
  - `POST /message` — main chat; fetches real account data, calls GPT-4o-mini
  - `POST /escalate` — creates a `support_tickets` row for human follow-up
- Uses same OpenAI client as ai.ts: `@workspace/integrations-openai-ai-server`
- **No new API key needed** — uses `AI_INTEGRATIONS_OPENAI_API_KEY` already configured

## Account context (buildUserContext)
- Detects role: seller if they have products or brandName, else buyer
- **Sellers**: products (top 12), seller orders (15), drop wallet balances + transactions (raw SQL)
- **Buyers**: buyer orders (10) via `orders.buyerId` — note this column join, not `ownerId`
- PII rule enforced in system prompt: last-4 digits only for bank accounts

## Mobile: SupportChatBubble
- File: `artifacts/mobile/components/SupportChatBubble.tsx`
- Self-contained: floating Animated.View + Modal (no navigation)
- Placed in `(tabs)/_layout.tsx` (seller, bottomOffset=58) and `(buyer)/_layout.tsx` (buyer, bottomOffset=54)
- Quick reply chips for common questions
- Auto-escalates when AI response starts with `ESCALATE:`
- api.ts: `api.supportChat.send(messages)` + `api.supportChat.escalate(summary, snippet)`

## Why
- Modal approach (not navigation) ensures it persists across all screens without nav state issues
- Teal color intentionally distinct from AIBrainFAB purple to signal "help" vs "advice"
- Rate limited at 20 req/min per user; temperature=0.4 for factual support answers
