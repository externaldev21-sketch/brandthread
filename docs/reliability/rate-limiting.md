# Rate limiting

Limits are enforced in Postgres (`rate_limit_buckets`), so every API instance shares one count. The middleware is `artifacts/api-server/src/middlewares/rateLimit.ts`; `appRateLimiter` runs for every request and individual routes can pin a stricter policy with `rateLimit("<policy>")`.

Each request is counted against **the signed-in user**, or **the client IP** when signed out. Policies marked "IP ceiling" also count signed-in requests against a bucket shared by every account behind the same IP, so one machine cannot get around the per-user limit by rotating accounts.

| Area | Policy | Per user / IP | IP ceiling | Window |
| --- | --- | ---: | ---: | --- |
| Sign-in, password reset (`/auth/*`) | `authentication` | 30 | 120 | 10 min |
| Messages (`/conversations`, communities, story replies) | `messaging` | 30 | 150 | 1 min |
| Uploads (any `upload*` route, or any POST/PUT carrying `image/*`, `video/*`, `audio/*`, PDF or octet-stream) | `upload` | 30 | 150 | 1 min |
| Design Studio master uploads | `asset-upload` | 6 | 30 | 1 min |
| AI generation (`/ai`, `/logo`, `/mockup`, `/photography`, `/lifestyle`, `/techpack`, `/bg-removal`, `/store/ai`, `/support-chat/message`, Design Studio) | `expensive` | 30 | 150 | 1 min |
| Brandthread Agent chat | `agent-chat` | 20 | 100 | 1 min |
| Checkout | `checkout` | 20 | | 5 min |
| Other writes | `mutation` | 120 | | 1 min |
| Reads (signed in / signed out) | `authenticated-read` / `public-read` | 600 / 240 | | 5 min |

Sign-up itself is handled by Clerk, which has its own throttles; the first call our API sees for a new account is `/auth/sync`, which falls under `authentication`.

Over the limit, the API answers `429` with `{ code: "RATE_LIMITED", retryAfterSeconds }` and a `Retry-After` header. If the limit store is unreachable it answers `503 RATE_LIMIT_UNAVAILABLE` instead of letting traffic through.

In `NODE_ENV=development` every limit is multiplied by `RATE_LIMIT_DEV_MULTIPLIER` (default 12) so the web preview does not trip them.

Tests: `src/middlewares/rateLimit.test.ts` (needs `TEST_DATABASE_URL`).
