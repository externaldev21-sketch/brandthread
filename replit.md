# Brandthread

A comprehensive clothing brand management mobile app covering 18 modules: brand creation, AI design studio, products, store builder, manufacturer hub, payments, shipping, CRM, marketing, social media, analytics, finance, team management, AI assistant, community, mobile app builder, security, and automation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mobile/` is the Expo Router buyer and seller app. Routes live in `app/`, reusable business logic lives in `services/`, and API access is centralized in `lib/api.ts`.
- `artifacts/api-server/` is the Express API. Route modules are in `src/routes/`; authentication middleware, object storage, payments, AI, and logging helpers are in `src/lib/` and `src/middlewares/`.
- `lib/db/src/schema/index.ts` is the live Drizzle schema imported by the API. SQL changes belong in ordered, idempotent files under `lib/db/migrations/`, run by `lib/db/scripts/migrate.mjs`.
- `lib/api-spec/openapi.yaml` is the contract source for generated API clients and Zod schemas. Regenerate them with the codegen command after changing that contract.
- The buyer floating tab bar and its search morph live in `artifacts/mobile/components/buyer-nav/`; buyer screens behind it pad their content with `useBuyerTabBarInset()`.
- Mobile theme tokens and shared visual constants are in `artifacts/mobile/lib/theme.ts`; the app is dark-only and uses a strict monochrome palette of true black/graphite surfaces with white and gray text.
- `lib/integrations-openai-ai-server/` and `lib/integrations/openai_ai_integrations/` contain the Replit-managed OpenAI clients used by API AI features.

## Architecture decisions

- **Clerk is the identity authority.** Database records are scoped by Clerk user IDs, and local onboarding completion is explicitly bound to the signed-in Clerk user to prevent account leakage on shared devices.
- **The mobile app reaches Express through the routed API domain, never localhost.** Expo gets its base URL from `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_DOMAIN`; browser previews route `/api/*` to the API artifact.
- **Database changes are append-only and ordered.** Drizzle creates the base schema, then the migration runner records and applies idempotent SQL migrations in filename order. Do not reset production data to apply a schema change.
- **Money is stored as integer cents.** Convert only at the display boundary; never use floating-point values for orders, prices, fees, or payouts.
- **Public search keeps literal substring matching.** PostgreSQL trigram GIN indexes accelerate `ILIKE '%term%'` behavior instead of replacing it with token-only full-text search.

## Product

Brandthread is a fashion-commerce platform with role-specific buyer and seller experiences:

- Buyers can discover brands and drops, browse and save products, check out with Stripe, track orders, follow friends, post and interact in Thread, and message sellers or other buyers.
- Sellers can onboard a brand, manage products, inventory, orders, customers, shipping, promotions, storefronts, social posts, drops, analytics, team access, and finances.
- The product includes AI-assisted brand, design, store, and support tools; Stripe subscription/Connect workflows; push notifications; reviews and trust signals; and safety controls for messages and social content.
- The manufacturer hub supports directories, quotes, sample and bulk order progress, messaging, file/media sharing, and manufacturer payout readiness.

## User preferences

- Keep the Brandthread mobile experience dark-only and monochrome: true black/graphite surfaces with white and gray text. Do not introduce purple or cyan accents.
- Buyer and seller are separate account paths; do not reintroduce a combined “both” account type.
- Prefer real API-backed data and explicit unsupported states over fabricated dashboard, profile, order, or social metrics.

## Gotchas

- Build `@workspace/db` with `tsc --build` before typechecking API changes that depend on new schema exports.
- Run `pnpm --filter @workspace/db run push` followed by `pnpm --filter @workspace/db run migrate` for a clean development database; every migration must be safe to rerun.
- If an API endpoint changes, update `lib/api-spec/openapi.yaml` and run code generation before consuming it from typed clients.
- Expo web previews need the API base URL at the development domain root. Routing to `/api-server/*` can return SPA HTML with a successful status instead of an API response.
- Clerk Expo v3 uses the Signals API (`password()` / `finalize()`), and the onboarding flow must retain Clerk error handling plus user-scoped AsyncStorage draft state.
- Use `useFocusEffect` plus the existing polling patterns for order refresh, and keep database order enums distinct from mobile display labels.
- Alternate home-screen app icons are bundled by a native config plugin and only take effect in a native/EAS build. Expo Go and web previews apply the selected app theme but intentionally skip launcher-icon changes.

## Pointers

- Release tooling (TestFlight/preview builds, over-the-air updates and rollback, Sentry, store screenshots): `docs/app-store/release-flow.md`. List performance notes: `docs/performance/list-performance.md`.

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
