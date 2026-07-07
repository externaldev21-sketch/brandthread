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
```

### useSignUp
```ts
const { signUp, fetchStatus, errors } = useSignUp();
// signUp is SignUpFutureResource
```

## Sign-in flow (password)
```ts
const { error } = await signIn.password({ identifier: email, password });
// if no error, then:
const { error: finalizeError } = await signIn.finalize();
// finalize() sets the session active; useAuth().isSignedIn becomes true automatically
```

## Sign-up flow (password + email verification)
```ts
const { error } = await signUp.password({ emailAddress, password, firstName, lastName });
const { error: sendErr } = await signUp.verifications.sendEmailCode();
// user enters code:
const { error: verifyErr } = await signUp.verifications.verifyEmailCode({ code });
const { error: finalizeErr } = await signUp.finalize();
```

## Key differences from old API
- All methods return `{ error: ClerkError | null }` — check error on each step
- `finalize()` replaces `setActive({ session: createdSessionId })`
- `fetchStatus: 'idle' | 'fetching'` replaces `isLoaded` for loading state
- `errors` field on the hook return for last-fetch errors

## Metro watcher fix
`@clerk/shared` creates `_tmp_XXXX` dirs during install that Metro immediately tries to watch, crashing with ENOENT. Fix in `metro.config.js`:
```js
config.resolver.blockList = [/node_modules\/.*_tmp_.*/];
```

## TokenCache
Do NOT import from `@clerk/clerk-expo/dist/cache` — just type the object inline:
```ts
export const tokenCache = {
  async getToken(key: string): Promise<string | null> { ... },
  async saveToken(key: string, value: string): Promise<void> { ... },
  async clearToken(key: string): Promise<void> { ... },
};
```

**Why:** The internal dist path doesn't exist as a stable import; the cache type is inferred.
