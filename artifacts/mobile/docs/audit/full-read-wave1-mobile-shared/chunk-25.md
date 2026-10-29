# Chunk 25
## Files read
| file | lines read (= file length) | defects found | defects fixed |
|---|---|---|---|
| artifacts/mobile/services/officialSeed.feed.test.ts | 115 | 0 | 0 |
| artifacts/mobile/services/officialSeedService.ts | 134 | 0 | 0 |
| artifacts/mobile/services/orderPolicy.ts | 16 | 0 | 0 |
| artifacts/mobile/services/orderService.buyerStatus.test.ts | 22 | 0 | 0 |
| artifacts/mobile/services/orderService.test.ts | 96 | 0 | 0 |
| artifacts/mobile/services/orderService.ts | 866 | 2 | 2 |
| artifacts/mobile/services/orderTypes.test.ts | 11 | 0 | 0 |
| artifacts/mobile/services/orderTypes.ts | 666 | 0 | 0 |
| artifacts/mobile/services/postExtrasService.ts | 43 | 0 | 0 |
| artifacts/mobile/services/postPinService.ts | 76 | 0 | 0 |
| artifacts/mobile/services/postPollService.ts | 118 | 1 | 1 |
| artifacts/mobile/services/productSalesFlagsService.ts | 7 | 0 | 0 |
| artifacts/mobile/services/productService.ts | 893 | 2 | 2 |
| artifacts/mobile/services/productTypes.ts | 358 | 0 | 0 |
| artifacts/mobile/services/profileService.ts | 242 | 0 | 0 |
| artifacts/mobile/services/reorderService.ts | 95 | 0 | 0 |
| artifacts/mobile/services/sampleCheckoutReturn.test.ts | 27 | 0 | 0 |
| artifacts/mobile/services/sellerInsightsService.ts | 194 | 0 | 0 |
| artifacts/mobile/services/sellerToolsService.ts | 39 | 0 | 0 |
| artifacts/mobile/services/serverProducts.ts | 181 | 0 | 0 |
| artifacts/mobile/services/settingsCatalog.test.ts | 43 | 0 | 0 |
| artifacts/mobile/services/settingsCatalog.ts | 365 | 0 | 0 |
| artifacts/mobile/services/socialService.collections.test.ts | 99 | 0 | 0 |
| artifacts/mobile/services/socialService.following.test.ts | 39 | 0 | 0 |
| artifacts/mobile/services/socialService.forYouRanked.test.ts | 102 | 0 | 0 |
| artifacts/mobile/services/socialService.freshPreview.test.ts | 89 | 0 | 0 |
| artifacts/mobile/services/socialService.identity.test.ts | 113 | 0 | 0 |
| artifacts/mobile/services/socialService.noDemoData.test.ts | 156 | 0 | 0 |
| artifacts/mobile/services/socialService.notifications.test.ts | 100 | 0 | 0 |
| artifacts/mobile/services/socialService.outbox.test.ts | 105 | 0 | 0 |
| artifacts/mobile/services/socialService.pagination.test.ts | 183 | 0 | 0 |
| artifacts/mobile/services/socialService.postMutations.test.ts | 142 | 0 | 0 |
| artifacts/mobile/services/socialService.pronouns.test.ts | 65 | 0 | 0 |
| artifacts/mobile/services/socialService.threadFeed.test.ts | 91 | 0 | 0 |
| artifacts/mobile/services/socialService.ts | 3049 | 3 | 3 |
| artifacts/mobile/services/socialTypes.ts | 756 | 1 | 1 |
| artifacts/mobile/services/sponsoredService.ts | 42 | 0 | 0 |
| artifacts/mobile/services/storeAiActions.test.ts | 72 | 0 | 0 |
| artifacts/mobile/services/storeAiActions.ts | 100 | 1 | 1 |
| artifacts/mobile/services/storeApplyFailure.test.ts | 107 | 0 | 0 |
| artifacts/mobile/services/storeBlocksService.ts | 93 | 0 | 0 |
| artifacts/mobile/services/storeBuilderPersistence.test.ts | 133 | 0 | 0 |
| artifacts/mobile/services/storeBuilderSync.test.ts | 55 | 0 | 0 |
| artifacts/mobile/services/storeBuilderSync.ts | 138 | 0 | 0 |
| artifacts/mobile/services/storeDomainStatus.ts | 31 | 0 | 0 |
| artifacts/mobile/services/storePublish.test.ts | 82 | 0 | 0 |
| artifacts/mobile/services/storeService.ts | 1855 | 4 | 4 |
| artifacts/mobile/services/storeSettingsSync.test.ts | 114 | 0 | 0 |
| artifacts/mobile/services/storeSettingsSync.ts | 116 | 0 | 0 |
| artifacts/mobile/services/storeTypes.ts | 844 | 0 | 0 |
| artifacts/mobile/services/threadsFollowedFirst.test.ts | 82 | 0 | 0 |
| artifacts/mobile/services/threadsFollowedFirst.ts | 67 | 0 | 0 |
| artifacts/mobile/services/types.ts | 478 | 0 | 0 |
| artifacts/mobile/services/wrappedService.ts | 31 | 0 | 0 |

