# Round 2 batch B
(all paths relative to artifacts/mobile)

## Fixed
- `lib/invoice.ts:95` — issued date was `toISOString().slice(0,10)` (UTC day): a 9:30 pm New York order printed as the next day → uses `dateToYmd` from lib/dateTimeField.ts (local calendar date, same helper the date pickers use). Test: `lib/invoice.audit2.test.ts` (failed before: yes)
- `lib/scheduleWindow.ts:153` — scheduleSummary took the zone abbreviation at "now" for both ends; Oct 20 → Nov 10 in America/New_York read "EDT … EDT" → abbreviation computed at each end's own instant (`instantFromFields`, falls back to now if unparseable). Test: `lib/scheduleWindow.audit2.test.ts` (failed before: yes)
- `lib/live/liveAuction.ts:80` — formatBid grouped whole dollars ("$1,234") but not cents ("$1234.50") → single toLocaleString path with 0 or 2 fraction digits ("$1,234.50"). Test: `lib/live/liveAuction.audit2.test.ts` (failed before: yes)
- `components/disputes/disputeUi.ts:50` — daysLeft ceiled hours, so a deadline later today read "Due in 1 day" and "Due today" was unreachable → daysLeft counts local calendar days (0 = later today, 1 = tomorrow even if <24h away). Chunk 05's past-due check (timestamp < now → "Past due") kept untouched. Updated chunk 05's `components/disputes/disputeUi.audit.test.ts` assertion that had locked the old "Due in 1 day for later today" behavior to "Due today" (with comment). Test: `components/disputes/disputeUi.audit2.test.ts` (failed before: yes)
- `lib/api.ts:2357,2365` — push.deregisterVoipToken / push.deregister called request() without asText/getCacheScope, so a successful DELETE cleared the 'anonymous' API cache instead of the user's (request() clears cache scope after any successful non-GET) → pass `false, getCacheScope`. Server routes (api-server/src/routes/push.ts DELETE /voip-token, /deregister) confirmed. Checked the other bare `getToken,` call sites in api.ts: all already pass getCacheScope. Test: `lib/api-push-deregister.audit2.test.ts` (failed before: yes)
- `lib/serviceConfig.ts:80` — whenConfigured's 8s reject timer was never cleared when configuration won the race → timer captured and cleared in `.finally`. Test: `lib/serviceConfig.audit2.test.ts` (failed before: yes)
- `lib/safeAsyncStorage.ts` — verified: any single throw set a module-wide `storageBlocked`, after which every get went to the memory map only, so keys persisted before (e.g. one quota error on a big write) read as null for the rest of the session, and later writes never reached storage again → per-call fallback: reads always try storage; a key whose own latest write/remove failed to persist is answered from an `unpersisted` map (so a failed write/remove doesn't surface the stale stored value); a throwing read falls back to this tab's mirror. Header comment updated. Test-only helpers unchanged in meaning. Test: `lib/safeAsyncStorage.audit2.test.ts` (failed before: yes; 2 of 5 cases failed, the others guard the new semantics). services/cartService.storageFallback.test.ts still passes.
- `lib/calls/native/useNativeCallBridge.ts:133` — verified: the cleanup runs after the render with the new userId, so latest.current.deregisterToken is the new account's client; and useApi's token getter reads a shared authRef, so even the old client would send the new session's bearer. The DELETE (server deletes WHERE userId = caller AND token) was therefore a no-op at best, and could land after the new account's POST of the same device token and delete it. Fix: capture the effect's userId; cleanup deregisters only when the account is unchanged (calls turned off / bridge disabled for the same account). On switch/sign-out it's skipped — the server's POST /voip-token onConflict(token) moves the token to the new account, and callIdentity's calleeId check drops stale rings (comment updated). Test: `lib/calls/native/__tests__/useNativeCallBridge.audit2.test.tsx` (failed before: yes)
- `lib/checkout/giftOptionStore.ts` — gift module state survived an account switch, so account B's order could carry account A's gift → `onServicesConfigured(resetGiftOption)` (the same account-change hook services/postPollService.ts uses; configureServices fires from app/_layout.tsx on user id / isLoaded / isSignedIn change, not mid-checkout). Test: `lib/checkout/giftOptionStore.audit2.test.ts` (failed before: yes)
- `lib/layerRenderer.ts:26,105` — comment said 11 sample points / input > 0.05; curveGain samples 9 points t = 0.1…0.9 → comments corrected (comment-only).
- `lib/signInIdentifier.ts:9` — comment said "7-15 digits"; code has only a ≥7-digit floor and a 20-char cap on the whole entry → comment corrected (comment-only).

## Rejected (not changed)
- giftOptionStore, abandoned checkout part — kept deliberately: leaving checkout without ordering keeps the gift; GiftOptionRow shows it checked on return so the buyer sees and can clear it (matches the "Gift this" save-then-return flow). Documented in the module header.

## Notes (outside batch, not changed)
- `components/discounts/ActiveDatesFields.tsx:29` — also computes `zoneAbbreviation(value.zone)` at "now" for the form's labels; same DST mismatch for a start/end in the other DST period. Fix: use `zoneAbbreviation(value.zone, instantFromFields(date, time, value.zone) ?? new Date())` per field.

## Test files created
- lib/invoice.audit2.test.ts
- lib/scheduleWindow.audit2.test.ts
- lib/live/liveAuction.audit2.test.ts
- components/disputes/disputeUi.audit2.test.ts
- lib/api-push-deregister.audit2.test.ts
- lib/serviceConfig.audit2.test.ts
- lib/safeAsyncStorage.audit2.test.ts
- lib/calls/native/__tests__/useNativeCallBridge.audit2.test.tsx
- lib/checkout/giftOptionStore.audit2.test.ts
Modified existing test: components/disputes/disputeUi.audit.test.ts (one assertion, see above).
Verification: all 9 new files fail against the reverted code (12 failing cases) and pass after; 21 targeted files / 82 tests pass (incl. invoice, scheduleWindow, disputeUi, giftOptionStore, useNativeCallBridge, cartService.storageFallback, tests/live-auction, api-request.audit). Filtered tsc: no errors in changed files.
