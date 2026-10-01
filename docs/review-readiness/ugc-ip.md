# UGC safety (Guideline 1.2) and IP (5.2) readiness

Scope: audit of what already existed, then additive gap fixes. Nothing existing was restyled, moved or removed.

## Audit result

| Item | Status | Evidence |
| --- | --- | --- |
| EULA / Community Guidelines acceptance at signup with "zero tolerance" wording | PASS (already present, untouched) | `artifacts/mobile/components/legal/LegalConsent.tsx:60` checkbox text; `content/legal.ts:86,265` zero-tolerance sections; Terms and Guidelines reachable from Settings (`services/settingsCatalog.ts:114-115`) |
| Report content (post, video, live, comment, story, product, profile, DM, group) | PASS | `routes/reports.ts`, `lib/reportTargets.ts`, `app/buyer-report.tsx` |
| "Counterfeit or IP violation" reason in every report sheet | PASS | one shared sheet, reason `ip_counterfeit` in `lib/safety.ts` REPORT_REASONS; covers products, posts, stores (profile) |
| Reports reach the admin queue | PASS, now tested end to end | `ugc-block-browse-sla.integration.test.ts` (report then queue) |
| 24h SLA indicator on the queue | FIXED | server `dueBy` and `summary.overdue` (`routes/moderation.ts`); admin card shows "Due in 5h" / "Overdue 3h" (`app/admin-reports.tsx`, `lib/reportSla.ts`) |
| Block removes content from feed, comments, search, stories | PARTIAL, FIXED | Existing filters cover posts feed, comments, stories, social search, profile, live. Gaps closed: public product list, product detail, related, high-demand, tagged videos, search videos, trending, discover feed (`routes/public.ts`). Signed-in responses are `private, no-store` so a shared cache never serves a blocked seller |
| Client cache purge on block | FIXED | `purgeAuthorFromFeedPostsCache` (memory and AsyncStorage) plus `queryClient.invalidateQueries()` in `blockUser` |
| Public DMCA / IP notice page | FIXED | `GET /legal/ip-notice` and `/dmca` served by the api-server (`routes/ipNoticePage.ts`), no login; creates an `ip_case` via `POST /api/ip-cases` |
| Admin takedown workflow | FIXED | existing IP case queue (manufacturer-portal `/moderation/ip-cases`, `PATCH /api/ip-cases/:id` hide/remove) now also notifies the seller, applies a strike, tracks counter-notice and reinstates |
| Repeat-infringer flag | FIXED | `users.ip_strike_count`, `ip_repeat_infringer`; auto-flag at `IP_REPEAT_INFRINGER_STRIKES` (default 3); `GET /api/ip-cases/repeat-infringers`; portal case view shows strikes |

## Policy implemented

1. A rights holder submits the public form (name, email, link, rights, evidence, good-faith and accuracy statements, electronic signature). A product id in the pasted link resolves the listing and its seller.
2. A moderator hides or removes the listing. One strike per case, applied once (`ip_cases.strike_applied_at`). The seller is emailed with the case reference and counter-notice instructions.
3. At the threshold the seller is flagged (`ip_repeat_infringer`, flagged-at timestamp). The flag is sticky; a moderator clears it (`POST /api/ip-cases/repeat-infringers/:userId/clear`). Suspension stays a moderator decision through the existing account actions.
4. Counter-notice: the seller files `POST /api/ip-cases/seller/:reference/counter-notice` (or a moderator records an emailed one). A moderator then reinstates (listing restored, that case's strike removed) or upholds. The seller is emailed the outcome. Every step is in `ip_case_audit_history`.

## Migration

`lib/db/migrations/231_ip_takedown_repeat_infringer.sql` (idempotent) with matching drizzle schema in `lib/db/src/schema/index.ts`. Applied on top of the drizzle base schema in a scratch Postgres 16 and re-applied by the test harness.

## Tests

- `lib/__tests__/ipEnforcement.test.ts` (strike and counter-notice rules, intake validation)
- `routes/__tests__/ip-takedown.integration.test.ts` (intake, takedown, strikes, auto-flag, counter-notice, reinstate, uphold, access control)
- `routes/__tests__/ugc-block-browse-sla.integration.test.ts` (block across browse endpoints both ways, cache headers, report to queue with due-by and overdue count)
- `routes/__tests__/ipNoticePage.test.ts`
- mobile: `lib/__tests__/reportSla.test.ts`, extended `feedPostsCache.test.ts`
- `artifacts/mobile/tests/text-fit.web.mjs`: Playwright check (393x852) flagging clipped or ellipsised text, boxes leaving their parent, horizontal page scroll, unequal buttons in a row, button padding under 12px. Run on the notice page: pass.

## Owner actions

- Set `legal@brandthread.app` mailbox live (used on the notice page and seller emails) and, optionally, `IP_REPEAT_INFRINGER_STRIKES`.
- Email uses the existing Resend config (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`); without it the seller notification is logged as not sent and the takedown still completes.
- Have counsel review the notice wording and the designated-agent details (DMCA agent registration with the US Copyright Office is an owner task).
- Add the public URL `https://<api-domain>/legal/ip-notice` to App Store Connect support or review notes.

## Not verified

- The admin SLA text on the React Native queue card and the portal "Seller standing" block were type-checked but not screenshotted: the web preview needs Clerk and a moderator session that this sandbox does not have.
- No seller-facing in-app screen for filing a counter-notice exists; the API and email instructions do. Adding a screen would be new UI and was left out per the minimal-UI rule.
