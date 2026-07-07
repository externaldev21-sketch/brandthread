---
name: Clerk Expo v3 Signals API
description: @clerk/expo v3+ changed useSignIn/useSignUp to a Signals-based API — completely different hook shapes and auth flow methods.
---

## The change
`@clerk/expo@3.x` re-exports hooks from `@clerk/react` which in turn uses `@clerk/shared@4.x` Signals API.

## Correct hook shapes

### useSignIn
```ts
const { signIn, fetchStatus, errors } = useSignIn();
// signIn is SignInFutureResource — NOT SignInResource
// NO isLoaded, NO setActive on this hook
// errors.fields.identifier / errors.fields.password — field-level errors
// fetchStatus: 'idle' | 'fetching' — for loading state
```

### useSignUp
```ts
const { signUp, fetchStatus, errors } = useSignUp();
// errors.fields.emailAddress / errors.fields.password / errors.fields.code
```

## Sign-in flow (password) — canonical pattern

```ts
// 1. Submit password (use emailAddress NOT identifier)
const { error } = await signIn.password({ emailAddress, password });
if (error) { console.error(error); return; }  // errors.fields.* renders in UI

// 2. Check status, then finalize with navigate callback (NOT bare finalize())
if (signIn.status === 'complete') {
  await signIn.finalize({
    navigate: ({ decorateUrl }) => {
      const url = decorateUrl('/');
      if (url.startsWith('http')) {
        window.location.href = url;  // web
      } else {
        router.replace(url as Href); // native
      }
    },
  });
}
// Handle needs_second_factor / needs_client_trust if needed
```

## Sign-up flow (password + email verification) — canonical pattern

```ts
// 1. Create account
const { error } = await signUp.password({ emailAddress, password, firstName, lastName });
if (!error) await signUp.verifications.sendEmailCode();

// 2. Show verification UI when:
//    signUp.status === 'missing_requirements'
//    && signUp.unverifiedFields.includes('email_address')
//    && signUp.missingFields.length === 0

// 3. Verify email code
await signUp.verifications.verifyEmailCode({ code });
if (signUp.status === 'complete') {
  await signUp.finalize({ navigate: ({ decorateUrl }) => { /* same pattern */ } });
}
```

## Critical requirements

- **REQUIRED in sign-up JSX**: `<View nativeID="clerk-captcha" />` — Clerk bot protection; missing this silently blocks sign-up
- **`emailAddress` not `identifier`** in `signIn.password()` / `signUp.password()`
- **`finalize({ navigate: ... })`** — finalize takes a navigate callback, NOT called bare
- **Check `status === 'complete'`** before calling `finalize()`
- **Read field errors from `errors.fields.*`** not just from method return value
- **`proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined}`** on `<ClerkProvider>` — empty in dev, auto-set in prod

## Metro watcher fix
`@clerk/shared` creates `_tmp_XXXX` dirs during install that Metro immediately tries to watch, crashing with ENOENT. Fix in `metro.config.js`:
```js
config.resolver.blockList = [/node_modules\/.*_tmp_.*/];
```

## TokenCache
Use a custom expo-secure-store backed object. Do NOT import from `@clerk/clerk-expo/dist/cache` — just implement the interface inline.

**Why:** The internal dist path doesn't exist as a stable import; the cache type is inferred.
