# Client performance: what changed, and what to expect

## What this PR does

- **Shared query cache**: `lib/queryClient.ts` configures the TanStack Query
  client that was already provisioned in `app/_layout.tsx` but never
  actually configured (`new QueryClient()` with zero options, and nothing
  in the app called `useQuery`). It now has a 30s `staleTime` (revisit a
  screen and it renders instantly from cache instead of re-fetching) and a
  24h `gcTime`, and is persisted to `AsyncStorage` via
  `PersistQueryClientProvider`, so a cold relaunch can paint the last-known
  data before the network responds.
- **Prefetch on press-in** (`lib/prefetch.ts`): warms a query + the
  destination's hero image the moment a finger lands on a row, ~100-200ms
  before `onPress` fires, wired as the first example on the seller products
  list (`app/(tabs)/products.tsx`). The pattern (`prefetchOnPressIn`) is
  meant to be copied into other list/card components as they're touched.
- **Request de-dup + cached auth token** (`lib/api.ts`): concurrent GET
  requests to the same path now share one in-flight promise instead of
  each firing its own `fetch`, and the Clerk `getToken()` call — previously
  invoked fresh on every single request — is now shared/cached for 4s so a
  screen making several parallel calls doesn't redundantly re-resolve the
  token N times.
- **FlashList**: added as a dependency; `app/(tabs)/products.tsx` is
  migrated from `FlatList` as the reference implementation (recycled rows,
  no more full off-screen row allocation). ~60 other `FlatList` usages
  remain — see "Left for follow-up" below.
- **Dev-only perf harness** (`lib/perf.ts`): wired once at the navigation
  root, logs `firstRender` and `data` timing to the console for every route
  automatically, no per-screen code needed. Only active when `__DEV__`.
- **Web**: `server/serve.js` now gzips JS/CSS/HTML/JSON/SVG responses when
  the client accepts it — cut transfer size on every route tested from
  ~31KB to ~9KB (see table below). A Playwright harness
  (`scripts/perf-harness.mjs`, `pnpm run perf:web`) measures TTFB, First
  Contentful Paint, DOMContentLoaded and Load against the static export.

## Measured (this sandbox, static export served locally)

Only the four statically pre-rendered public routes (`/`, `/privacy`,
`/terms`, `/community-guidelines`) are reachable here — there's no live API
server or signed-in Clerk session in this environment, so authenticated
buyer/seller screens couldn't be measured end-to-end. Once this runs against
a real deploy, extend `--routes` in `perf-harness.mjs` to cover those.

| Route | Transfer (before) | Transfer (after gzip) |
|---|---|---|
| `/` | 31 KB | 9 KB |
| `/privacy` | 31 KB | 9 KB |
| `/terms` | 31 KB | 9 KB |
| `/community-guidelines` | 31 KB | 9 KB |

FCP/TTFB numbers moved around run-to-run by tens of milliseconds in both
directions — at this page size, served over localhost, the network hop is
effectively free, so timing noise dominates any real signal. The honest
takeaway from this environment is the transfer-size reduction (real, ~70%,
reproducible); the FCP/TTFB win from smaller payloads will actually show up
once this is measured over a real network (see below) or against the much
larger authenticated bundles once those are reachable.

## Dev server vs. production build — set expectations honestly

The Replit/Expo Go dev server you've been testing on is **not representative
of production speed**. Three separate things make it slower:

1. **Unminified JS.** Dev bundles ship full variable names, dead code, and
   no tree-shaking. Production bundles (via `expo export` / EAS Build) are
   minified and tree-shaken — typically 3-5x smaller.
2. **Dev-only checks.** React and React Native run extra validation
   (prop-type-style checks, the Reanimated/React Compiler dev instrumentation,
   `__DEV__`-gated logging) on every render in development. None of that
   ships in production.
3. **Remote bundler.** Expo Go/dev-client fetches JS from the Metro dev
   server over the network on every reload, and does on-demand
   transformation per-file. A production build ships a single pre-built
   bundle with the app — no bundler round-trip at runtime.

**What to actually expect in production:** cold start dominated by native
module init + the (now-parallelized, cached-token) first API calls, warm
navigations rendering from the persisted query cache in well under 100ms,
and first-visit screens painting a skeleton immediately with real data
inside ~500ms on a normal connection — assuming the API-side work
(indexes, pagination, response times — owned by a separate effort) lands
too. None of that is achievable by testing in Expo Go; Expo Go itself adds
its own overhead on top of the dev-server issues above.

**How to test a production-like build:**

- **Web**: `pnpm run build && pnpm run serve` (or `PORT=4173 pnpm run
  serve`) serves the real static export through `server/serve.js` — this is
  what actually ships. Compare this, not the dev server, against Lighthouse.
- **Native**: an EAS Build (`eas build --profile preview` or `production`)
  or a local release build (`expo run:ios --configuration Release` / `expo
  run:android --variant release`) — not Expo Go, and not `expo start`.
