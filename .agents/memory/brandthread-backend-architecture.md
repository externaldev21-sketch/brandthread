---
name: Brandthread backend architecture
description: Key architectural decisions for the Brandthread API + mobile app backend.
---

## Multi-tenancy model
Each Clerk user IS a brand owner. All tables have `owner_id TEXT NOT NULL` (= Clerk user ID). Every query must filter `WHERE owner_id = clerkUserId`. This provides full data isolation between users.

## lib/db build requirement
`lib/db` uses `composite: true` TypeScript project references. When API server typecheck fails with "no exported member" from @workspace/db, it means `lib/db` wasn't compiled. Fix:
```bash
cd lib/db && npx tsc --project tsconfig.json
```
The package exports `"./src/index.ts"` directly (works with esbuild) but tsc needs the compiled .d.ts files for project references.

## Order creation must be transactional
Orders touch: orders, order_items, product_variants (stock), customers (totals), drops (totals). Use `db.transaction()`. Server must resolve prices from DB (not trust client). Stock check AND deduction both go inside the transaction to prevent oversell.

## Order number strategy
Use per-owner sequential count inside the transaction: `SELECT count(*)::int FROM orders WHERE owner_id = $1`. Format as `BT-00001`. Safe because it's scoped to one owner and inside the transaction.

## clerkClient usage (@clerk/express)
`clerkClient` is a CONSTANT, not a function. Correct:
```ts
import { clerkClient } from '@clerk/express';
const user = await clerkClient.users.getUser(userId);
```
Wrong: `await (await clerkClient()).users.getUser(userId)` — throws "not callable".

## API base URL for mobile
Mobile dev script sets `EXPO_PUBLIC_API_BASE_URL=https://$REPLIT_DEV_DOMAIN/api-server`. In-app, use `process.env.EXPO_PUBLIC_API_BASE_URL`. The API server artifact is mapped to `/api-server` path in Replit path routing.

## healthz route double-path bug
If `health.ts` is mounted at `/healthz` in index.ts, the handler inside must use `router.get("/", ...)` not `router.get("/healthz", ...)` — otherwise the path becomes `/api/healthz/healthz`.
