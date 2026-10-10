# Staging environment

Staging is a full copy of the stack that can be broken safely: its own API, its own database, its own Clerk instance, Stripe **test** mode, and its own app build channel. Nothing in it reaches real customers or real money.

## The switch

| Where | Variable | Values |
| --- | --- | --- |
| API | `APP_ENV` | `production`, `staging`, `development`. Unset follows `NODE_ENV`, so today's deployments are unchanged. |
| Mobile | `EXPO_PUBLIC_APP_ENV` | `staging` (set by the `staging` EAS build profile) |

With `APP_ENV=staging` the API **refuses to boot** if it finds a live Stripe key (`sk_live_`, `rk_live_`), a production Clerk key (`sk_live_` / `pk_live_`), or a `DATABASE_URL` equal to `PRODUCTION_DATABASE_URL` (optional guard: set it on staging to the production connection string so a copy-paste mistake is caught). Code: `artifacts/api-server/src/lib/appEnv.ts`, called from `validateEnv()`.

## What staging needs (Dev creates these accounts once)

| Service | Staging setup |
| --- | --- |
| Hosting | A second deployment of the API artifact with `APP_ENV=staging`, `NODE_ENV=production`, its own domain, e.g. `staging-api.brandthread.app` |
| Postgres | A separate database. Run `pnpm --filter @workspace/db run push` then `run migrate`. Seed with test accounts only; never copy production customer data |
| Clerk | A separate **Development** instance (`pk_test_` / `sk_test_`) |
| Stripe | Test mode keys (`sk_test_`), a separate test webhook endpoint and `STRIPE_WEBHOOK_SECRET` |
| Sentry | Same DSN is fine; `SENTRY_ENVIRONMENT=staging` (API) and `EXPO_PUBLIC_SENTRY_ENVIRONMENT=staging` (mobile) keep events apart |
| Email / push / SMS | Point at sandbox senders or leave unset (those features turn off) |
| Object storage | A separate bucket |

## Mobile

`artifacts/mobile/eas.json` has a `staging` build profile (extends `preview`, update channel `staging`, internal distribution). Build with `eas build --profile staging`. Point it at the staging API with `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_DOMAIN` set in the EAS `preview` environment or overridden on the command line. OTA updates published to channel `staging` reach only staging builds.

## Promotion

Merge to `dev` -> deploy to staging -> smoke test (sign in, browse, add to cart, test-card checkout, DM, live) -> deploy the same commit to production.

## Variables that differ per environment

`APP_ENV`, `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SESSION_SECRET`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` (live video and calls; without them Go Live is hidden), `SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, object storage bucket variables. Use a different `SESSION_SECRET` in every environment.
