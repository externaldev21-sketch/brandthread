---
name: useApi hook and api singleton
description: How the Brandthread API client is exported and wired; which pattern to use where
---

## Exports from artifacts/mobile/lib/api.ts

- `createApi(getToken)` — factory; returns typed BrandthreadApi
- `useApi()` — React hook; wraps createApi with Clerk's useAuth().getToken; memoised; **use this in all React components**
- `configureApi(getter)` — sets the module-level token getter for the singleton
- `api` — module-level singleton backed by configureApi getter; suitable for non-component callbacks (not React hooks context)
- `BrandthreadApi` — TypeScript type alias for the return of createApi

## Wiring (set up in _layout.tsx)

`ServiceConfigurer` component calls both `configureServices()` and `configureApi()` with `() => getToken()` in a useEffect on mount. This hydrates the singleton for any code that reaches for the module-level `api`.

`PushRegistrar` component calls `const api = useApi()` and uses the result inside its useEffect.

## Rule

**React components** → `const api = useApi()` at the top of the component. Its identity must remain stable for the active user even if Clerk changes the `getToken` function identity; read the latest token getter through a ref.  
**Compatibility hook paths** → re-export the canonical hook; never implement a second Clerk-bound memoization strategy.
**Non-component module code or legacy imports** → `api` singleton (requires ServiceConfigurer to have run first).

**Why:** `useApi` was missing from the file for many sessions, causing runtime `undefined` errors. Rebuilding the client whenever Clerk changes `getToken` identity creates effect loops, request storms, rate limiting, and visible layout churn in screens whose loaders depend on `api`. The singleton + configureApi pattern supports non-hook callsites.

## Story + feed-posting architecture (migration 011)

- `POST /api/posts` — seller-only at DB level (queries users.accountType, returns 403 SELLER_ONLY for buyers)
- `stories`, `story_likes`, `story_views` DB tables (migration 011)
- API routes under `/api/social/stories/*`: create, myStories, storiesForUser, like (toggle), view
- Mobile API client: `api.social.createStory/myStories/storiesForUser/likeStory/viewStory`
- Story ring: shown on buyer-other-profile.tsx (taps open viewer) and own profile.tsx (shows when myStories.length > 0)
- Like button: wired in buyer-story-viewer.tsx — optimistic update + server sync; liked set tracked per storyId