(Line counts are the original lengths from chunk25.txt, all read in full. Every API path in these files was checked against artifacts/api-server/src/routes; the mismatches are listed below.)

## Fixes
- `services/productService.ts:474,522` (crosschunk entry from chunk 08, confirmed) — `adjustInventory` / `adjustVariantStock` returned an `InventoryAdjustment` even when `updateProduct` saved nothing. That happens for any server-only product: `getProduct` maps it from `GET /api/products/:id`, but it has no local row, so `updateProduct` returns undefined. The stock editor then showed "M set to 8" with an Undo even though nothing was saved. → Both now return `undefined` when `updateProduct` returns undefined. StockEditorSheet and product-detail already treat `undefined` as a failure and revert the row. Test: `services/productService.audit.test.ts` (failed before: yes)
- `services/productService.ts:219` — `fetchServerProducts` read only `GET /api/products`. The server pages that list at 100 rows (its default and MAX_PAGE_LIMIT, products.ts:211). A seller with more than 100 products never saw the rest in the Products tab, the stats or the pickers. → It now keeps fetching `?offset=100, 200, …` while a page comes back full (capped at 50 pages). The first request stays `'/api/products'` exactly as before. Test: `services/productService.audit.test.ts` (failed before: yes)
- `services/orderService.ts:455-474` — `voidShippingLabel` read camelCase fields only. `POST /api/shipping-labels/:orderId/:labelId/void` answers a repeated void (already voided, or refund already pending; shipping-labels.ts:506,508) with the raw SQL row: `price_cents`, `tracking_number`, `label_url`, `created_at`. The returned label then had `priceCents: undefined` (`formatCents` asserts on it), an empty tracking number and an undefined `purchasedAt`, and fulfill-order `setLabel`'d that. → The function now accepts both column spellings, and `refundPending` is a strict boolean. Test: `services/orderService.audit.test.ts` (failed before: yes)
- `services/orderService.ts:860` — `exportOrdersCsv` joined unquoted fields. `formatCents` gives "$1,234.56" and names can hold commas ("Lee, Ana"), which shifted the columns. → Every cell is quoted and escaped. (The function has no callers right now; fixed because the output was wrong.) Test: `services/orderService.audit.test.ts` (failed before: yes)
- `services/postPollService.ts` — the poll cache holds viewer state (`myVote`, `canVote`, `isAuthor`, `showResults`) and was never cleared on sign-out or account switch. Account B saw account A's vote and results and could not vote. → It now subscribes to `onServicesConfigured`, which fires on every auth re-wire. On that event the cache is cleared, the polls on screen are fetched again, and an in-flight batch from the old account is dropped (generation counter). Test: `services/postPollService.audit.test.tsx` (failed before: yes)
- `services/socialService.ts:2215` — `deleteNotification` swallowed a failed server DELETE and removed the row locally. buyer-notifications.tsx:420/545 rely on a throw to put the row back and alert, so a failed delete showed as done and the row came back on the next refetch. → It now throws on failure. Test: `services/socialService.audit.test.ts` (failed before: yes)
- `services/socialService.ts:1903` — `addReaction` found "my" reaction with `r.fromId === MY_USER_ID` ('me'). Server reactions (GET messages) carry `userId` with the Clerk id and no `fromId`, so after any refetch re-tapping my own reaction sent PUT (a no-op upsert) instead of DELETE. The UI removed it optimistically and the next refetch brought it back. → Ownership now uses `reactionAuthorId` (`fromId ?? userId`), matching either 'me' or the account id, and the kind uses `reactionKind`. Test: `services/socialService.audit.test.ts` (failed before: yes)
- Story countdown skew (crosschunk entry from chunk 10; the story receipt point is in my chunk). `services/socialService.ts` gets a new `stampStickerStateReceipt(story)`: it stamps `stickerState.receivedAt = Date.now()` and keeps an existing stamp. It is applied in `cacheStoriesForViewer` (the viewer's main source; cached stories can be read hours later, so the countdown could be hours too long) and in `getMyStories`. `services/socialTypes.ts`: `StoryStickerState.receivedAt?: number`. `components/social/StoryStickers.tsx`: `useCountdown(releaseAt, serverNow, tick, receivedAt?)` now uses offset = `serverNow - receivedAt` through the new `serverClockOffset()`, falling back to the old `serverNow - now` when there is no stamp (fresh vote/answer states, previews). `CountdownSticker` takes `receivedAt`, and `ViewerStickerLayer` passes `live?.receivedAt`. `app/buyer-story-viewer.tsx` stamps stories fetched with `api.social.storyById` and highlight stories. Tests: `services/socialService.audit.test.ts` (stamp) and `components/social/__tests__/StoryStickers.audit.test.tsx` (a countdown fetched 30 s ago shows 30 s, not 60 s) (failed before: yes)
- `services/socialTypes.ts:416-419` — the comments said poll and question sticker answers "are not yet persisted server-side — UI-only". They are saved through `POST /api/social/stories/:id/poll-vote` and `/question-answer` (story-stickers.ts:100,125). → Comments corrected (comment only, no test).
- `services/storeService.ts:693,747` (undo) — `_pushUndo(store, 'create_section'|'duplicate_section', { sections: store.sections })` stored a reference to the array that was then mutated (push, sort), so Undo restored the state after the change and did nothing. → `_pushUndo` now stores a deep copy. Test: `services/storeService.audit.test.ts` (failed before: yes)
- `services/storeService.ts:724,782` — `reorderSections` saved only `{id, order}` and Undo assigned those partial rows as `store.sections`. That wiped every section's type, label and settings, and the result was saved and synced to PUT /api/store. → Reorder now saves the full sections. Undo also handles older `{id, order}` entries already persisted on devices by restoring only the order. Test: `services/storeService.audit.test.ts` (failed before: yes)
- `services/storeService.ts:713,786` — `update_section` saved `{ section }`, but Undo read `entry.before` as a `StoreSection`, so `prev.id` was undefined and Undo did nothing. → Undo now reads `.section`, with a fallback for the bare shape. Test: `services/storeService.audit.test.ts` (failed before: yes)
- `services/storeService.ts:1-3, 1420-1423, 1526, 1567` — several comments were wrong. The header said "All persistence via AsyncStorage. No real AI backend required". The mapAiConfigToResult and generateFromSocial comments said the AI's "palette, typography (exact font names, border radius)" are applied. The save-payload comment said "Persist exact AI font name". The code deliberately forces the Thread Theme look. → Comments corrected (comment only).
- `services/storeAiActions.ts:56` — `a.screen in SCREEN_ROUTES` accepted prototype keys ('constructor', 'toString'). An AI suggestion with such a screen parsed as valid, and `screenRoute` returned a function, which was pushed to the router. → It now uses `hasOwnProperty`. Test: `services/storeService.audit.test.ts` (failed before: yes)

## Judgment calls — not changed
- `services/productService.ts:385-401` (archive / unarchive / publish / schedule) and the stock editor change only the device store. For a server product (UUID, from GET /api/products) without a local mirror, `archiveProduct` and `publishProduct` silently do nothing. products.tsx `handleQuickArchive` flips the row optimistically and never learns of this. Fixing it means wiring PUT /api/products/:id (status) and the variant stock endpoints, which is a product and design decision, so I left it. The new `undefined` return from the stock adjusters at least stops the false "saved".
- `services/productService.ts:550-578` `getProductAnalytics` makes up metrics shown on product-detail: pageViews = units×18, a fixed 1.8% refund rate and 13.4% add-to-bag rate, bestSize 'M', bestColor 'Black', and synthetic revenue-by-day. Real data needs an analytics endpoint; product decision.
- `services/productService.ts:249-252` vs `:888-890` — the 'pre-order' filter includes `salesModel: 'both'` but the stats `preOrder` count does not. The 'out-of-stock' filter doesn't require `active` but the stat does. The UI may intend this; not changed.
- `services/officialSeedService.ts:77-80` — the server answers `{ seeding:false, reason:'error' }` on a transient failure (feed.ts:364), and the client marks the cursor `done` for the whole session. This may be deliberate ("seeding is optional").
- `services/socialService.ts:1746,1865` — `sendMessageWithOutbox` and `retryMessage` don't send a `clientMessageId`, so a retry after a lost response can duplicate the message. `sendMessageWithOutbox` has no app callers; `retryMessage` is used only for non-outbox failures. Left as is.
- `services/socialService.ts:480-497` — `updatePost` accepts `profileVisibility` but never sends it.
- `services/socialService.ts:338` — `getPublicPostAsBuyerPost` labels seller (Thread) posts `authorAccountType: 'buyer'`. That is what the BuyerPost type requires.
- `services/orderService.ts:724` — `mapApiBuyerOrder` drops `gift`, `buyerCancelDeadline`, line `productId` and `cancellationNotes`. The only screen that needs them (buyer-order-detail) has its own mapper, so nothing visible is affected.
- `services/storeService.ts:1145-1179` — `restoreVersion` falls back to the local snapshot without telling the user when the server restore fails. `publishStore` sets `serverSlug` after `saveStorefront`, so it is not persisted (the next remote read sets it again).

## Cross-chunk defects (not fixed)
- `artifacts/api-server/src/routes/shipping-labels.ts:506,508` — the void endpoint's duplicate replies return the raw `tx.execute` row (snake_case) as `label`. → Map it to camelCase like the purchase duplicate path at :220-236. The client now copes with both shapes.
- Failures that already happen with the original files and are not in my code: `tests/fulfill-order.test.tsx` (3 failing, the same with my orderService change reverted), `tests/buyer-conversation-chat-redesign.test.tsx` (9 failing, the same with the original socialService), and `tests/inventory-removal.structure.test.ts` (flags `lib/dashboardAISuggestions.ts`).

## Test files touched / created
- created `artifacts/mobile/services/productService.audit.test.ts`
- created `artifacts/mobile/services/orderService.audit.test.ts`
- created `artifacts/mobile/services/postPollService.audit.test.tsx`
- created `artifacts/mobile/services/socialService.audit.test.ts`
- created `artifacts/mobile/services/storeService.audit.test.ts`
- created `artifacts/mobile/components/social/__tests__/StoryStickers.audit.test.tsx`
- Out-of-chunk edits allowed for the countdown fix: `components/social/StoryStickers.tsx`, `app/buyer-story-viewer.tsx`.
- Originals backed up in `scratchpad/c25/*.orig`.

Typecheck: one tsc run filtered to changed files and new tests showed no errors. Vitest: all chunk-25 test files plus the new audit tests pass (39 files, 191 tests).
