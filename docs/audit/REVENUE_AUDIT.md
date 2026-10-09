# Revenue audit: what blocks $50k/month

> Report only. No app code was changed. Every finding was found by reading code on `origin/dev` at `409ddcdc` (2026-10-09). File:line references are to that commit. Nothing was run on a physical device or in an App Store sandbox, so findings that depend on device behaviour say "verify". The machine-readable list is [`revenue_findings.json`](./revenue_findings.json): **501 findings, 63 P0 / 181 P1 / 170 P2 / 87 P3**. Duplicates across areas were merged; the merged entry keeps every file reference.

## Verdict

As of `409ddcdc`, Brandthread cannot reach $50k a month, and on the default build it may not get through App Review at all. That is not because features are missing; it has more seller tooling than Depop. It is because several money paths are wired backwards:
- **No seller ever pays.** Onboarding shows a "5-day free trial" and then goes straight to the dashboard without opening the paywall. A seller with no subscription is treated as Starter, and nothing on the server requires a paid plan to sell. If the native paywall is opened directly, it may still fail to load prices on a fresh install because of a RevenueCat `logOut()` call (verify on device).
- **Platform rewards and seller-issued gift cards can be cashed out as real money.** Thread Cash from daily check-ins, streak bonuses and referrals can be cashed out through Stripe 1:1. Seller-issued gift cards that nobody paid for are paid out of Brandthread's balance. Peer transfers are on by default, which opens an alt-account farm worth about $1,500 per seller per month.
- **AI credits are priced 5–20× below what OpenAI charges.** Several image endpoints are free, can be called by buyers, or skip the credit charge with a trailing slash. One abusive free account can cost more than the whole revenue target.
- **Buyers are stopped at the moments that matter.** Guests are sent to sign-in on their first product tap. Every shared product link opens the seller's admin screen. Hosted checkout returns to `mobile://`, which the app doesn't handle, so buyers who paid see "Payment cancelled". One-size products can't be added to cart.
- **Every off-app link is dead in production.** That covers universal links, `/l` short links, `/bio`, `/g` and store subdomains.
- **App Review risks.** Boost and Featured Discover slots are bought through Stripe inside the iOS app by default (guideline 3.1.1). The "5-day" trial isn't a length App Store Connect offers. In-app calls are simulated. The legal pages still contain placeholders.

Fix the about 25 items below in the next three weeks and the business model works on paper. You need about 800 paying sellers and about $850k of sales a month at a 5% commission (math in [§ Pricing](#pricing-and-the-math-to-50kmonth)). Ship as-is and Brandthread pays sellers to use it.

## Top 25, ranked by dollar impact

| # | ID | Finding | Why it's worth this much | P | Effort |
|---|---|---|---|---|---|
| 1 | [BT-001](#bt-001) | Onboarding never opens the paywall: the plan step only saves a choice, then goes to the dashboard. No trial and no card on file. | 100% of subscription revenue. 0 trials means 0 conversions. | P0 | S |
| 2 | [BT-002](#bt-002) | No server route requires a paid plan. An unpaid or cancelled seller is treated as `starter` (`nativeEntitlements.ts:225`) and can sell indefinitely. | Removes the reason to convert or stay. Roughly $8–15k/mo of Starter MRR. | P0 | M |
| 3 | [BT-054](#bt-054) | The managed Stripe webhook subscription (`ensureWebhookEvents.ts:22`) leaves out `payment_intent.*`. In-app orders are only created on `payment_intent.succeeded`. | Buyers are charged and no order is created. 100% of in-app GMV unless someone adds the events in the Dashboard by hand. | P0 | S |
| 4 | [BT-003](#bt-003) | `Purchases.logOut()` runs before `logIn` on every session (`revenueCat.native.tsx:111`). It throws for anonymous users, so offerings never load (verify on device). | All native subscription revenue; iOS is the main channel. | P0 | S |
| 5 | [BT-358](#bt-358) | No iOS build has ever been configured: no EAS `projectId`, placeholder submit IDs, and the widget extension isn't declared. | Push and OTA updates don't work, and the first build will break days before Oct 31. Blocks all revenue. | P0 | M |
| 6 | [BT-251](#bt-251) | Hosted checkout returns to `mobile://` (`lib/api.ts:1780,1891`) but the app scheme is `brandthread`. Paid buyers see "Payment cancelled", and the other stores in a multi-store cart are never charged. | All guest, pre-order and Thread Cash orders: an estimated 30–50% of launch GMV. | P0 | M |
| 7 | [BT-205](#bt-205) + [BT-252](#bt-252) | A product with no size or colour is saved with zero variants and no price, and the buyer product page needs at least one option before adding to cart. | Every simple listing is unbuyable; estimated at 30–50% of first listings. | P0 | S |
| 8 | [BT-105](#bt-105) | Cash-out pays 1:1 against the whole Thread Cash balance, including check-in, streak and referral credit (`lib/threadCash/cashOut.ts:90-112`). | Unlimited real-money loss. | P0 | M |
| 9 | [BT-053](#bt-053) | Seller-issued gift cards (up to $1,000, unpaid) are paid to the seller from Brandthread's balance on redemption (`lib/giftCards/payout.ts:32`). | Unlimited: one seller plus an alt account drains $10k with 10 cards. | P0 | S |
| 10 | [BT-106](#bt-106) + [BT-111](#bt-111) | Alt accounts → $10 referral credit with no purchase → peer send (on by default, no legal sign-off) → seller cash-out. | About $1,500/mo per abusing seller; 10 abusers is 30% of the target. | P0 | M |
| 11 | [BT-112](#bt-112) | Thread Cash as designed: 10¢/day plus a $1 bonus every 7 days, with no budget, expiry or redemption cap. | About $25–41k/mo at 20k MAU, half the revenue target. | P0 | M |
| 12 | [BT-155](#bt-155) + [BT-161](#bt-161) + [BT-162](#bt-162) | Free gpt-image-1 logo generation at `/api/onboarding-sample/generate`. `/store/ai/*` sends unbounded input to gpt-4.1 with no plan gate. Support chat is outside the AI daily ceiling. | $15–73k/mo from one abusive free or buyer account. | P0 | S |
| 13 | [BT-156](#bt-156) + [BT-157](#bt-157) | The credit catalogue assumes 1 credit is about $0.01, but image tools cost $0.19–0.39 per call, and Mockup-to-Model charges 8 credits for up to 10 generations. | Growth's 4,000 credits can cost $380–780 against a $79 plan. Every plan and every credit pack loses money. | P0 | S |
| 14 | [BT-160](#bt-160) | Trials and `past_due` get the full allowance on day one; a Pro trial is unlimited. | Burn and cancel: about $500 per abuser. | P0 | M |
| 15 | [BT-005](#bt-005) + [BT-006](#bt-006) + [BT-360](#bt-360) + [BT-361](#bt-361) | Boost, Create-ad and Featured slots use Stripe inside the iOS app by default, and the reviewer-notes template admits it. | 3.1.1 rejection, so launch slips. About $12k per week of slip at target. | P0 | S |
| 16 | [BT-004](#bt-004) | "5-day" trial is hard-coded. App Store intro offers come in 3 days, 1 week, 2 weeks and up, not 5 days. | Misstated-trial rejection under 3.1.2, plus refunds. | P0 | S |
| 17 | [BT-357](#bt-357) | DM voice and video calls are simulated in production and auto-"connect" after 2.2s with no audio, and the review notes tell reviewers to try them. | 2.1 rejection. | P0 | S |
| 18 | [BT-249](#bt-249) + [BT-250](#bt-250) | `/thread-checkout` and `/thread-product-detail` are not on the guest route list. Guests are sent to sign-in on the first product tap and at checkout. | Estimated $5–10k/mo of guest GMV, plus a 5.1.1(v) risk. | P0 | S |
| 19 | [BT-253](#bt-253) | Shared product links open `/product-detail`, the seller's 8-tab admin screen. | Every share, ad, bio tile and email link dead-ends. Estimated $3–8k/mo. | P0 | S |
| 20 | [BT-301](#bt-301) + [BT-302](#bt-302) | The API only claims `/api`, so `/.well-known`, `/l`, `/bio`, `/g` and `/u` go to the web app. Universal links never verify. | All off-app acquisition is dead. Estimated $5–10k/mo. | P0 | S |
| 21 | [BT-108](#bt-108) | In the default `PAYOUT_MODE=hold`, the Thread Cash top-up never runs (`checkoutTopup.ts:39`), so the seller pays for the buyer's credit. | Sellers lose up to 100% of the order on credit-funded sales once checkout credit is switched on. | P0 | M |
| 22 | [BT-056](#bt-056) | The Shippo webhook isn't authenticated when `SHIPPO_WEBHOOK_SECRET` is unset. A fake "DELIVERED" scan releases the payout, and on a return label it refunds the buyer. | Order value plus $15 per fraud event. A ring could take $5–20k/mo. | P0 | S |
| 23 | [BT-451](#bt-451) | Autoscale deployment plus 25 in-process `setInterval` jobs: the money sweep runs twice, or not at all when no instance is running. | Double transfers, or missed trial-end reminders and refunds. | P0 | M |
| 24 | [BT-163](#bt-163) | gpt-image-1 is hard-coded, and the repo's own note says it retires Oct 23, 2026 (`aiImageProviders/config.ts:72`). | Every AI image tool, the main Growth upsell, breaks a week before launch. | P0 | S |
| 25 | [BT-362](#bt-362) + [BT-363](#bt-363) | Legal pages have `[LEGAL ENTITY NAME]` and `IS_DRAFT=true` and say "Brandthread, Inc." instead of Dev's LLC. Deleting an Apple or Google sign-in account depends on Resend and Apple's private relay. | Rejection, and the wrong merchant entity on every receipt. | P0 | S |

**Next 10 (P0/P1, still five figures a year each):** [BT-206](#bt-206) products can go live before Stripe Connect is set up · [BT-058](#bt-058) Growth/Pro commission is 4%/3% against the flat 5% · [BT-310](#bt-310) affiliate commissions are paid from Brandthread's balance · [BT-063](#bt-063) auto-refund is the default when no delivery signal arrives · [BT-057](#bt-057) refund fees go to a "seller owes" row that is never collected · [BT-067](#bt-067) marketplace-facilitator sales tax isn't collected · [BT-449](#bt-449) + [BT-450](#bt-450) no analytics key and no trial or paywall events · [BT-398](#bt-398) the Starter dashboard always fails · [BT-306](#bt-306) buyers have no way into the referral screen · [BT-446](#bt-446) freelancers can mark their own jobs complete and get paid.

## Apple: what will be rejected, and what Apple takes

| Purchase in the iOS app | Rail on `dev` today | Apple's position | Apple's cut |
|---|---|---|---|
| Physical goods checkout (cart, guest, drops, pre-orders, live) | Stripe PaymentSheet / Apple Pay / hosted Checkout | Exempt: goods consumed outside the app (3.1.3(e) / 3.1.5(a)). Must **not** use IAP. | 0% |
| Store gift cards (redeemable for physical goods) | Stripe | Exempt as physical-goods credit. | 0% |
| Samples / bulk manufacturing orders | Stripe Connect | Exempt (physical goods). | 0% |
| **Seller subscription (Starter/Growth/Pro)** | RevenueCat IAP on native, Stripe on web | Digital service unlocked in-app, so it **must be IAP** (3.1.1). Native already is. A web subscription is honoured in-app under 3.1.3(b). | **15%** if Dev enrolls in the Small Business Program (under $1M/yr), otherwise 30% in year 1 and 15% after a year of continuous subscription. |
| AI credit packs | RevenueCat consumables native, Stripe web | Must be IAP: already done. | 15% / 30% |
| **Boost, Create-ad** | Stripe unless `EXPO_PUBLIC_IAP_PROMOTIONS=1` **and** `IAP_PROMOTIONS_ENABLED` are set and 14 IAP products exist ([BT-005](#bt-005), [BT-006](#bt-006)) | Digital promotion, so IAP is required. **Will be rejected** on the default build. | 15% / 30%, and today the full face value is granted, so Apple's cut comes out of Brandthread's margin ([BT-022](#bt-022)). |
| **Featured on Discover slots ($29/$59/$99)** | Stripe only, no IAP path ([BT-360](#bt-360)) | **Will be rejected.** | 15% / 30% once moved to IAP |
| Freelancer design jobs | Stripe escrow | Gray zone: 3.1.3(d) covers person-to-person services, but deliverables are digital files. Disclose in the review notes. | 0% if accepted |
| Mobile App Builder | Dead "Pro" CTA ([BT-408](#bt-408)) | 2.1 completeness: hide it. | n/a |

**Other rejection risks:**
- "5-day" trial copy ([BT-004](#bt-004)): use 1 week on iOS, or 3 days.
- Simulated calls ([BT-357](#bt-357)).
- Giveaway rules missing "Apple is not a sponsor" (5.3, [BT-415](#bt-415)).
- Thread Cash pays for time in the app (3.2.2(x), [BT-385](#bt-385)).
- Thread Cash copy says it can't be cashed out, while the code lets it be cashed out ([BT-121](#bt-121)).
- The account deletion path ([BT-363](#bt-363), [BT-367](#bt-367), [BT-368](#bt-368)).
- iPad layouts are untested ([BT-364](#bt-364)).

**The cheapest legal setup:** keep IAP for subscriptions and credit packs, and enroll in the Small Business Program before submission. On the **US storefront only**, also add a "Subscribe on the web" link to Stripe Checkout. Since the April 2025 *Epic v. Apple* injunction, Apple charges no commission on those linked-out purchases while a court sets a rate (the Supreme Court took a related contempt question in mid-2026). Re-check the guideline text the week you submit. Outside the US, IAP stays mandatory and steering is not allowed.

## Status of every money path

| Path | Status on `dev` | Key findings |
|---|---|---|
| Seller paywall | Built (`plans.tsx`), never shown in onboarding; native offerings likely fail to load | [BT-001](#bt-001), [BT-003](#bt-003) |
| Trial (card-required, auto-convert) | Apple and Stripe handle the conversion, but a seller who doesn't convert keeps Starter. Stripe gives a fresh trial on every checkout. | [BT-002](#bt-002), [BT-004](#bt-004), [BT-160](#bt-160) |
| Upgrade / downgrade | Upgrading on a different rail (web vs app) bills twice; Android is missing `googleProductChangeInfo` | see the Subscriptions section |
| Failed-payment dunning | `invoice.payment_failed` handler broken by the pinned Stripe API version; `past_due` keeps full access with no time limit | [BT-010](#bt-010), [BT-011](#bt-011) |
| Cancel / win-back | None | [BT-015](#bt-015), [BT-406](#bt-406) |
| 5% commission | Wired through the application fee and hold-mode transfers. Growth is cut to 4% and Pro to 3%. Shipping is excluded and can be used to bypass the fee. Gift cards and wallet-funded bulk orders take nothing. | [BT-058](#bt-058), [BT-059](#bt-059), [BT-075](#bt-075) |
| Payouts | `PAYOUT_MODE=hold` by default, which makes Brandthread the merchant of record. No Connect webhook endpoint; `payout.failed` is silent | [BT-061](#bt-061), [BT-069](#bt-069), [BT-403](#bt-403) |
| Refunds | `refundOrder` is sound. Auto-refund runs at 15/60 days when no delivery signal arrives. The Stripe fee goes to a "seller owes" row that is never collected. | [BT-063](#bt-063), [BT-057](#bt-057), [BT-064](#bt-064) |
| Chargebacks | Recorded. The $15 fee isn't modelled; already-paid-out orders aren't clawed back; B2B disputes don't reverse the manufacturer transfer | [BT-073](#bt-073), [BT-446](#bt-446) |
| Thread Cash | Earning is live and spending is behind a flag that is off by default, so a liability builds up. It can be cashed out, is not on the ledger, and has no server-side kill switch. | [BT-105](#bt-105), [BT-123](#bt-123), [BT-125](#bt-125), [BT-131](#bt-131) |
| Business analytics | PostHog is wired but has no key set; there are no trial or paywall events; the admin revenue page leaves out MRR | [BT-449](#bt-449), [BT-450](#bt-450), [BT-447](#bt-447) |

## Funnels in numbers

- **Seller, from cold install to first listing:** about 15 screens and 40 taps: splash → 13-step onboarding → dashboard → add product. The listing it produces is unbuyable if it has no options. To being able to receive money: **about 25 screens and 75 taps**, including Stripe Express in a browser. Payouts come *last* in the launch checklist, after Publish ([BT-208](#bt-208), [BT-206](#bt-206)).
- **Buyer, from cold open to paid order:** about **17 taps plus about 6 seconds of forced animation**. Twelve of those taps (splash, 6 onboarding screens, the explainer) come before the first product. "Browse as guest" takes 1 tap, then hits a sign-in wall on the first product ([BT-250](#bt-250)).
- **Push:** the onboarding soft-ask "Continue" never actually asks for permission ([BT-268](#bt-268)). So the 1-hour abandoned-cart push, which is fully built, reaches almost no first-time buyers.

## Pricing and the math to $50k/month

**What competitors charge (2026):**

| Platform | Monthly | Commission | Processing |
|---|---|---|---|
| Shopify | Basic $39 · Grow $105 · Advanced $399 (monthly billing; $29/$79/$299 annual) | 0% with Shopify Payments | 2.9%/2.7%/2.5% + 30¢ |
| Etsy | $0 (Etsy Plus $10 optional) | 6.5% of item + shipping, $0.20 per listing, 12–15% Offsite Ads | 3% + 25¢ |
| Depop (US) | $0 | 0% seller fee since 2024; buyers pay up to 5% + $1; Boost 8–12% | 3.3% + 45¢ |
| Whatnot | $0 | 8% of item | 2.9% + 30¢ |
| TikTok Shop | $0 | 6% (reports of 8% from Aug 2026), plus creator commissions of 10–30% | Included / about 2% |

With 5% commission plus processing, Brandthread's take is close to Etsy's, and the seller also pays a subscription Etsy doesn't charge. The brand stage of a typical new Brandthread seller (idea or first drop) matches Depop and TikTok sellers who pay $0 a month. The code's current **$29 / $79 / $199** (`planCatalogue.ts:17-31`) is Shopify money without Shopify's ecosystem. Recommendation:

| Tier (brand stage) | Price | Unlocks, mapped to real features in the code |
|---|---|---|
| **Launch** ("just starting / first drop") | **$19/mo** | Storefront and store builder, up to 50 products, checkout and payouts, Shippo labels, discounts, giveaways, link-in-bio and short links, basic analytics, 300 re-priced AI credits (about $3 of provider cost), 1 seat. |
| **Growth** ("selling regularly") | **$49/mo** | Unlimited products, drops and pre-orders with the drop wallet, email marketing (capped sends) and push broadcasts, Boost and Featured slots *eligible to buy*, Manufacturer Hub and RFQ, live selling, advanced analytics, custom domain, Shopify import, 1,500 AI credits (about $8 cost), 3 seats. |
| **Pro** ("scaling brand") | **$129/mo** | Everything in Growth, plus unlimited seats and roles, priority Discover placement, 5,000 AI credits (about $20 cost, **never "unlimited"**), Meta Ads, bulk tools, white-glove setup. |

Rules that go with this:
1. Commission is **a flat 5% on every tier**, as Dev decided. Delete the 4%/3% perks in `planPerks.ts:19-22`, or swap them for included boosts.
2. Charge commission on item **plus shipping** (like Etsy) so the shipping bypass closes ([BT-059](#bt-059)).
3. Keep AI provider cost under 20% of each tier's price.
4. The trial should be **7 days** on every rail, so the copy is the same on iOS and web.
5. Never "unlimited" anything that calls OpenAI.

**Assumptions:**
- Tier mix: 60% Launch / 30% Growth / 10% Pro. That gives an average of **$39.00** per paying seller.
- Half of subscriptions bought through Apple IAP at 15% (Small Business Program) and half on web through Stripe (2.9% + 30¢ + 0.7% Billing). That nets **$35.22 per seller**.
- Net commission rate = 5% − 0.25% refunds (5% refund rate × the 5% fee returned) − 0.25% Connect payout fee − 0.10% disputes − **1.0% Thread Cash budget** (redemption capped at 20% of the take) = **3.4% of GMV**.
- Connect costs $2 per active account plus about 4 payouts × 25¢, about $3 per active seller.
- AI provider cost averages $5.30 per paying seller after re-pricing.
- Stripe card processing on orders is passed through to the seller, as `fees.ts` already does.

| Scenario | Paying sellers | Sales (GMV)/mo | GMV per seller | Subs gross → net of Apple/Stripe | 5% commission gross → net of refunds, payouts, disputes and Thread Cash | − Connect | − AI cost | **Net to Brandthread** |
|---|---|---|---|---|---|---|---|---|
| A: subscription-led | 1,000 (700 active) | $650k | $650 | $39,000 → $35,223 | $32,500 → $22,100 | −$2,100 | −$5,300 | **$49,923** |
| B: balanced (target) | 800 (600 active) | $850k | $1,063 | $31,200 → $28,178 | $42,500 → $28,900 | −$1,800 | −$4,240 | **$51,038** |
| C: GMV-led | 500 (400 active) | $1.1M | $2,200 | $19,500 → $17,611 | $55,000 → $37,400 | −$1,200 | −$2,650 | **$51,161** |

**How sensitive this is:**
- If every subscription goes through IAP without the Small Business Program (30%), net per seller drops from $35.22 to $27.30. In scenario B that costs about $6.3k a month.
- Thread Cash **as built today** costs about $25–41k a month at 20k MAU ([BT-112](#bt-112)). Covering it would take roughly another $750k–1.2M of GMV at 3.4% net. The $50k target is not reachable until Thread Cash has a budget tied to GMV, is not cashable, and expires.
- Reaching 800 paying sellers at 5% monthly churn means about 40 net-new paying sellers a month once you are there. At a 40% card-on-file trial-to-paid rate, that is about 100 trials a month. Today it is **0**, because of #1.

These numbers are net revenue *before* hosting, Shippo margin, support and payroll.

## Accounts and keys Dev has to create before launch

Each of these is referenced by a finding below. The code is flagged off or degrades when the key is missing, unless the finding says it crashes.

| What | Env / config | Where to sign up | Finding |
|---|---|---|---|
| Stripe (new account under the LLC), plus the `payment_intent.*`, Connect and Radar webhook events | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, a Connect webhook secret (not yet in code), `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com | [BT-054](#bt-054), [BT-069](#bt-069) |
| Apple Pay merchant ID on the new Stripe account | `app.json` merchantIdentifier + Stripe Apple Pay certificate | developer.apple.com → Identifiers; Stripe → Apple Pay | [BT-271](#bt-271) |
| RevenueCat project, App Store subscription and consumable products, Small Business Program | `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, RevenueCat webhook | app.revenuecat.com, appstoreconnect.apple.com, developer.apple.com/app-store/small-business-program | [BT-003](#bt-003) |
| IAP promotion products (Boost / Ads / Featured) | `EXPO_PUBLIC_IAP_PROMOTIONS=1`, `IAP_PROMOTIONS_ENABLED=true` | App Store Connect | [BT-005](#bt-005) |
| EAS project and submit IDs | `extra.eas.projectId`, `eas.json` `ascAppId` / `appleTeamId` | expo.dev | [BT-358](#bt-358) |
| Universal links | `APPLE_TEAM_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS` | developer.apple.com, Play Console | [BT-302](#bt-302) |
| Shippo webhook auth | `SHIPPO_WEBHOOK_SECRET` | goshippo.com → API → Webhooks | [BT-056](#bt-056) |
| Resend (email codes, deletion codes, marketing) on separate sending domains | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | resend.com; add the domain to Apple's private email relay | [BT-363](#bt-363) |
| PostHog | `EXPO_PUBLIC_POSTHOG_KEY` | posthog.com | [BT-449](#bt-449) |
| Sentry | `EXPO_PUBLIC_SENTRY_DSN` | sentry.io | [BT-375](#bt-375) |
| Agora (live) | `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | console.agora.io | [BT-376](#bt-376), [BT-192](#bt-192) |
| Google Places (address autocomplete) | `GOOGLE_PLACES_API_KEY` | console.cloud.google.com | [BT-172](#bt-172) |
| Affiliate payouts (leave **off** until [BT-310](#bt-310) is fixed) | `AFFILIATE_PAYOUTS_ENABLED` | n/a | [BT-310](#bt-310) |

## Method and limits

- **How the audit ran.** Ten read-only passes, one per area: subscriptions/IAP, Connect/refunds, Thread Cash and incentives, AI cost, seller funnel, buyer funnel, growth loops, launch blockers, seller tools, and web/manufacturer/admin. They covered all 357 files in `artifacts/mobile/app`, about 160 API route files, `src/lib/money`, `src/jobs`, `lib/db` migrations, the manufacturer portal and `docs/`.
- **Duplicates.** Where two areas found the same bug, the entries were merged.
- **Dollar figures.** These are order-of-magnitude estimates at the $50k target scale (about $1M GMV, about 800 sellers, about 20k MAU), not forecasts.
- **What "verify" means.** Items marked "verify" depend on a device, the App Store sandbox, or third-party pricing that couldn't be checked from the repo.
- **On the "1,000 things".** The audit found 501 real, specific items. It didn't pad the list to 1,000 with generic advice. The top 25 account for most of the dollar impact.
- **Additive fixes only.** Every fix is written to follow Dev's additive-only rule: allow-list entries, server checks, new rows, CTAs or nudges, not restyles. Where a fix has to touch an existing screen, the finding says so.

**Sources (pricing and Apple):** [Shopify pricing, NerdWallet](https://www.nerdwallet.com/article/small-business/shopify-pricing) · [Shopify pricing, WebsiteBuilderExpert](https://www.websitebuilderexpert.com/ecommerce-website-builders/shopify-pricing/) · [Etsy fees, Craftybase](https://app.craftybase.com/blog/the-complete-guide-to-etsy-fees) · [Etsy fees, Gelato](https://www.gelato.com/blog/etsy-fees) · [Depop fees, OneCart](https://www.getonecart.com/depop-fees/) · [Depop fee calculator, Size.ly](https://www.size.ly/tools/depop-fee-calculator) · [Whatnot fees, OneCart](https://www.getonecart.com/tools/whatnot-fee-calculator/) · [Whatnot fees, Underpriced](https://www.underpriced.app/blog/whatnot-seller-fees-2026) · [TikTok Shop fees, OneCart](https://getonecart.com/tiktok-shop-seller-fees/) · [TikTok Shop 8% report, beBOLD](https://www.bebolddigital.com/news/tiktok-shop-8-percent-referral-fee) · [Stripe fees for marketplaces, DropDesk](https://drop-desk.com/blog/guides/stripe-fees-for-marketplace-operators/) · [Stripe Connect fees, NerdWallet](https://www.nerdwallet.com/business/software/learn/stripe-fees) · [US external purchase links, RevenueCat](https://www.revenuecat.com/blog/growth/apple-anti-steering-ruling-monetization-strategy) · [Linked-out commission litigation, Courthouse News](https://www.courthousenews.com/apples-fight-over-commissions-for-linked-out-app-store-purchases-continues-in-federal-court/) · [iOS external payments cost 2026, Tiun](https://tiun.io/blog/ios-external-payments-us-cost-2026) · [Apple 10-Q FY2026](https://www.sec.gov/Archives/edgar/data/0000320193/000032019326000020/aapl-20260627.htm). Confirm third-party fee numbers on each platform's official page before quoting them to sellers.

---

# Every finding

## Subscriptions & Apple IAP

52 findings: 6 P0 · 11 P1 · 24 P2 · 11 P3

<a id="bt-001"></a>
### BT-001 · P0 · effort S · Seller onboarding never shows a paywall: the plan step only stores a choice, then opens the dashboard

- **Where:** onboarding · `artifacts/mobile/app/onboarding.tsx:2772-2780,artifacts/mobile/app/onboarding.tsx:2424-2440,artifacts/mobile/components/onboarding/SellerPlanRecommendationStep.tsx:80-86; artifacts/mobile/app/plans.tsx:103-104,202,260,308,artifacts/mobile/app/_layout.tsx:957-968`
- **Problem:** The seller PLAN step (SellerPlanRecommendationStep) only calls setSelectedPlanId and goNext(). Its own copy says 'No charge is made on this step'. finishSeller() then writes onboarding_complete=true and router.replace('/(tabs)/'). Nothing in the codebase opens /plans?fromOnboarding=true (grep 'fromOnboarding' finds only plans.tsx:103), so the 5-day card-required trial is never started. app/_layout.tsx:958-961 still has a comment saying onboarding_complete is 'only written by plans.tsx after plan selection', so this looks like a regression.
- **Why it costs money:** Every new seller lands in a working store without ever seeing a purchase sheet. Subscription conversion only happens if a seller later goes looking for Settings > Subscription on their own.
- **Fix:** In finishSeller, router.replace('/plans?fromOnboarding=true') instead of '/(tabs)/', and only write ONBOARDING_KEY in plans.tsx after a purchase or an explicit 'Not now'. Pass onboarding_selected_plan as the preselected plan (already read at plans.tsx:149-161).
- **$ impact:** Blocks nearly all subscription revenue: with a card-required trial typically converting 30-60% of the sellers who see it, against ~0% for sellers who never see it, this is most of the subscription share of the $50k/mo target

<a id="bt-002"></a>
### BT-002 · P0 · effort M · No server route requires a paid plan to sell: an unpaid seller gets everything Starter promises

- **Where:** server · `artifacts/api-server/src/lib/nativeEntitlements.ts:225,artifacts/api-server/src/middlewares/requireAuth.ts:87-93,artifacts/api-server/src/routes/index.ts:233-244`
- **Problem:** resolveEffectiveEntitlement returns planId 'starter' for a seller with no subscription (provider 'none'). requirePlan is only ever called with 'growth' or 'pro' (grep finds index.ts:239-244,385, analytics.ts:624,676, live.ts:48, live-commerce.ts:29, manufacturers.ts:77, analytics-insights.ts:546, iap-promotions.ts:98). Storefront, products (up to 25), checkout, orders and payouts are not gated at all. handleSubscriptionDeleted even calls Starter 'the free Starter plan' (webhooks.ts:1659-1669).
- **Why it costs money:** The $29 Starter tier is in effect a free tier, so any seller who skips or cancels the paywall keeps selling and only pays the commission. That removes the reason to buy the entry plan.
- **Fix:** Choose the free-tier policy explicitly. Either require an active or trialing entitlement (provider != 'none') to publish a store or receive orders (add requirePlan('starter') with a provider check to store publish, products create, and the checkout-intent seller eligibility check), or rename the unpaid state to 'Free' with tighter limits (for example 5 products) and price Starter on what it adds.
- **$ impact:** Blocks Starter revenue: e.g. 300 sellers x $29 = ~$8.7k/mo that unpaid sellers currently get for free

<a id="bt-003"></a>
### BT-003 · P0 · effort S · Native RevenueCat identity flow calls logOut() on an anonymous user, which throws, so offerings never load

- **Where:** plans · `artifacts/mobile/lib/revenueCat.native.tsx:109-113,artifacts/mobile/lib/revenueCat.native.tsx:128,artifacts/mobile/lib/revenueCatSession.ts:24-30`
- **Problem:** After Purchases.configure() with no appUserID the SDK customer is anonymous. The identity effect always runs `await Purchases.logOut()` before logIn(clerkId). Per RevenueCat SDK docs, logOut on an anonymous user throws LOGOUT_CALLED_WITH_ANONYMOUS_USER. The identity queue re-throws the error, the catch at line 128 swallows it, and getOfferings and setPackages never run. With packages=[] the paywall shows 'Subscriptions are temporarily unavailable' (plans.tsx:252-253) and the CTA is disabled after 6s (pricesFailed, plans.tsx:136). No test covers anonymous logOut.
- **Why it costs money:** On a fresh install the iOS and Android paywall may never be able to sell a subscription. Every native purchase depends on this code path.
- **Fix:** Call `if (!(await Purchases.isAnonymous())) await Purchases.logOut()`, or wrap logOut in try/catch, then logIn. Better still, pass appUserID: clerkId to configure() once signed in. Verify with a sandbox purchase on a clean install before submitting.
- **$ impact:** Blocks all native subscription revenue if confirmed on device (iOS is expected to be the main channel)

<a id="bt-004"></a>
### BT-004 · P0 · effort S · 5-day free trial is not a duration App Store Connect offers; paywall and onboarding copy hard-code '5-day'

- **Where:** plans · `artifacts/mobile/app/plans.tsx:89-93,artifacts/mobile/app/plans.tsx:453-465,artifacts/mobile/components/onboarding/SellerPlanRecommendationStep.tsx:34-35,artifacts/mobile/components/paywall/SellerPaywallExitDrawer.tsx:124,artifacts/api-server/src/jobs/sellerTrialReminder.ts:108-117`
- **Problem:** Apple introductory free-trial durations are 3 days, 1 week, 2 weeks, 1 month and longer. 5 days cannot be configured. The native CTA still says 'Start my 5-day free trial' with 'Free for 5 days, then X/month' and a Day 4 / Day 5 timeline whenever the store returns any introPrice. The real period is never read from introPrice.periodNumberOfUnits/periodUnit. The day-4 reminder logic (isDayFourOfFive) also assumes exactly 5 days.
- **Why it costs money:** A paywall that states a trial length different from the one StoreKit actually charges is a 3.1.2 / 2.3.1 rejection risk on first review, and a source of refund requests and chargebacks after launch.
- **Fix:** Choose a 1-week (or 3-day) iOS intro offer. Render the trial length from pkg.product.introPrice (periodNumberOfUnits + periodUnit), and drive the timeline and reminder day from that value instead of constants. Keep Stripe/web trial_period_days in sync, or make it configurable.
- **$ impact:** Blocks launch if rejected; misstated trials also add refund losses of a few % of subscription revenue

<a id="bt-005"></a>
### BT-005 · P0 · effort M · Boost buys a digital feature through Stripe inside the iOS app by default (IAP rail flagged off)

- **Where:** boost · `artifacts/mobile/app/boost.tsx:456-458,artifacts/mobile/app/boost.tsx:774-787,artifacts/mobile/app/boost.tsx:1176-1178,artifacts/mobile/lib/iapPromotions.ts:37-42,artifacts/api-server/src/routes/boosts.ts:584`
- **Problem:** nativePromotionsEnabled() is true only when EXPO_PUBLIC_IAP_PROMOTIONS=1 is baked into the build. eas.json sets no such env and docs/app-store/release-flow.md:83-91 does not list it. With the flag unset, iOS opens Stripe Checkout through WebBrowser.openAuthSessionAsync and shows 'Secure payment via Stripe'. The server side also needs IAP_PROMOTIONS_ENABLED=true (lib/iapPromotions.ts:59). docs/review-readiness/iap-rails.md marks this 'FIXED (flagged OFF)', but the shipped default is non-compliant.
- **Why it costs money:** Paid post reach is a digital service consumed in the app. Guideline 3.1.1 requires IAP, so a reviewer who reaches Boost rejects the build. In the US storefront only a link out is allowed, not an in-app Stripe sheet.
- **Fix:** Create the 7 brandthread_boost_* consumables in App Store Connect, Play and RevenueCat. Set EXPO_PUBLIC_IAP_PROMOTIONS=1 in the EAS production environment and IAP_PROMOTIONS_ENABLED=true on the API, and add both to release-flow.md. Alternatively hide Boost on native until that is done.
- **$ impact:** Blocks launch (rejection) if a reviewer opens Boost; boost revenue itself is small at launch (<$1k/mo)

<a id="bt-006"></a>
### BT-006 · P0 · effort M · Create-ad (Brandthread Ads) also uses Stripe on native by default

- **Where:** design-campaign · `artifacts/mobile/app/design-campaign.tsx:255-256,artifacts/mobile/app/design-campaign.tsx:597-604,artifacts/api-server/src/routes/ad-campaigns.ts:455,artifacts/api-server/src/routes/ad-campaigns.ts:559`
- **Problem:** This uses the same EXPO_PUBLIC_IAP_PROMOTIONS gate as Boost. Off by default, the native app creates a Stripe Checkout Session for an in-app ad placement and opens it in an auth session. ad-campaigns /:id/pay has no plan gate, so every seller sees this path.
- **Why it costs money:** An in-app ad placement is a digital service, so this is a 3.1.1 rejection. It is more likely to be found than Boost because no Pro plan is needed to reach it.
- **Fix:** Ship with the brandthread_ad_* consumables live and the flag on, or hide 'Create ad' on iOS until they are.
- **$ impact:** Blocks launch if found in review

<a id="bt-007"></a>
### BT-007 · P1 · effort S · Native 'Manage subscription' opens the Stripe billing portal for web-billed sellers

- **Where:** subscription · `artifacts/mobile/app/subscription.tsx:208-222,artifacts/mobile/lib/subscriptionRecovery.ts:7-13,artifacts/api-server/src/routes/subscription.ts:452-473`
- **Problem:** For effectiveProvider==='stripe', handleOpenPortal opens a Stripe Billing Portal session with Linking.openURL from inside the iOS app. Depending on the portal configuration, sellers can switch plans or pay there. The legal footer on the same screen tells them to 'Manage or cancel in your App Store account settings', which is wrong for them.
- **Why it costs money:** Outside the US storefront, an in-app link to an external purchase/upgrade surface breaks 3.1.1/3.1.3 anti-steering rules. Inside the US it is allowed after the May 2025 Epic ruling.
- **Fix:** On iOS, for Stripe-billed sellers, show 'Manage your plan at brandthread.app' as plain text outside the US storefront, and keep the button only for US. Disable plan switching in the Stripe portal configuration. Show the footer copy that matches the provider.
- **$ impact:** Review risk, not $; affects only web-subscribed sellers using iOS

<a id="bt-008"></a>
### BT-008 · P1 · effort S · A web (Stripe) subscriber who upgrades in the iOS app gets billed twice

- **Where:** subscription · `artifacts/mobile/app/subscription.tsx:182-193,artifacts/mobile/app/plans.tsx:250-258,artifacts/api-server/src/lib/nativeEntitlements.ts:203-214`
- **Problem:** On native, handleChangePlan and handleSelect always buy a RevenueCat package, even when effectiveProvider is 'stripe'. Nothing cancels the Stripe subscription. resolveEffectiveEntitlement simply prefers the higher of the two. The reverse also happens: an IAP subscriber using the web checkout gets a new Stripe subscription, because users.subscriptionId is null (subscription.ts:390-421).
- **Why it costs money:** Both rails keep billing the same seller. That leads to chargebacks (about $15 per Stripe dispute), Apple refunds and churn.
- **Fix:** If the provider is the other rail, block the purchase with 'You're billed on the web; change plans at brandthread.app' (and the reverse on web), or cancel the Stripe subscription at period end once the native entitlement is confirmed.
- **$ impact:** ~$200-500/mo in disputes and refunds once both rails have users

<a id="bt-009"></a>
### BT-009 · P1 · effort S · Android upgrades and downgrades create a second Play subscription

- **Where:** plans · `artifacts/mobile/lib/revenueCat.native.tsx:135-145`
- **Problem:** purchase() calls Purchases.purchasePackage(pkg) without googleProductChangeInfo. On Google Play, RevenueCat then starts a new concurrent subscription instead of replacing the old base plan, so a Starter seller who 'switches to Growth' pays $29 + $79.
- **Why it costs money:** Double billing leads to refunds, Play policy complaints and 1-star reviews.
- **Fix:** When customerInfo.activeSubscriptions holds a brandthread_*_monthly product, pass googleProductChangeInfo { oldProductIdentifier, prorationMode } (or the purchaseParams equivalent in SDK v9).
- **$ impact:** ~$100-400/mo in refunds and churn on Android

<a id="bt-010"></a>
### BT-010 · P1 · effort S · Stripe API version 2026-07-29.dahlia removed invoice.subscription, so payment-failed dunning never fires

- **Where:** server · `artifacts/api-server/src/lib/stripe.ts:20,artifacts/api-server/src/routes/webhooks.ts:1568-1586`
- **Problem:** handleInvoicePaymentFailed reads invoice.subscription. Since the 2025-03-31 'basil' API, that field moved to invoice.parent.subscription_details.subscription. On a new Stripe account (the new LLC) the webhook endpoint defaults to the latest API version, so the field is undefined and the handler logs 'not subscription-backed' and returns. The 'Payment failed, update your card' notification and push never go out. webhooks.trial.test.ts mocks the old shape, so tests still pass.
- **Why it costs money:** Failed renewals get no recovery prompt. Recovered involuntary churn is usually 20-40% of failed payments, and all of it is lost.
- **Fix:** Read `invoice.parent?.subscription_details?.subscription ?? invoice.subscription`. Add a fixture with the current payload shape, and pin the webhook endpoint's api_version explicitly.
- **$ impact:** ~$300-1,000/mo of recoverable failed renewals at the target scale

<a id="bt-011"></a>
### BT-011 · P1 · effort S · past_due keeps full paid access with no time limit

- **Where:** server · `artifacts/api-server/src/lib/nativeEntitlements.ts:201`
- **Problem:** stripeActive counts 'past_due' as active with no grace window. If the Stripe dashboard is set to leave subscriptions past_due after retries fail, the seller keeps Growth/Pro (including unlimited Pro AI and the 3% fee) indefinitely without paying. No past_due_since is stored.
- **Why it costs money:** Non-paying sellers keep paid features and AI spend for free.
- **Fix:** Store past_due_since in handleSubscriptionUpdated, and treat past_due as active only for 7 days. In Stripe Billing settings, set 'cancel subscription' after the final retry.
- **$ impact:** ~$200-800/mo of unpaid Growth/Pro access plus AI cost

<a id="bt-012"></a>
### BT-012 · P1 · effort M · A failed payment only ends access by dropping the seller to free Starter, which still sells

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1662-1675`
- **Problem:** When Stripe cancels after dunning, handleSubscriptionDeleted sets the plan to 'starter' and the status to 'canceled'. Because Starter is ungated (see the 'no server route requires a paid plan' finding), a seller whose card fails at trial end keeps a live store, products and checkout.
- **Why it costs money:** There is no consequence for an expired or failed card at trial end, so trials don't convert under pressure.
- **Fix:** After cancellation or expiry, move the store into a locked state: store hidden, no new orders, products kept, banner 'Reactivate your plan'. Use that lock for both rails.
- **$ impact:** Large part of trial-to-paid conversion; ~$2-5k/mo

<a id="bt-013"></a>
### BT-013 · P1 · effort S · Stripe gives a fresh 5-day trial on every checkout (no one-trial-per-seller rule)

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:415-435`
- **Problem:** subscription_data.trial_period_days: 5 is always set. A seller who cancels and re-subscribes, or opens new accounts with the same card, gets unlimited trials. users.subscriptionTrialStartedAt exists but is not checked, and the card fingerprint is not deduplicated.
- **Why it costs money:** Pro trials include unlimited AI credits (aiCredits/catalogue.ts:31) and the 3% commission rate. Repeat trials burn AI spend and delay paying forever.
- **Fix:** Omit trial_period_days when subscriptionTrialStartedAt is set or when an earlier customer with the same card fingerprint exists. Use Stripe Radar or setup-intent fingerprint checks.
- **$ impact:** ~$300-1,000/mo in AI cost and lost conversions from trial cycling

<a id="bt-014"></a>
### BT-014 · P1 · effort S · Account deletion leaves the Stripe subscription billing and orphans it

- **Where:** delete-account · `artifacts/api-server/src/lib/accountDeletion.ts:305,artifacts/mobile/app/delete-account.tsx:160-170`
- **Problem:** Purge nulls stripeCustomerId and subscriptionId but never calls stripe.subscriptions.cancel. Stripe keeps charging a deleted seller, and later webhooks can't map to a user. Native subscribers are not told that deleting the account does not cancel their Apple or Google subscription, which Apple's account-deletion guidance requires.
- **Why it costs money:** This guarantees disputes ($15 each, plus dispute-rate risk on the new Stripe account) and Apple review risk under 5.1.1(v).
- **Fix:** At deletion request, cancel the Stripe subscription (at period end or immediately). On delete-account, show 'Cancel your App Store/Google Play subscription' with a managementURL link when the provider is revenuecat.
- **$ impact:** ~$100-500/mo in disputes plus Stripe account health

<a id="bt-015"></a>
### BT-015 · P1 · effort M · No cancel flow, cancel reason, or win-back anywhere

- **Where:** subscription · `artifacts/mobile/app/subscription.tsx:476-480,artifacts/api-server/src/routes/webhooks.ts:1416-1453,artifacts/mobile/lib/paywallRetentionConfig.ts:16-27`
- **Problem:** Cancel is the external Stripe portal or Apple managementURL with no retention step. handleSubscriptionUpdated doesn't store cancel_at_period_end or cancellation_details. There is no win-back email or job (grep 'win-back', 'cancel_at_period_end' finds nothing). The one-time offer is hard-disabled (ONE_TIME_OFFER_ENABLED=false, no promo product).
- **Why it costs money:** A good cancel flow saves 10-20% of cancellations, and win-back offers recover 5-10% of churned sellers.
- **Fix:** Add an in-app 'Cancel plan' screen that asks for a reason, offers a pause or downgrade, then deep-links out. Persist cancel_at_period_end and send a win-back email 7 and 30 days after expiry. Configure Stripe promotion codes or Apple win-back offers.
- **$ impact:** ~$1-3k/mo of retained subscription revenue at target

<a id="bt-016"></a>
### BT-016 · P1 · effort M · Apple keeps 15-30% of every native subscription with no price difference or US web-link strategy

- **Where:** plans · `artifacts/mobile/app/plans.tsx:250-267,scripts/src/seedRevenueCat.ts:23-27`
- **Problem:** Native prices mirror web ($29/$79/$199). Apple takes 15% under the Small Business Program (below $1M proceeds, which Dev must enrol in) or 30% in year one and 15% after a year of continuous subscription, versus about 3% on Stripe. Since the May 2025 Epic ruling, US-storefront apps may show a button or link to web checkout with no Apple commission, but the app doesn't offer this.
- **Why it costs money:** At $25k/mo of subscriptions all on iOS: about $3.75k/mo to Apple at 15%, or $7.5k at 30% if not enrolled, against about $0.9k on Stripe.
- **Fix:** Enrol in the App Store Small Business Program before launch. On the US storefront (check Purchases.getStorefront()), add a 'Subscribe on the web' link alongside IAP. Consider native prices about 15% higher. Keep IAP as the default everywhere else.
- **$ impact:** $2.8-6.6k/mo margin swing at $25k/mo of native subscriptions

<a id="bt-017"></a>
### BT-017 · P1 · effort S · Missing RevenueCat keys or project id fail silently ('temporarily unavailable'), and boot only warns

- **Where:** plans · `artifacts/mobile/lib/revenueCat.native.tsx:54-71,artifacts/api-server/src/lib/env.ts:50-52,artifacts/api-server/src/lib/nativeEntitlements.ts:89-90,docs/app-store/release-flow.md:83-84`
- **Problem:** If EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is absent from the EAS production environment, available=false and every paywall says 'Subscriptions are temporarily unavailable' (no crash, no alert). On the API, REVENUECAT_PROJECT_ID and REVENUECAT_WEBHOOK_AUTHORIZATION are OPTIONAL_VARS (warning only), so production can boot unable to verify any native purchase (sync returns 503). Keys live in .replit (lines 31-37), not in eas.json, and their presence in the EAS 'production' environment can't be verified from the repo.
- **Why it costs money:** A forgotten env var silently zeroes native subscription revenue.
- **Fix:** Make both server vars required in production. Add a release-build assertion (EAS build hook or a CI check of `eas env:list production`) for the RevenueCat iOS/Android keys and EXPO_PUBLIC_IAP_PROMOTIONS, and send a Sentry error when available=false in a release build.
- **$ impact:** Blocks all native subscription revenue if misconfigured

<a id="bt-018"></a>
### BT-018 · P2 · effort S · current_period_end moved to subscription items, so renewal dates are blank

- **Where:** subscription · `artifacts/api-server/src/routes/subscription.ts:197-201,artifacts/api-server/src/routes/webhooks.ts:1429-1431`
- **Problem:** On the dahlia API version, subscription.current_period_end no longer exists (it is now items.data[].current_period_end). /status returns renewsOn null and the webhook never stores subscriptionPeriodEnd. Subscription and billing show 'Renews —'.
- **Why it costs money:** Sellers can't see when they'll be charged. That brings support tickets and 'surprise charge' disputes.
- **Fix:** Use sub.items.data[0].current_period_end with a fallback to sub.current_period_end.
- **$ impact:** ~$100/mo in disputes and support

<a id="bt-019"></a>
### BT-019 · P2 · effort S · Sandbox (TestFlight) purchases grant real paid access in production

- **Where:** server · `artifacts/api-server/src/lib/nativeEntitlements.ts:80,artifacts/api-server/src/lib/nativeEntitlements.ts:186-214,scripts/src/seedRevenueCat.ts:161-163`
- **Problem:** isSandbox is stored but never checked in resolveEffectiveEntitlement. The seeded RevenueCat webhook has environment:null, so sandbox events go to production. Any TestFlight tester, or anyone with a sandbox Apple ID on a TestFlight build pointed at prod, gets Growth/Pro for free.
- **Why it costs money:** Paid features and AI spend are given away. TestFlight testers are a self-selected group of sellers.
- **Fix:** In production (APP_ENV=production), ignore native rows with isSandbox=true unless the user is on an allowlist. Set the RevenueCat production webhook to environment 'production'.
- **$ impact:** ~$100-500/mo depending on TestFlight audience

<a id="bt-020"></a>
### BT-020 · P2 · effort S · Native subscription verification depends on Replit's connector proxy

- **Where:** server · `artifacts/api-server/src/lib/nativeEntitlements.ts:1,artifacts/api-server/src/lib/nativeEntitlements.ts:20,artifacts/api-server/src/lib/nativeEntitlements.ts:97-106,artifacts/api-server/src/lib/iapPromotionsStore.ts:133`
- **Problem:** Every native entitlement read (sync, webhook, promo verify) goes through new ReplitConnectors().proxy('revenuecat', ...). It only works on Replit hosting with the RevenueCat connector authorised. Off Replit, or if the connector token lapses, reconcile throws: /native/sync returns 503, the webhook returns 500, and paying iOS sellers stay on 'starter'.
- **Why it costs money:** Paying native sellers lose access, and the failure shows as a 503 rather than an obvious misconfiguration.
- **Fix:** Use a direct RevenueCat v2 secret key (REVENUECAT_SECRET_API_KEY) with fetch, and keep the connector as a fallback. Add a startup health check that GETs /v2/projects/{id}.
- **$ impact:** All native subscription revenue is at risk during an outage

<a id="bt-021"></a>
### BT-021 · P2 · effort S · RevenueCat TRANSFER events are rejected with 400, so the old account keeps access

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:505-509`
- **Problem:** The handler requires event.app_user_id. RevenueCat TRANSFER events (fired when 'Restore purchases' moves a subscription to another Clerk account) carry transferred_from/transferred_to instead, so they 400 and are never reconciled. The original account's seller_subscription_entitlements row stays active until expiresAt.
- **Why it costs money:** One Apple ID can unlock paid plans on several seller accounts in turn (restore, switch, restore), and the old accounts keep access until expiry.
- **Fix:** For type TRANSFER, reconcile every id in transferred_from and transferred_to, and accept events without app_user_id.
- **$ impact:** ~$100-300/mo of plan sharing

<a id="bt-022"></a>
### BT-022 · P2 · effort M · Apple-charged boost/ad purchases are acknowledged but not delivered when the API flag is off or the target doesn't match

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:527-538,artifacts/api-server/src/lib/iapPromotions.ts:125-135`
- **Problem:** If the mobile flag is on but IAP_PROMOTIONS_ENABLED is off, the webhook records the event id and returns 200 'ignored', so RevenueCat never retries. Results of unmatched, amount_mismatch, ineligible (for example a moderated post) or conflict also return 200 with nothing granted and no queue for later redemption or refund.
- **Why it costs money:** The seller is charged by Apple for nothing, which brings Apple refund requests (counted against the app), support load and 1-star reviews.
- **Fix:** Store unmatched purchases as a credit balance the seller can apply to the next boost or ad. Return 503 (so RevenueCat retries) when the flag is off. Alert on any non-granted result.
- **$ impact:** ~$50-200/mo once promotions sell natively

<a id="bt-023"></a>
### BT-023 · P2 · effort S · Native trial users see 'Free' and 'Upgrade to unlock' because the status vocabularies don't match

- **Where:** subscription · `artifacts/api-server/src/routes/subscription.ts:173-186,artifacts/mobile/app/subscription.tsx:247-259,artifacts/mobile/app/subscription.tsx:323-338`
- **Problem:** For RevenueCat, /status returns status 'trial' or 'grace' (nativeEntitlements statuses), with renewsOn and trialEnd always null. subscription.tsx only knows 'active', 'trialing', 'past_due' and 'canceled', so a native trialing seller gets statusLabel 'Free' and the line 'Upgrade to unlock more features'.
- **Why it costs money:** Confused trial sellers buy again, cancel, or ask for refunds. A trial that looks inactive gets cancelled.
- **Fix:** Map 'trial' to Trial and 'grace' to Payment issue. Return trialEnd and renewsOn from native.trialEndsAt and expiresAt in /status.
- **$ impact:** ~1-3% trial conversion loss on native

<a id="bt-024"></a>
### BT-024 · P2 · effort S · No payment-failed banner for App Store or Play billing issues

- **Where:** subscription · `artifacts/mobile/lib/subscriptionRecovery.ts:3-5,artifacts/api-server/src/routes/webhooks.ts:550-556`
- **Problem:** isSubscriptionPaymentRecoveryRequired only checks 'past_due' and 'unpaid' (Stripe values). Native billing retry maps to 'grace' or 'expired', so the recovery alert never shows. The RevenueCat BILLING_ISSUE webhook only reconciles: no push, no notification row.
- **Why it costs money:** Store-side involuntary churn is never surfaced inside Brandthread, so recoverable renewals are lost.
- **Fix:** On BILLING_ISSUE, insert a 'subscription_payment_failed' notification and push with a deep link to managementURL. Treat 'grace' as recovery-required in the UI.
- **$ impact:** ~$200-600/mo recovered native renewals

<a id="bt-025"></a>
### BT-025 · P2 · effort S · Day-4 trial reminder exists only for Stripe trials, while the native paywall promises it

- **Where:** plans · `artifacts/api-server/src/jobs/sellerTrialReminder.ts:108-117,artifacts/mobile/app/plans.tsx:85-93`
- **Problem:** createEligibleEvents selects users.subscriptionStatus='trialing', which only Stripe webhooks set. Native trials live in seller_subscription_entitlements, so they never get the 'We remind you before your trial ends' step shown on the paywall timeline. Apple sends no trial-ending notice for subscriptions.
- **Why it costs money:** Breaking a disclosed promise brings 'charged without warning' refunds and disputes, and the missed reminder is also a missed chance to convert the seller.
- **Fix:** Include native rows with status 'trial' using their trialEndsAt (the day before end, given Apple durations), or drop the reminder step from the native timeline.
- **$ impact:** ~$100-300/mo in refunds

<a id="bt-026"></a>
### BT-026 · P2 · effort S · 'Start my free trial' is shown even to users who aren't eligible for the intro offer

- **Where:** plans · `artifacts/mobile/app/plans.tsx:139-141`
- **Problem:** hasRealTrialOffer is true whenever any package has product.introPrice. StoreKit returns introPrice to everyone, including users who already used a trial in the subscription group, and they are charged immediately. Eligibility is never checked (Purchases.checkTrialOrIntroductoryPriceEligibility).
- **Why it costs money:** A re-subscriber who reads 'Free for 5 days' is charged on day 0. That brings refunds, 3.1.2 complaints and chargebacks.
- **Fix:** Call checkTrialOrIntroductoryPriceEligibility for the three product ids, and show the trial copy only when eligible.
- **$ impact:** ~$100/mo in refunds; review risk

<a id="bt-027"></a>
### BT-027 · P2 · effort S · Price is less prominent than the trial in the paywall CTA (Apple 3.1.2(c))

- **Where:** plans · `artifacts/mobile/app/plans.tsx:446-468,artifacts/mobile/app/plans.tsx:424-429`
- **Problem:** The main button says 'Start my 5-day free trial'. The billed amount appears only in the smaller billingLine subtext and on plan cards. The headline subtitle says 'start free' even though Starter is paid. Apple has rejected paywalls where the free-trial text is more prominent than the renewal price.
- **Why it costs money:** First-review rejection delays the Oct 31 launch.
- **Fix:** Put '{price}/month after {N}-day free trial' at the same or larger size as the CTA label, directly above it, and remove 'start free' from the subtitle.
- **$ impact:** Launch-delay risk

<a id="bt-028"></a>
### BT-028 · P2 · effort S · Stripe success and portal return URLs point at /api-server/seller/... (missing /api) and sit behind requireAuth

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:33,artifacts/api-server/src/routes/subscription.ts:383,artifacts/api-server/src/routes/subscription.ts:466,artifacts/api-server/src/routes/subscription.ts:484-491`
- **Problem:** The API is mounted at /api (app.ts:210) and webhooks live at /api-server/api/webhooks (ensureWebhookEvents.ts:48), but success_url and cancel_url are `${origin}/api-server/seller/subscription/return` without /api. Even with the right path, router.use(requireAuth) on line 33 runs before the '/return' 'skip' hack (which only sets a flag), so the browser redirect without a bearer token gets 401.
- **Why it costs money:** Web sellers finish Stripe checkout and land on an error page, then abandon or retry and create duplicates.
- **Fix:** Mount the /return and /portal/return pages on a separate unauthenticated router before subscriptionRouter, use the /api-server/api/... path, or return straight to the web app's /plans?checkout=success.
- **$ impact:** Web checkout drop-off; ~$200-500/mo

<a id="bt-029"></a>
### BT-029 · P2 · effort S · Reflected HTML injection on the subscription return page

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:493-506`
- **Problem:** req.query.plan is interpolated unescaped into the HTML body (`<strong>${plan}</strong>`) on a page served from the Brandthread domain.
- **Why it costs money:** Attackers can build phishing pages on brandthread.app (for example a fake 'enter card' prompt), which erodes trust and invites Stripe and Apple scrutiny.
- **Fix:** Map plan through isSellerPlanId to a display name, or escapeHtml it.
- **$ impact:** Fraud and brand risk, not direct $

<a id="bt-030"></a>
### BT-030 · P2 · effort S · A past_due seller who re-runs checkout gets a duplicate Stripe subscription

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:390-421`
- **Problem:** In-place update only happens for 'active' or 'trialing'. A past_due, unpaid or incomplete subscription falls through to a brand-new Checkout Session with another trial, while the old subscription keeps retrying the card.
- **Why it costs money:** Two subscriptions for one seller lead to double charges and disputes. It also gives an easy free trial to sellers who are behind on payment.
- **Fix:** For past_due or unpaid, return a portal or hosted invoice URL to pay the open invoice instead of a new checkout.
- **$ impact:** ~$100/mo

<a id="bt-031"></a>
### BT-031 · P2 · effort S · Webhooks write by customer, not subscription id, so a stale or duplicate subscription can overwrite the live one

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1439-1447,artifacts/api-server/src/routes/webhooks.ts:1662-1673`
- **Problem:** handleSubscriptionUpdated and handleSubscriptionDeleted update users WHERE stripeCustomerId = customer. They don't check sub.id === users.subscriptionId or event ordering. Deleting an old duplicate subscription resets an active payer to canceled/starter, and an out-of-order 'trialing' event can overwrite 'active'.
- **Why it costs money:** Paying sellers lose access (support tickets, churn), or non-payers keep it.
- **Fix:** Ignore events for a sub.id that differs from the stored subscriptionId unless the stored one is canceled. Compare event.created against a stored subscriptionUpdatedAt.
- **$ impact:** ~$100-300/mo

<a id="bt-032"></a>
### BT-032 · P2 · effort S · Mid-cycle upgrade then immediate downgrade with prorations lets sellers rent Pro by the day

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:394-406`
- **Problem:** In-place plan changes use proration_behavior 'create_prorations' in both directions, take effect immediately, and need no payment confirmation (prorations go to the next invoice). A seller can switch to Pro, use unlimited AI or Live for a few days, then switch back and get credit.
- **Why it costs money:** This leaks Pro value and AI cost.
- **Fix:** Apply downgrades at period end (a subscription schedule) and charge upgrades now (proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete').
- **$ impact:** ~$100-300/mo

<a id="bt-033"></a>
### BT-033 · P2 · effort S · No sales tax on seller subscriptions (automatic_tax missing)

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:421-435`
- **Problem:** Subscription Checkout sets no automatic_tax or tax_id_collection, while buyer checkout does (buyer.ts:1173, guest-checkout.ts:300). Several US states (TX, NY, WA, PA, OH and others) tax SaaS.
- **Why it costs money:** Brandthread owes the uncollected tax out of its own pocket once nexus thresholds are met.
- **Fix:** Add automatic_tax: { enabled: true }, customer_update: { address: 'auto' } and tax_id_collection. IAP sales are taxed by Apple and Google.
- **$ impact:** ~6-8% of web subscription revenue in exposed states

<a id="bt-034"></a>
### BT-034 · P2 · effort M · Subscription prices are hard-coded in five places that must stay in sync

- **Where:** n/a · `artifacts/api-server/src/lib/planCatalogue.ts:15-38,artifacts/mobile/lib/sellerPlans.ts:16-60,artifacts/mobile/lib/proPerks.ts:64-66,scripts/src/seedRevenueCat.ts:23-27,artifacts/mobile/app/subscription.tsx:70-72`
- **Problem:** $29/$79/$199 are written into the server catalogue, mobile SELLER_PLANS, DEMO_PERKS, the RevenueCat seed and screen defaults, alongside the App Store Connect and Play prices (which have no code link). Dev hasn't decided prices. ensurePrice creates a new Stripe Price on mismatch, but native prices only change in App Store Connect.
- **Why it costs money:** Web and native drift (wrong amountCents shown, 'per week' maths off), and a price change becomes a multi-file release.
- **Fix:** Keep planCatalogue as the only source. Have mobile read prices from /perks (web) and StoreKit (native). Check catalogue against RevenueCat product prices at boot.
- **$ impact:** Indirect; prevents mispricing errors

<a id="bt-035"></a>
### BT-035 · P2 · effort S · Promotion consumables give the full face value even though Apple keeps 15-30%

- **Where:** boost · `artifacts/mobile/lib/iapPromotions.ts:14-24,docs/review-readiness/iap-rails.md`
- **Problem:** brandthread_boost_25 / brandthread_ad_25 sold at $24.99 grant $25 of reach budget. After Apple's cut Brandthread receives $17.49-21.24 but delivers $25 of inventory. The doc notes this but no price uplift was chosen.
- **Why it costs money:** Every native boost or ad sells inventory below its face value.
- **Fix:** Price the store tiers about 18% above budget (for example the $25-budget tier at $29.99), or grant budget equal to Apple proceeds.
- **$ impact:** 15-30% of native promotion revenue

<a id="bt-036"></a>
### BT-036 · P2 · effort S · AI credit packs on iOS are correctly on IAP, but nothing checks for credits after a store purchase

- **Where:** ai-credits · `artifacts/mobile/lib/revenueCat.native.tsx:173-178,artifacts/mobile/app/ai-credits.tsx:167-178,artifacts/api-server/src/lib/aiCredits/purchases.ts:115-128`
- **Problem:** Native packs use RevenueCat consumables (brandthread_ai_credits_500/1500/5000), which complies with 3.1.1. Credits are granted only by the NON_RENEWING_PURCHASE webhook. There is no client verify like iap-promotions has, and the screen silently stops after 12s of polling. If the webhook is misconfigured, the purchase is lost with no message. docs/review-readiness/iap-rails.md row 5 says 'No credit or pay-per-use AI product exists', which is stale.
- **Why it costs money:** Charged but not credited leads to refunds and reviews.
- **Fix:** Add POST /ai/credits/purchases/verify-native, which reads the RevenueCat transaction like lookupRevenueCatPurchase, and show 'Purchase pending, credits will appear shortly' after polling times out. Update iap-rails.md.
- **$ impact:** ~$50-150/mo in refunds

<a id="bt-037"></a>
### BT-037 · P2 · effort S · Credit-pack price falls back to the Stripe USD label on native when StoreKit has no product

- **Where:** ai-credits · `artifacts/mobile/app/ai-credits.tsx:121,artifacts/mobile/app/ai-credits.tsx:251`
- **Problem:** canBuy on native only checks rc.available. The price shown is `storePrices[...] || formatPackPrice(pack.amountCents)`, so if the App Store product is missing or not approved, the screen shows '$5.99' and the purchase then fails with 'not available in the store yet'.
- **Why it costs money:** A reviewer sees a buy button that errors (2.1 rejection), and sellers lose trust.
- **Fix:** On native, show a pack only when its StoreKit price loaded. Otherwise hide the pack list.
- **$ impact:** Review risk

<a id="bt-038"></a>
### BT-038 · P2 · effort S · Meta Ads, store domain, email campaigns and push broadcasts have no in-app payment (no IAP exposure)

- **Where:** meta-ads-setup · `artifacts/api-server/src/routes/meta-ads.ts,artifacts/mobile/app/store-domain.tsx:265,artifacts/api-server/src/routes/email-marketing.ts:296,artifacts/api-server/src/routes/seller-push-broadcasts.ts`
- **Problem:** Meta bills the seller's own ad account, the custom domain is bring-your-own and free, and email and push sends are free with only a daily cap (dailySendCap) and no plan gate. None of these is an IAP problem. Email marketing and push broadcasts are open to unpaid sellers, though, and they cost money to send (Resend).
- **Why it costs money:** Typical upsell features are given away, and unpaid sellers generate email cost. Cross-ref ai-cost and seller-retention-tools.
- **Fix:** Gate email campaigns and push broadcasts to Growth or any active entitlement, or set plan-based monthly send quotas in planCatalogue.limits.
- **$ impact:** ~$200-500/mo in upsell plus email cost

<a id="bt-039"></a>
### BT-039 · P2 · effort S · The RevenueCat webhook secret falls back to SESSION_SECRET

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:494-495,scripts/src/seedRevenueCat.ts:146-149`
- **Problem:** If REVENUECAT_WEBHOOK_AUTHORIZATION is unset, 'Bearer ${SESSION_SECRET}' is accepted, and the seed script registers that same value with RevenueCat. The app's session-signing secret is then stored at a third party, and forged webhooks can trigger reconciliation.
- **Why it costs money:** A leaked session secret is a full account-takeover risk. Forged webhooks can only trigger reconciles, not grants.
- **Fix:** Require a dedicated REVENUECAT_WEBHOOK_AUTHORIZATION in production (move it to REQUIRED_VARS productionOnly). Remove the fallback and rotate it.
- **$ impact:** Security; indirect

<a id="bt-040"></a>
### BT-040 · P2 · effort S · Plan status and plan gating fail for team members (/status is owner-only)

- **Where:** studio · `artifacts/mobile/hooks/useSubscriptionPlan.ts:90-116,artifacts/api-server/src/routes/subscription.ts:139`
- **Problem:** useSubscriptionPlan calls /seller/subscription/status, which is requireRole('owner'). For a team member of a Pro store the call returns 403, the hook sets error=true, and Growth/Pro surfaces show locks or upsells even though the server (requirePlan uses the owner's entitlement) would allow them. /perks already exposes currentPlan to any team member.
- **Why it costs money:** Paying Pro stores get a broken experience for the staff they pay team seats for, which drives churn among top-tier sellers.
- **Fix:** Have the hook read currentPlan from /seller/subscription/perks, which is not owner-only, or add a minimal /plan endpoint for team members.
- **$ impact:** Retention of Pro tier; ~$100-400/mo

<a id="bt-041"></a>
### BT-041 · P2 · effort S · docs/review-readiness/iap-rails.md says 'PASS' for things the code contradicts

- **Where:** n/a · `docs/review-readiness/iap-rails.md,docs/launch/app-store-readiness.md:27`
- **Problem:** The doc says native seller plans PASS (but see the logOut and 5-day trial findings), that there are no AI credit packs (they exist, lib/aiCredits/purchases.ts), that there is no featured-slot product (Stripe-only, featured-slots.ts:295), and that Boost and Ads are FIXED (off by default in production builds).
- **Why it costs money:** Dev may submit believing 3.1.1 is cleared.
- **Fix:** Update the table: featured slots FAIL, Boost and Ads FAIL unless the flag is set in EAS production, AI packs IAP PASS. Link this audit.
- **$ impact:** Prevents a launch-blocking rejection

<a id="bt-042"></a>
### BT-042 · P3 · effort S · The server's day-4 trial banner is never rendered by the app

- **Where:** subscription · `artifacts/api-server/src/routes/subscription.ts:210-222,artifacts/mobile/lib/api.ts:2436-2452`
- **Problem:** /status computes trialBanner (with copy and a 'Manage subscription' CTA) and the API client types it, along with dismissTrialBanner. grep finds no component that reads trialBanner, so the banner is dead.
- **Why it costs money:** A built conversion and transparency surface never reaches sellers.
- **Fix:** Render the banner on the seller home dashboard when status.trialBanner.visible is true, with dismiss calling api.seller.subscription.dismissTrialBanner.
- **$ impact:** Small; ~$100/mo

<a id="bt-043"></a>
### BT-043 · P3 · effort S · Legal footer says 'App Store account settings' on Android and to web subscribers

- **Where:** plans · `artifacts/mobile/app/plans.tsx:503-506,artifacts/mobile/app/subscription.tsx:488-492`
- **Problem:** The auto-renew disclosure is hard-coded to App Store wording for every platform and provider.
- **Why it costs money:** Google Play policy requires accurate cancellation instructions. Wrong instructions lead to 'couldn't cancel' disputes.
- **Fix:** Choose the copy by Platform.OS (Google Play subscriptions) and by effectiveProvider (web: brandthread.app billing).
- **$ impact:** <$50/mo

<a id="bt-044"></a>
### BT-044 · P3 · effort S · If the one-time offer is enabled, it shows a discount but charges full price

- **Where:** plans · `artifacts/mobile/app/plans.tsx:358-363,artifacts/mobile/lib/paywallRetentionConfig.ts:21-33`
- **Problem:** handleOfferAccept calls handleSelect(offerPlan), which buys the normal $bt_* package or Stripe price. ONE_TIME_OFFER_PROMO_PRODUCT_ID is never used in a purchase path.
- **Why it costs money:** Advertising a discount and charging full price breaks 3.1.2/5.6 and consumer-protection rules the moment the flag is flipped.
- **Fix:** Wire the offer to a real discounted package (RevenueCat promotional offer, Stripe coupon) before the flag can be turned on, and add a test.
- **$ impact:** Latent; $0 until enabled

<a id="bt-045"></a>
### BT-045 · P3 · effort S · Exit drawer's per-week maths uses USD catalogue cents next to the localized store price

- **Where:** plans · `artifacts/mobile/components/paywall/SellerPaywallExitDrawer.tsx:72-103,artifacts/mobile/lib/sellerPlansDisplay.ts:33-46`
- **Problem:** weeklyEquivalentFor and dailyEquivalentFor use plan.priceCents ($29) in USD while priceLabel is the StoreKit price string. A UK seller sees '£28.99/mo, that's about ~$6.67/wk'.
- **Why it costs money:** Mixed currencies on a paywall are a 3.1.2 'misleading pricing' risk and reduce trust.
- **Fix:** Compute from pkg.product.price and currencyCode (RevenueCat exposes pricePerWeekString and pricePerMonthString).
- **$ impact:** Small

<a id="bt-046"></a>
### BT-046 · P3 · effort S · amountCents in /status for native comes from the USD catalogue, not the store

- **Where:** subscription · `artifacts/api-server/src/routes/subscription.ts:181,artifacts/mobile/app/subscription.tsx:96,artifacts/mobile/app/finance.tsx:195`
- **Problem:** Native sellers see '$29.00/mo' (catalogue) even when Apple charges $29.99 or a localized price. finance.tsx falls back to formatCents(2900) '/mo' even for sellers with no plan.
- **Why it costs money:** A shown price that differs from the charge brings disputes and 'overcharged' tickets.
- **Fix:** Use the RevenueCat package priceString client-side for native. Hide the price line when the status is 'none'.
- **$ impact:** <$100/mo

<a id="bt-047"></a>
### BT-047 · P3 · effort S · Freelancer job payments use Stripe in-app for possibly digital deliverables (3.1.3(e) gray zone)

- **Where:** freelancer-profile · `artifacts/mobile/app/freelancer-profile.tsx:122-131,artifacts/api-server/src/routes/freelancer-jobs.ts:203`
- **Problem:** Seller-to-freelancer escrow is paid through Stripe Checkout in an in-app auth session. Deliverables can be digital files (logos, designs). Apple allows person-to-person services (3.1.3(d)) but has rejected cases where a digital good is delivered in the app.
- **Why it costs money:** There is some rejection risk. This is only documented, not mitigated.
- **Fix:** Keep it, explain it in Review Notes as a real-time person-to-person service marketplace (already in app-store-metadata.md), and make sure deliverables are not presented as app content. Have a fallback plan to hide the feature on iOS if review flags it.
- **$ impact:** Review risk only

<a id="bt-048"></a>
### BT-048 · P3 · effort S · Physical-goods checkout, store gift cards, samples and labels correctly use Stripe (keep off IAP)

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/buyer.ts:1166,artifacts/api-server/src/routes/checkout-intent.ts:378,artifacts/api-server/src/routes/guest-checkout.ts:297,artifacts/api-server/src/lib/giftCards/purchase.ts:51,artifacts/api-server/src/routes/sample-orders.ts:319`
- **Problem:** These are compliant: physical goods (3.1.3(e)) and store gift cards redeemable only for a seller's physical products may not use IAP. A risk only appears if sellers can list digital or downloadable products (grep 'isDigital' or 'digital_download' finds none today), in which case those listings and gift cards for them would need IAP.
- **Why it costs money:** Putting this through IAP would cost 15-30% for nothing. Allowing digital listings later would trigger 3.1.1.
- **Fix:** Keep Stripe. Add a policy and a schema guard that listings must be physical, and say so in Review Notes.
- **$ impact:** Protects ~15-30% of GMV from wrongly going through IAP

<a id="bt-049"></a>
### BT-049 · P3 · effort S · /status calls Stripe live on every plan check

- **Where:** server · `artifacts/api-server/src/routes/subscription.ts:189-195,artifacts/mobile/app/subscription.tsx:123-129`
- **Problem:** Every focus of subscription, billing, more or settings, and every invalidatePlanCache, triggers stripe.subscriptions.retrieve with expand. If Stripe is slow or rate-limited, the route returns 500 and the client keeps the default 'Starter $29' card, so a paying seller looks unpaid.
- **Why it costs money:** A paying seller who appears unpaid opens support tickets and may cancel; the extra API load adds latency to paid screens.
- **Fix:** Serve status from the webhook-synced users columns, and retrieve from Stripe only on an explicit refresh or once per day.
- **$ impact:** Small

<a id="bt-050"></a>
### BT-050 · P3 · effort S · Unverifiable social-proof and 'start free' claims on the paywall

- **Where:** plans · `artifacts/mobile/app/plans.tsx:426-433`
- **Problem:** 'Trusted by independent brands building on Brandthread' appears on a pre-launch app with no brands yet. The subtitle 'start free' sits above a paid-only plan list.
- **Why it costs money:** These invite Apple 2.3.1 and 5.6 accuracy objections and buyer and seller distrust.
- **Fix:** Remove the social proof until there are real counts (pull a seller count from the API). Change the subtitle to 'Try free for N days'.
- **$ impact:** Review risk only

<a id="bt-051"></a>
### BT-051 · P3 · effort S · RevenueCat consumable refunds don't revoke boosts or ads, and credit-pack refunds don't claw back credits

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:527-556,artifacts/api-server/src/lib/aiCredits/purchases.ts:115-128`
- **Problem:** There is no handling of RevenueCat CANCELLATION with cancel_reason=CUSTOMER_SUPPORT (refund) for NON_RENEWING products. A seller can buy 5,000 credits or a $500 boost, use it, and get Apple to refund it.
- **Why it costs money:** Refund abuse comes straight out of AI provider cost and ad inventory.
- **Fix:** On refund events for credit products, debit purchasedBalance (allowing it to go negative and block). For promo products, end the active boost or ad.
- **$ impact:** ~$50-200/mo

<a id="bt-052"></a>
### BT-052 · P3 · effort S · Restore Purchases fails silently for a signed-in team member and doesn't say what was restored

- **Where:** subscription · `artifacts/mobile/lib/revenueCat.native.tsx:73-79,artifacts/mobile/app/subscription.tsx:233-244,artifacts/mobile/app/plans.tsx:286-303`
- **Problem:** sync() returns early unless currentRole==='owner', so restore on a team member's device never reconciles. Owners always see 'Purchases restored' even when nothing was found (no check of customerInfo.entitlements or activeSubscriptions).
- **Why it costs money:** Restore is required by 3.1.1, so App Review taps it. Sellers who reinstall can't tell whether access came back, which brings support tickets and duplicate purchases.
- **Fix:** After restore, read customerInfo.activeSubscriptions and show 'No active subscription found on this Apple ID' or the plan name.
- **$ impact:** Small

## Stripe Connect, commission, refunds & disputes

52 findings: 4 P0 · 16 P1 · 17 P2 · 15 P3

<a id="bt-053"></a>
### BT-053 · P0 · effort S · Seller-issued gift cards are paid out of Brandthread's balance when redeemed

- **Where:** gift-cards-manage / buyer-checkout · `artifacts/api-server/src/lib/giftCards/service.ts:176-178,artifacts/api-server/src/lib/giftCards/payout.ts:28-60,artifacts/api-server/src/lib/giftCards/checkout.ts:115-116,artifacts/api-server/src/routes/gift-cards.ts:225-233`
- **Problem:** issueSellerCard creates a live card with 'no payment, no liability', but on redemption finalizeGiftCardsForGroup -> payoutSellerForOrder transfers the full redeemed amount to the seller from the platform balance, and settledRedemptions never checks the card's source. A seller can issue unlimited $1,000 cards (POST /gift-cards/seller/issue) to an alt account, 'buy' their own items, and receive real money that no one paid. The payout also goes out at payment time, before delivery, so the hold does not protect it.
- **Why it costs money:** This is direct theft of platform cash at up to $1,000 per card with no cap on how many cards a seller issues. Reversal on refund only works while the seller's Stripe balance still holds the funds.
- **Fix:** In payoutSellerForOrder, pay out only redemptions of cards with source='purchase'. Seller-issued redemptions should reduce the seller's own net, as a seller-funded discount. Also gate the gift card payout behind payoutMayRelease, the same delivery hold other payouts use.
- **$ impact:** Unbounded: one bad seller with 10 cards drains $10k. At minimum, every legitimate seller-issued promo card at $50k scale (~$2-5k/mo) is paid by Brandthread.

<a id="bt-054"></a>
### BT-054 · P0 · effort S · payment_intent.* events not in the managed webhook subscription: in-app checkout orders never created

- **Where:** buyer-checkout (in-app pay), gift-card-buy · `artifacts/api-server/src/lib/ensureWebhookEvents.ts:22-46,artifacts/api-server/src/routes/webhooks.ts:339-355,artifacts/mobile/lib/checkoutPayment.ts:27-53`
- **Problem:** The default mobile payment path is the one-page PaymentIntent (choosePaymentPath returns 'in_app'). Orders and gift-card activation are created only in the payment_intent.succeeded handler. REQUIRED_EVENTS, which ensureWebhookEvents merges into the Stripe endpoint, lists no payment_intent.* events. Nothing reconciles a succeeded PaymentIntent that has no order: GET /payment-intent/:id only reports status. Unless someone adds the events in the Dashboard by hand, buyers are charged and no order, payout or stock commit ever happens.
- **Why it costs money:** Charged buyers with no orders lead to chargebacks, refunds and lost sellers on day one. Those disputes land on the platform account because the charge is on Brandthread's balance.
- **Fix:** Add payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, review.opened and review.closed to REQUIRED_EVENTS. Add a sweep that finds succeeded cart PaymentIntents without orders and calls handleCartPaymentSucceeded.
- **$ impact:** Blocks all in-app revenue if the Dashboard is not configured by hand: 100% of in-app GMV.

<a id="bt-055"></a>
### BT-055 · P0 · effort S · Manual seller orders get free shipping labels on Brandthread's Shippo account

- **Where:** orders / shipping label purchase · `artifacts/api-server/src/routes/orders.ts:131-150,artifacts/api-server/src/routes/orders.ts:192-199,artifacts/api-server/src/routes/shipping-labels.ts:24,artifacts/api-server/src/routes/shipping-labels.ts:229,artifacts/api-server/src/lib/money/escrow.ts:658-720,artifacts/api-server/src/lib/money/escrow.ts:807`
- **Problem:** POST /api/orders lets a seller create an off-platform order with client-priced custom items (charge_model NULL, status 'pending'). Those orders are label-eligible. The only funds check is order.total_cents (seller-chosen) minus reservations. recordLabelPurchased writes no ledger posting when chargeModel is null, and recoverLabelCost skips anything that is not destination or transfer. The carrier is paid by Brandthread and never recovered.
- **Why it costs money:** Any seller can ship their Etsy/IRL orders on Brandthread's Shippo bill indefinitely.
- **Fix:** Refuse label purchase unless the order has a stripe_payment_intent_id and charge_model in (held, transfer, destination). Alternatively, charge manual-order labels to the seller's card or Stripe balance up front.
- **$ impact:** $8-15 per label. 100 abusive labels a month is about $1k, and it is unbounded.

<a id="bt-056"></a>
### BT-056 · P0 · effort S · Unauthenticated Shippo webhook can mark orders delivered (payout) or return labels scanned (refund)

- **Where:** server · `artifacts/api-server/src/routes/webhooks-shippo.ts:41-45,artifacts/api-server/src/routes/webhooks-shippo.ts:84-88,artifacts/api-server/src/routes/webhooks-shippo.ts:99-112,artifacts/api-server/src/lib/env.ts:53`
- **Problem:** verifySharedSecret returns true when SHIPPO_WEBHOOK_SECRET is unset, and env.ts lists it as optional. Anyone can POST a DELIVERED tracking_status with metadata 'brandthread-order/<id>' or a known tracking number. That starts the 3-day payout clock for a seller who never shipped. A forged scan on a 'brandthread-return-label/<id>' triggers the return refund without goods coming back.
- **Why it costs money:** This defeats the whole hold-until-delivered model. The seller is paid, the buyer later wins a 'not received' chargeback on the platform account, and the platform eats it plus the $15 dispute fee.
- **Fix:** Make SHIPPO_WEBHOOK_SECRET required in production (env.ts) and fail closed. Before treating a DELIVERED webhook as truth, re-fetch the track from the Shippo API.
- **$ impact:** Per fraud event: full order value + $15 dispute fee. A small ring could take $5-20k/mo.

<a id="bt-057"></a>
### BT-057 · P1 · effort M · Stripe fee (and label cost) on refunds before payout is booked to an orphan 'seller owes' row never collected

- **Where:** server / finance · `artifacts/api-server/src/lib/money/refunds.ts:366-371,artifacts/api-server/src/routes/finance.ts:313-327,artifacts/api-server/src/lib/money/cartTransfers.ts:77`
- **Problem:** For held/transfer orders refunded before the transfer, sellerShare = refund - 5% return. The order's held balance is only gross - fee - processing - labels, so the difference is posted to seller_held with orderId NULL and drop NULL. settleTransferOrder only pays the per-order balance and never nets that row. The finance 'owed' figure only counts negative balances on failed/completed drops, so this debt is invisible and never recovered. delivery-guarantee.md:23 claims the fee 'is charged to the seller's held funds'.
- **Why it costs money:** In hold mode Brandthread pays Stripe's 2.9%+30c, plus any label already bought, on every buyer cancellation, seller cancellation, auto-refund and pre-payout return.
- **Fix:** Net seller-level negative seller_held against the seller's next settleTransferOrder or release. Also show it as 'owed' in /finance/summary, and fix the doc.
- **$ impact:** At ~$1M GMV and an 8% pre-payout refund rate: $80k x ~3.2% = ~$2.5k/mo, plus unrecovered labels.

<a id="bt-058"></a>
### BT-058 · P1 · effort S · Plan perks cut commission to 4% (Growth) and 3% (Pro); owner's rule is 5% on every sale

- **Where:** subscription / fees · `artifacts/api-server/src/lib/planPerks.ts:18-23,artifacts/api-server/src/lib/planPerks.ts:41-48,artifacts/api-server/src/lib/nativeEntitlements.ts:195,artifacts/api-server/src/lib/nativeEntitlements.ts:201`
- **Problem:** resolveSellerPlatformFeeBps charges 400 bps for growth and 300 bps for pro. The fee is applied to every checkout path (buyer.ts:1035, guest-checkout.ts:250, cartCheckout.ts:279). Sellers in 'trial', 'trialing', 'grace' or 'past_due' status also get the discounted rate, so a free-trial Pro seller pays 3%. The UI still promises 5% everywhere (subscription.tsx:9,343,552).
- **Why it costs money:** Commission revenue on Growth/Pro GMV falls 20-40%, and trial or past-due sellers get the cut without paying for the plan.
- **Fix:** Set all PLAN_PERKS platformFeeBps to PLATFORM_FEE_BPS, or have Dev explicitly approve tiered commission. If tiered, only apply it for status 'active' (not trial/past_due/grace).
- **$ impact:** If 40% of a $1M GMV is Growth/Pro, the loss is ~$6k/mo (1-2% of that GMV).

<a id="bt-059"></a>
### BT-059 · P1 · effort S · Commission bypass: 5% is on merchandise only, sellers can move price into shipping

- **Where:** shipping-zones / buyer-checkout · `artifacts/api-server/src/lib/money/fees.ts:106-107,artifacts/api-server/src/lib/money/cartCheckout.ts:280-284,artifacts/api-server/src/routes/buyer.ts:1036-1042`
- **Problem:** Platform fee = 5% x (subtotal - discounts) and excludes shipping. Shipping is any seller-chosen flat or zone rate with no cap or sanity check. A seller can list a $5 item with $45 shipping and pay 25c commission instead of $2.50.
- **Why it costs money:** This is a classic marketplace fee-avoidance pattern (eBay charges FVF on shipping for this reason). Once known, top sellers use it.
- **Fix:** Charge the platform fee on merchandise + shipping, or cap shipping at a multiple of the quoted label cost and flag outliers.
- **$ impact:** If 10% of GMV shifts to shipping: $1M x 10% x 5% = ~$5k/mo.

<a id="bt-060"></a>
### BT-060 · P1 · effort M · Dispute on an already-paid-out order: no transfer reversal, platform eats chargeback

- **Where:** disputes / dispute-detail · `artifacts/api-server/src/lib/money/disputes.ts:76-85,artifacts/api-server/src/routes/webhooks.ts:433-457`
- **Problem:** When charge.dispute.funds_withdrawn hits a transfer/held order whose funds are 'released' (paid at delivery+3 days), recordDisputeWithdrawal only posts platform_funds_advanced (seller owes). No transfers.createReversal is attempted and nothing collects the debt later. Chargebacks typically arrive 2-8 weeks after payment, which is after the hold window.
- **Why it costs money:** In hold mode every charge is on the platform account, so Stripe debits Brandthread for 100% of each post-payout chargeback.
- **Fix:** On funds_withdrawn for released orders, reverse the order's transfer (stripe_transfer_id or release transfer) up to the disputed amount. If the seller balance is short, net it from the next payouts. Re-transfer on funds_reinstated.
- **$ impact:** At a 0.5% dispute rate on $1M GMV with ~70% post-payout: ~$3.5k/mo.

<a id="bt-061"></a>
### BT-061 · P1 · effort M · Hold mode makes Brandthread merchant of record: no on_behalf_of, all risk on platform

- **Where:** server · `artifacts/api-server/src/lib/money/checkoutPlan.ts:175-182,artifacts/api-server/src/routes/checkout-intent.ts:384-401,artifacts/api-server/src/lib/delivery/policy.ts:34-36`
- **Problem:** PAYOUT_MODE defaults to 'hold', and the one-page checkout always uses 'transfer', so every sale is a platform charge with no on_behalf_of or transfer_data. Brandthread is the settlement merchant. The platform's descriptor appears on statements, every dispute and refund debits the platform, Radar and dispute ratios count against Dev's single Stripe account, and Stripe can impose a reserve on the delayed-fulfilment GMV (18+ days). money-flow.md section 8 lists confirmations that are still open.
- **Why it costs money:** A dispute rate above about 0.75% on one account can freeze ALL marketplace funds. A Stripe reserve could lock 10-25% of GMV right when cash is needed.
- **Fix:** Before launch, get written Stripe sign-off on separate charges and transfers with an ~18-60 day hold, and on reserve terms. Consider on_behalf_of so sellers are merchant of record, and set the platform's own payout schedule so held GMV isn't swept to Dev's bank.
- **$ impact:** Tail risk: an account freeze blocks all revenue. A typical 10% reserve on $1M GMV ties up ~$100k.

<a id="bt-062"></a>
### BT-062 · P1 · effort S · Platform account payout schedule not addressed: held GMV may be auto-paid to Dev's bank

- **Where:** server · `artifacts/api-server/src/lib/money/cartTransfers.ts:81-89,artifacts/api-server/src/lib/threadCash/checkoutTopup.ts:56-61,artifacts/api-server/src/lib/giftCards/payout.ts:46-55`
- **Problem:** The hold model keeps up to ~18 days (regular) or 60+ days (preorder) of seller money on the platform balance. Nothing configures or documents that the platform account must be on manual payouts. Thread Cash top-ups and gift-card payouts are transfers without source_transaction, so they draw from available platform balance and fail with balance_insufficient if Stripe already paid it out.
- **Why it costs money:** Seller money could be swept to Dev's bank, and later transfers would fail or push the platform negative. Commingled funds are also a money-transmission risk.
- **Fix:** Set the platform Stripe account to manual payouts and add a launch checklist item. Add a reconciliation job that alerts when available balance is below total seller_held.
- **$ impact:** Operational: failed seller payouts, support load, possible account review. Exposure is the full held balance (~$500k at $1M GMV).

<a id="bt-063"></a>
### BT-063 · P1 · effort M · Auto-refund is refund-by-default when no 'delivered' signal: delivered goods get refunded

- **Where:** server / seller orders · `artifacts/api-server/src/lib/delivery/autoRefund.ts:70-90,artifacts/api-server/src/lib/delivery/autoRefund.ts:130-145,artifacts/api-server/src/lib/delivery/trackingSync.ts:98-99,artifacts/api-server/src/lib/delivery/payoutGate.ts:33-38`
- **Problem:** Any item without delivered_at at day 15 (60 for pre-orders) is fully refunded with restock:false. Delivered is set only by a mapped Shippo carrier scan or the signed-in buyer tapping 'I received it'. Unknown carriers (shippoCarrierToken null), local delivery, hand-typed tracking typos and guest orders (no in-app confirm) all refund automatically even when the parcel arrived. The buyer keeps the goods.
- **Why it costs money:** Sellers lose goods and revenue and will churn. Brandthread loses its 5% (returned via platformFeeRefundCents) and eats the Stripe fee (see orphan-owed finding).
- **Fix:** Before refunding a shipped order with valid accepted/in-transit scans, require a buyer 'not received' claim (or at least an email confirm prompt) instead of refunding by default. Keep auto-refund for 'never shipped / no scan'.
- **$ impact:** If 2% of shipped orders lack a delivered scan: $1M x 2% = $20k GMV refunded/mo, costing ~$1k platform fees and Stripe fees plus seller churn.

<a id="bt-064"></a>
### BT-064 · P1 · effort S · Pre-order ship date and drop deadline (180d) exceed the 60-day auto-refund

- **Where:** drop-create / product-edit · `artifacts/api-server/src/lib/money/dropLifecycle.ts:30,artifacts/api-server/src/lib/money/dropLifecycle.ts:59-64,artifacts/api-server/src/lib/delivery/policy.ts:205-227,artifacts/api-server/src/lib/delivery/deliveryState.ts:61-64`
- **Problem:** Drops may have a fulfillment deadline up to 180 days out, and validatePreorderListing only checks the ship date is in the future (no max). Each pre-order item's deliver_by is fixed at paid_at + 60 days, so a drop shipping on day 90 auto-refunds every buyer at day 60. By then the seller has often paid the manufacturer bulk card from held funds (pay-from-wallet).
- **Why it costs money:** Refunds exceed what is held. The shortfall is 'owed' by the seller but never collected, so Brandthread funds the buyers' refunds.
- **Fix:** Cap preOrderEstShipDate and fulfillmentDeadlineAt so delivery fits in 60 days, or set preorder deliver_by = promised ship date + 15 days (max 180).
- **$ impact:** One mis-dated $20k drop with bulk paid costs Brandthread up to the bulk amount (e.g. $8-12k).

<a id="bt-065"></a>
### BT-065 · P1 · effort M · Seller can drain held pre-order money to any 'manufacturer' at any price

- **Where:** sample-orders / pay-from-wallet · `artifacts/api-server/src/routes/sample-orders.ts:150-206,artifacts/api-server/src/routes/sample-orders.ts:757-812`
- **Problem:** The seller alone creates a bulk production order with a self-chosen priceCents against any manufacturer id, then pays it from the drop wallet. Nothing requires the manufacturer to accept or quote, checks that the manufacturer isn't controlled by the seller, or caps the amount below collected pre-order money. The money leaves as a Stripe transfer before any buyer item ships.
- **Why it costs money:** A seller with an alt manufacturer account converts buyers' held pre-order cash into withdrawable money. When the drop fails, buyers are refunded and the shortfall is uncollected, so Brandthread pays.
- **Fix:** Require manufacturer acceptance of the quote, a verified manufacturer, and no shared identity, bank or Stripe person with the seller. Cap wallet-funded bulk at a % of held funds, or release it to the manufacturer only on shipment proof.
- **$ impact:** Fraud exposure equals pre-order GMV per drop. One incident could cost $10k+.

<a id="bt-066"></a>
### BT-066 · P1 · effort M · Platform-wide loyalty and referral points are deducted from the seller's payout and the fee basis

- **Where:** buyer-checkout (hosted, rewards applied) · `artifacts/api-server/src/routes/buyer.ts:977-979,artifacts/api-server/src/routes/webhooks.ts:987-993,artifacts/api-server/src/routes/loyalty.ts:8-13`
- **Problem:** Brandthread loyalty points (100 on signup, 500 per referral, 1 per $1 at any store) are redeemed against any seller's order. The code treats them as 'seller-funded': they reduce both the 5% fee basis and the seller's payout (no top-up, unlike Thread Cash).
- **Why it costs money:** Sellers pay for Brandthread's own buyer-referral program, which contradicts 'referral rewards for buyers, paid by Brandthread' and creates seller disputes. The platform also loses 5% on each redeemed dollar.
- **Fix:** Treat loyalty like Thread Cash: exclude it from the fee basis and top up or add it to seller_held from a platform loyalty-expense account. Alternatively, fold loyalty into Thread Cash.
- **$ impact:** ~1% of GMV earn-back = ~$10k/mo shifted to sellers once redeemed, plus 5% of that in lost fee.

<a id="bt-067"></a>
### BT-067 · P1 · effort L · No sales-tax collection unless each seller registers in Stripe Tax; platform is facilitator

- **Where:** taxes-duties / buyer-checkout · `artifacts/api-server/src/lib/money/cartCheckout.ts:325-361,artifacts/api-server/src/routes/buyer.ts:1173-1176,artifacts/api-server/src/routes/taxes.ts:111-118,artifacts/api-server/src/routes/webhooks.ts:684-693`
- **Problem:** Tax is calculated on the seller's connected account (stripeAccount: seller), which returns $0 unless that Express seller added state registrations. POST /taxes/enable only sets tax_behavior. Brandthread is the charging party (hold/transfer) and a marketplace facilitator under most US state laws once state thresholds are met, so the platform, not the seller, owes the uncollected tax. Collected tax is passed to sellers inside their transfer.
- **Why it costs money:** Uncollected sales tax becomes a platform liability plus penalties, and collected tax handed to sellers may also be owed by Brandthread as facilitator.
- **Fix:** Calculate tax on the platform account with Brandthread's facilitator registrations, keep the tax portion out of seller transfers, and remit centrally. Get a CPA opinion before launch.
- **$ impact:** ~7% of taxable GMV once thresholds are crossed: on $1M/mo, ~$70k/mo of potential liability accrual.

<a id="bt-068"></a>
### BT-068 · P1 · effort M · Seller debts ('owed') are displayed but never collected

- **Where:** finance · `artifacts/api-server/src/routes/finance.ts:296-327,artifacts/api-server/src/routes/finance.ts:438,docs/payments/money-flow.md:381-382`
- **Problem:** Drop shortfalls, failed label recoveries, external refunds and dispute withdrawals are recorded as platform_funds_advanced or negative seller_held. The doc says 'collection policy is an owner decision', and no code nets them against future transfers or uses account debits.
- **Why it costs money:** Every seller debt becomes a platform write-off, and sellers learn they can walk away.
- **Fix:** Add owed-netting to settleTransferOrder and executeOrderRelease, and block cash-outs while owed > 0. For large debts, use Stripe account debits (Custom) or invoices.
- **$ impact:** Sums the leaks above: likely $3-8k/mo at scale.

<a id="bt-069"></a>
### BT-069 · P1 · effort S · Connect events (account.updated, payout.paid) need a Connect endpoint and secret; neither exists

- **Where:** payout-setup / payouts · `artifacts/api-server/src/routes/webhooks.ts:357-364,artifacts/api-server/src/lib/ensureWebhookEvents.ts:22-46,artifacts/api-server/src/lib/stripe.ts:123`
- **Problem:** Connected-account events are delivered only to a Connect webhook endpoint (a separate endpoint with its own signing secret). The server verifies with a single STRIPE_WEBHOOK_SECRET and manages one account endpoint, and payout.paid isn't in REQUIRED_EVENTS. users.stripe_account_status is refreshed only when the seller opens GET /connect/status. payout.failed is not handled at all.
- **Why it costs money:** Sellers who finish Stripe onboarding outside the app stay 'pending' and can't sell. Restricted sellers keep selling while transfers fail. Failed bank payouts go unnoticed.
- **Fix:** Add a Connect webhook endpoint with STRIPE_CONNECT_WEBHOOK_SECRET (try both secrets), and subscribe account.updated, payout.paid, payout.failed and capability.updated.
- **$ impact:** Lost first sales from new sellers stuck in 'pending'. 5% of onboarded sellers stuck = ~$2-5k GMV/mo.

<a id="bt-070"></a>
### BT-070 · P1 · effort S · Seller-typed tracking numbers are not verified against destination, so any delivered parcel unlocks payout

- **Where:** orders (add tracking) · `artifacts/api-server/src/lib/delivery/trackingSync.ts:98-104,artifacts/api-server/src/lib/delivery/trackingSync.ts:123-131,artifacts/api-server/src/lib/delivery/payoutGate.ts:53-55`
- **Problem:** A seller can type any real tracking number (e.g. one of their own delivered parcels). The hourly poll maps DELIVERED to delivered_at and payout_release_at, and the seller is paid in 3 days. Nothing checks the Shippo track's destination ZIP or city against the order address.
- **Why it costs money:** The buyer never receives the goods and files a chargeback on the platform account after the payout.
- **Fix:** Compare the track's address_to ZIP or city with the order shipping address before accepting delivered. Otherwise require buyer confirmation for manual tracking.
- **$ impact:** Fraud: full order value + $15 per incident. A few % of bad sellers could cost $2-10k/mo.

<a id="bt-071"></a>
### BT-071 · P1 · effort M · Hold delays all seller payouts ~18+ days with no explanation in payout screens

- **Where:** payouts / finance / payout-schedule · `artifacts/mobile/app/payouts.tsx:323-345,artifacts/mobile/app/finance.tsx:119-125,artifacts/api-server/src/lib/delivery/policy.ts:38-41`
- **Problem:** Payouts and finance screens show Stripe available/pending balance, but most seller money now sits on the platform until delivery + 3 days. Neither payouts.tsx nor finance.tsx contains any 'delivery' or 'hold' copy. Sellers see $0 available for weeks after their first sales.
- **Why it costs money:** New sellers think they're not being paid, which means support tickets, churn before the first payout, and bad reviews.
- **Fix:** Show a per-order 'Paid after delivery + 3 days' timeline and a 'held for delivery' total on payouts.tsx, using /finance/summary held, and set expectations during onboarding.
- **$ impact:** If 10% of new sellers churn over the payout delay: ~$5k GMV/mo lost early.

<a id="bt-072"></a>
### BT-072 · P1 · effort S · Buyer refund request with photos always fails (local file URIs sent as evidence)

- **Where:** buyer-refund-request · `artifacts/mobile/app/buyer-refund-request.tsx:68,artifacts/mobile/app/buyer-refund-request.tsx:89-96,artifacts/mobile/services/cartService.ts:983-989,artifacts/api-server/src/routes/returns.ts:182-185`
- **Problem:** The screen sends ImagePicker asset URIs (file://) as evidenceUrls. The server only accepts URLs starting with the buyer's evidence upload prefix, so any request with photos gets a 400 and the generic 'Could not submit' alert. The request also goes to /returns, which rejects orders that aren't shipped or delivered.
- **Why it costs money:** Buyers who can't request a refund in-app file chargebacks instead ($15 fee + amount on the platform account).
- **Fix:** Upload photos via POST /returns/evidence first and send the returned URLs. Route pre-shipment cases to the buyer cancel endpoint.
- **$ impact:** Every chargeback that replaces a refund costs an extra $15. ~30/mo = ~$450 + dispute-ratio risk.

<a id="bt-073"></a>
### BT-073 · P2 · effort S · $15 Stripe dispute fee not modelled, always borne by Brandthread

- **Where:** dispute-detail · `artifacts/api-server/src/lib/money/disputes.ts:16-18,artifacts/api-server/src/lib/disputes/webhook.ts:140,docs/payments/money-flow.md:131-132`
- **Problem:** The dispute fee is stored on dispute_events.payload.feeCents but never posted to the ledger or charged to the seller. In hold mode the dispute fee is debited from the platform balance.
- **Why it costs money:** Every chargeback costs Brandthread $15, whether won or lost (Stripe refunds it only on some wins).
- **Fix:** Post the fee as a seller debit (seller_held or platform_funds_advanced) and recover it from the next release, or price it into policy. Document the decision.
- **$ impact:** ~$15 per dispute. At ~50 disputes/mo (0.5% of 10k orders), ~$750/mo.

<a id="bt-074"></a>
### BT-074 · P2 · effort S · Connect Express platform fees ($2/active account, 0.25%+25c per payout) unmodelled

- **Where:** payouts / payout-schedule · `artifacts/api-server/src/routes/connect.ts:95-106,artifacts/api-server/src/routes/finance.ts:1078-1103,artifacts/mobile/app/payout-schedule.tsx:121`
- **Problem:** Sellers are Express accounts where the platform pays Connect's per-active-account and per-payout fees. Nothing in fees.ts, ledger or seller pricing accounts for them. Sellers can pick a 'daily' payout schedule, which maximises per-payout fees.
- **Why it costs money:** These costs come straight out of the 5%. 0.25% of payout volume is 5% of Brandthread's commission, plus $2 per active seller per month.
- **Fix:** Default sellers to weekly payouts, model the Connect fees in the ledger, and price them into plans or pass them through.
- **$ impact:** $1M payouts: 0.25% = $2.5k + 25c x ~4k payouts = $1k + $2 x 500 sellers = $1k, so ~$4.5k/mo.

<a id="bt-075"></a>
### BT-075 · P2 · effort S · Gift card purchases: platform pays Stripe processing, takes no commission on that payment

- **Where:** gift-card-buy · `artifacts/api-server/src/lib/giftCards/purchase.ts:52-60,artifacts/api-server/src/lib/giftCards/payout.ts:46-72,artifacts/api-server/src/routes/checkout-intent.ts:164-168`
- **Problem:** Gift-card PaymentIntents are charged on the platform with no fee recorded. At redemption, the full face value is transferred to the seller. The ~2.9%+30c Stripe fee on the gift card purchase is never passed on, and unredeemed balances sit as platform liability (escheat/unclaimed-property exposure).
- **Why it costs money:** Every purchased gift card costs Brandthread ~3% plus 30c.
- **Fix:** Deduct the processing fee from the seller's gift card payout at redemption, or charge the buyer a fee. Track breakage and escheat by state.
- **$ impact:** $20k/mo of gift card sales x 3.2% = ~$640/mo.

<a id="bt-076"></a>
### BT-076 · P2 · effort M · Gift card seller payout ignores the delivery hold and partial refunds

- **Where:** buyer-checkout · `artifacts/api-server/src/lib/giftCards/checkout.ts:100-117,artifacts/api-server/src/lib/giftCards/payout.ts:95-128`
- **Problem:** The gift-card portion is transferred to the seller as soon as the order webhook runs, not after delivery and the buffer. It is reversed only on a FULL refund. A partial or auto refund of undelivered items leaves the seller with the gift card money, and the reversal fails if the seller already cashed out.
- **Why it costs money:** Hold-mode protection is bypassed for the gift-card share, so refund losses fall on the platform.
- **Fix:** Book the gift card amount into seller_held for the order and release it with settleTransferOrder. Reverse proportionally on partial refunds.
- **$ impact:** Small at launch (<$500/mo), but it multiplies the seller-issued-card exploit.

<a id="bt-077"></a>
### BT-077 · P2 · effort S · Platform returns its 5% on every refund, including seller-fault auto-refunds

- **Where:** server · `artifacts/api-server/src/lib/money/refunds.ts:284-289,artifacts/api-server/src/lib/money/refunds.ts:356-358,artifacts/api-server/src/lib/money/fees.ts:162-179`
- **Problem:** platformFeeRefundCents returns Brandthread's commission proportionally on every refund reason: not_delivered (seller failed to ship), seller_cancelled, oversold and drop_failed. The platform still paid Stripe processing and support costs on that sale.
- **Why it costs money:** Brandthread earns $0 on seller-caused failures while bearing the costs, which is not standard (Etsy and eBay keep fees on seller cancellations).
- **Fix:** Keep the platform fee on seller_cancelled, not_delivered, oversold and drop_failed refunds (charge it to the seller's held money). Return it only on buyer_cancelled or approved returns.
- **$ impact:** ~5% of seller-fault refunds: $40k/mo x 5% = ~$2k/mo.

<a id="bt-078"></a>
### BT-078 · P2 · effort M · Returns have no return window and can arrive after payout, so clawback depends on seller balance

- **Where:** buyer-return-request / return-detail · `artifacts/api-server/src/routes/returns.ts:213-219,artifacts/api-server/src/lib/money/refunds.ts:226-231,artifacts/api-server/src/lib/money/refunds.ts:307-324`
- **Problem:** POST /returns accepts any shipped or delivered order with no time limit. The payout goes out at delivery + 3 days. A later return refund reverses the transfer only if the seller's Stripe balance covers it. On failure it just logs, and the remainder goes to the orphan seller_held row (never collected).
- **Why it costs money:** With Express accounts the platform bears negative balances, so refunds on returns after payout leak to Brandthread.
- **Fix:** Enforce a return window (e.g. 14 or 30 days from delivery) and set PAYOUT_RELEASE_BUFFER_DAYS to that window, or keep a rolling reserve. Recover failed reversals from the next transfers.
- **$ impact:** ~1-2% of GMV returned post-payout x ~20% unrecoverable = ~$2-4k/mo.

<a id="bt-079"></a>
### BT-079 · P2 · effort S · Webhook 'transfer' ledger can be unbalanced if quoted fee differs from webhook split

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1008-1016,artifacts/api-server/src/lib/money/escrow.ts:184-191,artifacts/api-server/src/lib/money/escrow.ts:217-230`
- **Problem:** For transfer orders, recordOrderPaid uses split.sellerNetCents (computed with split.platformFeeCents) but posts platform_revenue = decidedPlatformFee (the checkout-time fee). If the two differ (Stripe discount rounding, coupon capped, fee capped at preTaxTotal vs gross), the postings don't sum to zero. The deferred balance trigger then rejects the whole order transaction, so the webhook fails forever and the buyer is charged with no order.
- **Why it costs money:** Silent order loss on edge cases leads to chargebacks.
- **Fix:** Recompute sellerNet = gross - decidedPlatformFee - processing in the transfer/held branch, as the destination branch already does.
- **$ impact:** Rare. Each occurrence costs a full order + a $15 dispute.

<a id="bt-080"></a>
### BT-080 · P2 · effort S · Production boots with Stripe test keys; no live-mode guard

- **Where:** server · `artifacts/api-server/src/lib/env.ts:27-28,artifacts/api-server/src/lib/appEnv.ts:24-45,artifacts/api-server/src/lib/stripe.ts:19-21`
- **Problem:** env.ts requires STRIPE_SECRET_KEY in production but accepts sk_test_. Only staging is checked (refusing live keys). EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY has no mode check against the server key either.
- **Why it costs money:** Launching on test keys means 'orders' take no real money until someone notices.
- **Fix:** In production, refuse to boot unless STRIPE_SECRET_KEY matches sk_live_ or rk_live_. Add a /health check comparing the publishable key mode.
- **$ impact:** Blocks all revenue for the duration of the mistake.

<a id="bt-081"></a>
### BT-081 · P2 · effort S · Connect accounts hard-coded to US individual Express

- **Where:** payout-setup · `artifacts/api-server/src/routes/connect.ts:95-106`
- **Problem:** accounts.create always uses country 'US' and business_type 'individual'. LLC or corporate sellers must onboard as individuals (wrong 1099/W-9 entity), and non-US brands cannot onboard at all. The account is created the first time the seller taps, so a wrong prefill sticks.
- **Why it costs money:** Lost non-US sellers, KYC friction, and tax reporting errors for business sellers.
- **Fix:** Ask country and entity type before creating the account (or omit business_type so Stripe asks). Support Canada/UK if marketing reaches them.
- **$ impact:** If 10% of seller signups are LLCs or non-US: ~10% of new seller GMV at risk.

<a id="bt-082"></a>
### BT-082 · P2 · effort S · 'Stripe files your 1099' claim unconfigured; 1099-K thresholds outdated

- **Where:** payout-setup / taxes-duties · `artifacts/api-server/src/lib/connectOnboarding.ts:139-141,artifacts/api-server/src/lib/sellerTaxLedger.ts:50-85,artifacts/api-server/src/routes/taxes.ts:179-249`
- **Problem:** The UI tells sellers 'W-9 on file. Stripe files your 1099'. Stripe only does that if the platform enables Connect tax reporting (per-form fees billed to the platform), and as charging party (hold mode) Brandthread is the filer of record. The threshold table shows $2,500 (2025) and $600 (2026+). Federal law since July 2025 (OBBBA) restored $20,000 and 200 transactions (verify).
- **Why it costs money:** IRS penalties for missed or incorrect 1099-K filings (~$310 per form). Over-filing at $600 means paying Stripe per-form fees for hundreds of tiny sellers.
- **Fix:** Enable Stripe Connect 1099 reporting with the correct thresholds, budget per-form fees, and correct the copy and threshold table.
- **$ impact:** Annual: ~$3-5 per form x sellers over threshold. The penalty tail is far larger.

<a id="bt-083"></a>
### BT-083 · P2 · effort S · Radar: docs assume destination charges; rules not configured, review events not subscribed

- **Where:** server · `docs/payments/radar-rules.md:4-17,docs/payments/radar-rules.md:178-180,artifacts/api-server/src/lib/ensureWebhookEvents.ts:22-46`
- **Problem:** radar-rules.md describes Connect destination charges, but production uses platform charges (hold or transfer). Every rule in it is Dashboard-only, with nothing in code verifying it. review.opened and review.closed are not in REQUIRED_EVENTS, so the seller 'Review before shipping' pill never updates from Radar reviews. Radar for Fraud Teams is needed for any custom rule and is not budgeted.
- **Why it costs money:** Card-testing and stolen-card fraud land as platform chargebacks ($15 fee + goods + dispute-ratio risk).
- **Fix:** Update the doc for platform charges, enable Radar for Fraud Teams with B1-B5, R1 and S3, and add review events to REQUIRED_EVENTS.
- **$ impact:** Radar Teams ~$0.02-0.07/txn x 10k = $200-700/mo, versus fraud losses of several $k/mo.

<a id="bt-084"></a>
### BT-084 · P2 · effort S · Thread Cash top-up failures on destination orders are retried only on webhook redelivery

- **Where:** server · `artifacts/api-server/src/lib/threadCash/checkoutTopup.ts:54-65,artifacts/api-server/src/routes/webhooks.ts:1351-1355`
- **Problem:** If transfers.create fails (insufficient platform balance, network), the code logs 'will retry on next webhook delivery'. The webhook still returns 200, so Stripe never redelivers, and no sweep exists for missing top-ups.
- **Why it costs money:** The seller is permanently short-paid by the Thread Cash amount (immediate mode), which drives support cost and churn.
- **Fix:** Add top-ups to moneySweep: orders where thread_cash_applied_cents > 0 AND stripe_thread_cash_transfer_id IS NULL.
- **$ impact:** Small. Only relevant in immediate mode.

<a id="bt-085"></a>
### BT-085 · P2 · effort S · Buyer cancel within 21 days (pre-ship) refunds in full; platform eats Stripe fee

- **Where:** buyer order detail (cancel) · `artifacts/api-server/src/routes/buyer.ts:1579-1625,artifacts/api-server/src/lib/money/refunds.ts:366-371`
- **Problem:** Buyers can cancel any unshipped order for 21 days, getting a full refund including shipping. In hold mode the non-refundable Stripe fee plus the returned 5% leave a negative orphan seller_held that is never collected.
- **Why it costs money:** Brandthread pays ~3.2% of every buyer-cancelled order and earns nothing.
- **Fix:** Charge the processing fee to the seller's held funds (or to the buyer as a cancellation fee), shorten the window to 24-48h pre-shipment, and net seller debts.
- **$ impact:** 3% cancel rate x $1M x 3.2% = ~$1k/mo.

<a id="bt-086"></a>
### BT-086 · P2 · effort S · Label bought, then order auto-refunded: label cost and fees fall to platform

- **Where:** orders / shipping-labels · `artifacts/api-server/src/lib/money/escrow.ts:682-694,artifacts/api-server/src/lib/delivery/autoRefund.ts:119-126,artifacts/api-server/src/lib/money/refunds.ts:366-371`
- **Problem:** In hold mode a label is paid from the order's held funds. If the parcel never gets a delivered scan, auto-refund returns the full charged amount (items + shipping). Held funds no longer cover it, and the gap (label + Stripe fee) goes to the orphan seller-level row.
- **Why it costs money:** Brandthread funds the label and the Stripe fee on every undelivered-but-labelled order.
- **Fix:** Net seller-level debt from future transfers. If no carrier scan occurred within N days, void the unused label via Shippo refundTransaction automatically.
- **$ impact:** ~$10 per occurrence. 200/mo = ~$2k/mo.

<a id="bt-087"></a>
### BT-087 · P2 · effort M · Pre-order buyer dispute window (120d after expected delivery) exceeds held period

- **Where:** server · `docs/payments/money-flow.md:308-311,artifacts/api-server/src/lib/delivery/payoutGate.ts:33-38`
- **Problem:** Card networks allow 'not received' or 'not as described' disputes up to 120 days after expected delivery. Hold mode releases at delivery + 3 days, and there is no rolling reserve (PAYOUT_POLICY_ENFORCED=false, payoutPolicy.ts:55).
- **Why it costs money:** Late disputes are paid by the platform (see the no-reversal finding).
- **Fix:** Enable the reserve mode (RESERVE_BPS 10% for 30-90 days) for new or high-risk sellers, and wire PAYOUT_POLICY_ENFORCED.
- **$ impact:** Reduces dispute leakage (~$3k/mo) by about half.

<a id="bt-088"></a>
### BT-088 · P2 · effort S · Webhook idempotency solid; external dashboard refunds booked as uncollected seller debt

- **Where:** server · `artifacts/api-server/src/lib/money/refunds.ts:511-575`
- **Problem:** Refunds issued in the Stripe Dashboard on released or destination orders are booked to platform_funds_advanced ('seller owes') without reversing the seller transfer. Any ops refund made in the Dashboard is therefore paid by Brandthread.
- **Why it costs money:** Support staff refunding via the Dashboard leak 100% of the refund amount.
- **Fix:** Add an admin refund endpoint that uses refundOrder, and block or alert on Dashboard refunds.
- **$ impact:** Every Dashboard refund is a 100% loss: ~$500-2k/mo depending on ops habits.

<a id="bt-089"></a>
### BT-089 · P2 · effort S · Seller payout status 'active' requires charges_enabled although hold mode needs only transfers

- **Where:** payout-setup / product listing · `artifacts/api-server/src/routes/connect.ts:100,artifacts/api-server/src/routes/connect.ts:293-299,artifacts/api-server/src/lib/money/cartCheckout.ts:209-211`
- **Problem:** Accounts request card_payments, and checkout requires stripeAccountStatus 'active' (charges_enabled && payouts_enabled). In hold mode the platform charges and only transfers is needed, so the extra card_payments KYC requirements delay or block sellers from their first sale.
- **Why it costs money:** Slower time-to-first-sale, so more sellers abandon onboarding.
- **Fix:** In hold mode, gate selling on the transfers capability (payouts can come later, as the transfer waits) and request card_payments only if destination mode is used.
- **$ impact:** A few % more activated sellers: ~$2k GMV/mo.

<a id="bt-090"></a>
### BT-090 · P3 · effort S · Stripe Tax calculation on every quote: per-call cost on the platform

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/checkout-intent.ts:150-172,artifacts/api-server/src/routes/checkout-intent.ts:224-245,artifacts/api-server/src/lib/money/cartCheckout.ts:334-357`
- **Problem:** POST /quote (called on address changes and wallet-sheet updates) and POST / each call stripe.tax.calculations.create for every seller group. Stripe Tax API usage is billed, and for Express accounts Connect fees are billed to the platform. It is not cached by address and cart.
- **Why it costs money:** Several billable tax calculations per completed checkout (quotes x seller groups), most of which never convert.
- **Fix:** Cache calculations per (cart hash, ZIP) for 10-30 minutes, and only call Stripe Tax at final create when the address hasn't changed.
- **$ impact:** Assuming ~$0.05+ per call x ~5 calls per checkout x 10k checkouts = ~$2.5k/mo (verify current Stripe Tax pricing).

<a id="bt-091"></a>
### BT-091 · P3 · effort S · Free-shipping discount codes reduce the 5% fee basis by the shipping amount

- **Where:** buyer-checkout / discount-codes · `artifacts/api-server/src/routes/buyer.ts:950-953,artifacts/api-server/src/routes/buyer.ts:1036-1040,artifacts/api-server/src/lib/money/cartCheckout.ts:273-284`
- **Problem:** discountCodeAmountCents includes the waived shipping amount, and merchandiseCents = subtotal - combinedDiscount. A free-shipping code lowers the commission basis by the shipping cost even though merchandise wasn't discounted.
- **Why it costs money:** This is lost commission on every free-shipping code order.
- **Fix:** Use merchandiseDiscountCents (exclude shippingDiscountCents) for the fee basis in both buyer.ts and cartCheckout.priceCartGroup.
- **$ impact:** ~$8 shipping x 5% x 3k free-ship orders = ~$1.2k/mo.

<a id="bt-092"></a>
### BT-092 · P3 · effort S · Stripe key missing: checkout returns 503 silently; payouts screen hides it

- **Where:** buyer-checkout / payouts · `artifacts/api-server/src/lib/stripe.ts:22-29,artifacts/api-server/src/routes/connect.ts:251-270,artifacts/api-server/src/routes/checkout-intent.ts:199-206`
- **Problem:** With no STRIPE_SECRET_KEY (allowed outside NODE_ENV=production), every money route returns 503 STRIPE_NOT_CONFIGURED. connect/status returns 'provider_unavailable' instead of erroring. There is no alert or health signal, so a misconfigured deploy looks healthy.
- **Why it costs money:** Silent revenue outage.
- **Fix:** Expose stripeConfigured in /health and page on it. Make APP_ENV=production (not just NODE_ENV) enforce the key.
- **$ impact:** Outage minutes x GMV rate.

<a id="bt-093"></a>
### BT-093 · P3 · effort S · Fee schedule and quote API always show 5%, ignoring plan rate and BNPL fees

- **Where:** fees / subscription · `artifacts/api-server/src/lib/money/feeSchedule.ts:261-295,artifacts/api-server/src/routes/fees.ts:19-27,artifacts/mobile/app/fees.tsx:37-38,artifacts/mobile/app/subscription.tsx:343,artifacts/mobile/app/subscription.tsx:552`
- **Problem:** getFeeSchedule and quoteSale use PLATFORM_FEE_BPS and 2.9%+30c for everyone. Actual charges use plan bps (3-5%) and Stripe's real fee, including BNPL (Klarna/Afterpay ~6%+30c) passed to sellers in transfer mode.
- **Why it costs money:** Sellers who see more deducted than quoted file support tickets and churn. Mismatched 'fees' copy also risks App Store and FTC fee-transparency issues.
- **Fix:** Make the fee quote seller-aware (plan bps) and show BNPL as a separate line, or absorb or limit BNPL.
- **$ impact:** Support and churn: hard to size, <$1k/mo.

<a id="bt-094"></a>
### BT-094 · P3 · effort S · Processing estimate (2.9%+30c on pre-tax) undercharges in immediate mode; variance eaten by platform

- **Where:** server · `artifacts/api-server/src/lib/money/fees.ts:20-21,artifacts/api-server/src/lib/money/fees.ts:132-153,artifacts/api-server/src/lib/money/escrow.ts:247-255`
- **Problem:** With PAYOUT_MODE=immediate, application_fee = 5% + 2.9% x pre-tax total + 30c. Stripe's real fee is on the tax-inclusive total plus +1.5% international and +1% FX, and BNPL is ~6%. The difference is posted to processing_fee_variance and absorbed by Brandthread.
- **Why it costs money:** Roughly 0.2-0.5% of GMV in immediate mode, more with international or BNPL buyers.
- **Fix:** Keep hold or transfer as the only mode, or charge the actual fee by computing application_fee after the charge.
- **$ impact:** Only if Dev flips to immediate: ~$2-5k/mo at $1M GMV.

<a id="bt-095"></a>
### BT-095 · P3 · effort S · Sample/bulk manufacturer charges: 5% application fee must absorb Stripe's fee

- **Where:** sample-orders · `artifacts/api-server/src/routes/sample-orders.ts:193,artifacts/api-server/src/routes/sample-orders.ts:338-341,docs/payments/money-flow.md:383`
- **Problem:** Seller card payments for samples and bulk are destination charges with application_fee_amount = 5% only. On destination charges Stripe debits the platform for processing (2.9%+30c, plus 1.5% for international cards), so Brandthread nets ~2%. Bulk orders paid from held funds carry 0% fee. Refunds and disputes on these charges also hit the platform.
- **Why it costs money:** Thin or negative margin on large B2B tickets.
- **Fix:** Add the processing estimate to application_fee_amount (as for buyer orders) and take the fee on wallet-funded bulk too.
- **$ impact:** $50k/mo bulk volume x ~3% = ~$1.5k/mo.

<a id="bt-096"></a>
### BT-096 · P3 · effort S · Instant payout fee constant 1%: Stripe US instant payout pricing likely 1.5%

- **Where:** payout-schedule / payouts · `artifacts/api-server/src/lib/money/payoutPolicy.ts:63-64,docs/payments/payout-policy.md:29-31`
- **Problem:** INSTANT_PAYOUT_FEE_BPS=100 is used for the seller quote and the maxInstantPayoutCents cap. If Stripe charges more (current US pricing is 1.5%, min $0.50, verify) or bills Express instant-payout fees to the platform, quotes are wrong and payouts can fail for insufficient balance.
- **Why it costs money:** Failed cash-outs or platform-borne instant fees.
- **Fix:** Verify against stripe.com/pricing and the Connect fee settings, read the fee from Stripe's payout balance transaction, and add a platform margin if desired.
- **$ impact:** 0.5% of instant volume: $100k instant = $500/mo.

<a id="bt-097"></a>
### BT-097 · P3 · effort S · Statement CSV download opens an unauthenticated URL (401)

- **Where:** finance · `artifacts/mobile/app/finance.tsx:113-117,artifacts/api-server/src/routes/finance.ts:555`
- **Problem:** handleDownloadStatement calls Linking.openURL on /api/finance/statement.csv without the Clerk bearer token, and the route requires auth. Sellers get an error page.
- **Why it costs money:** Sellers can't reconcile payouts or taxes, which adds support load and erodes trust.
- **Fix:** Fetch with auth and share the file via expo-sharing, or mint a short-lived signed download URL.
- **$ impact:** Support cost only.

<a id="bt-098"></a>
### BT-098 · P3 · effort S · Shipping labels sold at cost: no margin, and Shippo fees absorbed

- **Where:** shipping-labels · `artifacts/api-server/src/routes/shipping-labels.ts:92-100,artifacts/api-server/src/routes/shipping-labels.ts:207`
- **Problem:** The label price shown and charged is exactly rate.amount from Shippo. Shippo per-label or plan fees and failed or voided label costs are not passed on, and there is no markup.
- **Why it costs money:** Shipping is a common marketplace profit line (Etsy and Poshmark keep label margin), and Brandthread currently loses money on it.
- **Fix:** Add a small markup (e.g. 25-50c or 5%), or at least pass through the Shippo plan fee.
- **$ impact:** +$0.40 x 8k labels = ~$3.2k/mo upside.

<a id="bt-099"></a>
### BT-099 · P3 · effort S · Return labels on paid-out orders recovered by transfer reversal that can fail

- **Where:** return-detail · `artifacts/api-server/src/lib/returnLabels.ts:142-158,artifacts/api-server/src/lib/money/escrow.ts:794-835`
- **Problem:** Return labels are bought on Brandthread's Shippo account and recovered by reversing the order's transfer. On a paid-out order, a reversal that fails for insufficient seller balance is only logged as 'owed', which is never collected.
- **Why it costs money:** Brandthread pays return shipping for sellers who withdrew their money.
- **Fix:** Require the seller's held or available balance to cover the label before purchase, or charge the seller's card on file.
- **$ impact:** <$500/mo.

<a id="bt-100"></a>
### BT-100 · P3 · effort S · Payout policy (reserve, international hold) is built but disabled and not wired to hold mode

- **Where:** payouts / finance · `artifacts/api-server/src/lib/money/payoutPolicy.ts:27-64,docs/payments/payout-policy.md:19,docs/payments/payout-policy.md:27`
- **Problem:** PAYOUT_POLICY_ENFORCED=false, and the doc says the delivery guarantee's PAYOUT_MODE is 'a separate mechanism and not wired into this policy'. International orders get no extra hold even though cross-border fraud and dispute rates are higher.
- **Why it costs money:** International orders carry higher dispute and fraud rates with no extra hold.
- **Fix:** Wire holdReleaseDate with extraHoldUntil = payout_release_at and enforce the international hold, or delete the dead config.
- **$ impact:** Small until international volume grows.

<a id="bt-101"></a>
### BT-101 · P3 · effort S · Docs claim in-stock orders are destination charges paid instantly; code defaults to hold

- **Where:** n/a · `docs/payments/money-flow.md:24-33,docs/payments/money-flow.md:42-48,artifacts/api-server/src/lib/money/escrow.ts:4-5,artifacts/api-server/src/lib/money/cartCheckout.ts:9-13`
- **Problem:** The money-flow rules table and the escrow.ts header still say 'In-stock orders are paid straight to the seller (destination charge)'. Since PAYOUT_MODE=hold, every in-stock order is a platform charge. cartCheckout.ts also says the seller 'stays the liable party' for tax, which is untrue for platform charges.
- **Why it costs money:** Dev and future engineers make Stripe, tax and legal decisions from stale docs.
- **Fix:** Rewrite money-flow.md sections 1-2 and the code headers to describe hold/transfer as the primary path.
- **$ impact:** Indirect.

<a id="bt-102"></a>
### BT-102 · P3 · effort S · Payment methods saved off_session on platform customer with no recurring use

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/buyer.ts:1197-1199`
- **Problem:** Hosted checkout always sets setup_future_usage: 'off_session'. This can trigger extra SCA/3DS friction, and for some wallets and BNPL methods it narrows which payment methods Checkout offers.
- **Why it costs money:** Small conversion loss at checkout.
- **Fix:** Use on_session, or only save cards when the buyer opts in (as one-page checkout does with saveCard).
- **$ impact:** <1% checkout conversion.

<a id="bt-103"></a>
### BT-103 · P3 · effort M · USD-only charges for international buyers: FX and international card fees passed to seller

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/checkout-intent.ts:384-387,artifacts/api-server/src/routes/buyer.ts:1179-1181,docs/payments/money-flow.md:384`
- **Problem:** Everything is charged in USD. International cards add 1.5%, plus 1% if converted, to Stripe's fee. In transfer mode the seller bears it without any quote showing it, and international buyers see USD prices plus bank FX markup.
- **Why it costs money:** Lower international conversion, and seller complaints about unexplained fees.
- **Fix:** Show the international fee in the seller fee quote. Consider Adaptive Pricing or local currency later.
- **$ impact:** Small at launch (US-focused).

<a id="bt-104"></a>
### BT-104 · P3 · effort S · Connect state-signing secret falls back to STRIPE_SECRET_KEY

- **Where:** payout-setup · `artifacts/api-server/src/routes/connect.ts:66-68`
- **Problem:** If CONNECT_STATE_SECRET is unset, the HMAC for the unauthenticated /onboard/refresh redirect is keyed with the Stripe secret key. That reuses the most sensitive credential for another purpose, and rotating it invalidates links.
- **Why it costs money:** Security hygiene: a key-reuse finding in audits or Stripe's partner review.
- **Fix:** Require a dedicated CONNECT_STATE_SECRET in production.
- **$ impact:** n/a (risk).

## Thread Cash, referrals, gift cards & incentive abuse

50 findings: 8 P0 · 23 P1 · 12 P2 · 7 P3

<a id="bt-105"></a>
### BT-105 · P0 · effort M · Seller cash-out converts ALL Thread Cash (incl. platform rewards) into real Stripe money

- **Where:** payouts · `artifacts/api-server/src/lib/threadCash/cashOut.ts:90,artifacts/api-server/src/lib/threadCash/cashOut.ts:112,artifacts/api-server/src/routes/thread-cash.ts:579`
- **Problem:** cashOutThreadCash checks getBalanceCents (the SUM of every ledger row) instead of only 'live_gift'/'send_received' earnings, then issues a platform-funded stripe.transfers.create 1:1 (RATE_BPS 10_000, FEE_BPS 0 at cashOut.ts:40-41). Daily check-in, streak bonus, referral credit and refund credit in a seller's own wallet are all cashable. Route is not feature-flagged; requirePermission('payouts') passes for every store owner.
- **Why it costs money:** Every reward Brandthread grants becomes withdrawable cash for anyone who connects Stripe; there is no cap, minimum, hold or velocity check, so rewards turn into direct cash outflow.
- **Fix:** Compute a cashable balance = live_gift + send_received from verified purchases only (or remove cash-out entirely until legal sign-off); add a feature flag (default off), daily cap, 7-day hold and manual review over a threshold.
- **$ impact:** Unbounded; at least $10 per new seller (referral) + ~$7/mo per seller check-in streak, and ~$1,500/mo per seller via the send ring (see next finding)

<a id="bt-106"></a>
### BT-106 · P0 · effort M · Farm ring: alt accounts -> 'send' to seller -> cash out = $1,500/month per seller

- **Where:** buyer-conversation / seller-conversation · `artifacts/api-server/src/lib/threadCash/wallet.ts:683,artifacts/api-server/src/lib/threadCash/wallet.ts:803,artifacts/api-server/src/routes/thread-cash.ts:433,artifacts/api-server/src/lib/threadCash/cashOut.ts:3`
- **Problem:** sendableBalanceCents treats daily_checkin/streak/referral credit as sendable; send requires only mutual follow + 24h account age; seller receive cap is 5000c per rolling 24h (streaks.ts:33). cashOut.ts:3 explicitly documents 'send_received' as cashable. A seller with ~5 alt accounts (each seeded with the $10 referral credit) can move $50/day of platform-funded credit into a cashable seller wallet.
- **Why it costs money:** Converts free platform credit into Stripe transfers out of Brandthread's balance: $50/day x 30 = $1,500/month per seller account, repeatable across any number of seller accounts.
- **Fix:** Make send_received NOT cashable (or only cashable when the sender's spent balance came from card-funded sources), block sends to accounts with a Stripe Connect account, and require the sender to have a paid order.
- **$ impact:** Up to $1,500/mo per abusing seller; 10 abusers = $15k/mo (30% of the $50k target)

<a id="bt-107"></a>
### BT-107 · P0 · effort S · New sellers get $10 referral Thread Cash on signup, cashable immediately

- **Where:** onboarding (seller) · `artifacts/mobile/app/onboarding.tsx:2414,artifacts/api-server/src/lib/referrals/rewards.ts:116,artifacts/api-server/src/lib/referrals/policy.ts:15`
- **Problem:** Seller onboarding calls api.referrals.apply, and applyReferralCode credits the invitee REFERRAL_INVITEE_REWARD_CENTS=1000 with no purchase and no role check. Because seller cash-out uses the whole balance, a new seller who types any invite code can withdraw $10 once Connect is linked.
- **Why it costs money:** Pays $10 cash per seller account created; business model says referral rewards are buyer-only.
- **Fix:** Reject /referrals/apply for accounts with accountType seller or a Stripe account; and fix cash-out source filtering.
- **$ impact:** $10 per seller signup; 500 seller signups = $5,000 one-off plus inviter rewards

<a id="bt-108"></a>
### BT-108 · P0 · effort M · Default payout mode makes the SELLER fund Thread Cash, not Brandthread

- **Where:** buyer-checkout · `artifacts/api-server/src/lib/money/checkoutPlan.ts:175,artifacts/api-server/src/lib/money/escrow.ts:192,artifacts/api-server/src/lib/threadCash/checkoutTopup.ts:39,artifacts/api-server/src/lib/delivery/policy.ts:35`
- **Problem:** PAYOUT_MODE defaults to 'hold' so in-stock orders use chargeModel 'transfer'. recordOrderPaid sets sellerNet = split.sellerNetCents = gross (card amount after Thread Cash) - fee - processing, and applyThreadCashSellerTopup returns early unless chargeModel==='destination'. buyer.ts:718 only blocks 'held'. A $50 item paid with $49.50 Thread Cash leaves the seller ~$0.
- **Why it costs money:** Breaks the core promise 'seller still gets full price'; once threadCashCheckoutDiscount is on, sellers are silently underpaid, leading to churn, disputes and support load.
- **Fix:** For 'transfer' orders compute sellerNet on the pre-Thread-Cash gross and post a thread_cash_seller_topup expense, or block Thread Cash for transfer orders. Add an integration test with PAYOUT_MODE=hold.
- **$ impact:** Blocks enabling checkout credit; if flipped as-is, sellers lose 100% of each Thread Cash amount

<a id="bt-109"></a>
### BT-109 · P0 · effort S · No self-purchase block: seller can buy own product with Thread Cash or gift card

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/buyer.ts:658,artifacts/api-server/src/routes/checkout-intent.ts:166`
- **Problem:** Neither hosted checkout (buyer.ts, sellerId resolved at :657) nor one-page checkout checks buyerId !== sellerId. With PAYOUT_MODE=immediate (destination) the platform top-up pays the seller the full Thread Cash amount for buying their own item; gift card payout has the same hole.
- **Why it costs money:** Self-dealing turns farmed credits into seller payouts paid from Brandthread's balance.
- **Fix:** Reject checkout when buyerId === sellerId or buyer is a team member of the store; flag orders where buyer and seller share device/payment fingerprint.
- **$ impact:** Equal to farmed balance; blocks safely enabling Thread Cash checkout

<a id="bt-110"></a>
### BT-110 · P0 · effort M · Referral invitee gets $10 on join with no purchase, unlimited per inviter

- **Where:** onboarding (buyer) · `artifacts/api-server/src/lib/referrals/rewards.ts:116,artifacts/api-server/src/lib/referrals/policy.ts:22,artifacts/api-server/src/routes/referrals.ts:199`
- **Problem:** applyReferralCode credits 1000c to the invitee immediately. REFERRAL_MAX_PAID_PER_INVITER=50 caps only the inviter's reward; invitee credits per code are unlimited. /referrals/apply has no rate limit, no account-age window and no device check (only email canonicalisation at policy.ts:83).
- **Why it costs money:** Every fake account farms $10 that is sendable (and then cashable via a seller) or spendable at checkout once enabled.
- **Fix:** Grant the invitee credit only as a discount on their first paid order (min $25), cap invitees per code per day, and require phone verification.
- **$ impact:** $10 per fake signup; 1,000 fake signups = $10k

<a id="bt-111"></a>
### BT-111 · P0 · effort S · Peer send flag was turned ON by default without the legal sign-off migration 085 required

- **Where:** buyer-conversation · `lib/db/migrations/085_thread_cash.sql:88,lib/db/migrations/088_thread_cash_hardening.sql:59,artifacts/mobile/contexts/FeatureFlagContext.tsx:40`
- **Problem:** Migration 085 says threadCashSend stays OFF 'until Dev confirms with a lawyer that peer-to-peer Thread Cash transfer does not trigger money-transmitter / App Store rules'. Migration 088 flips it ON citing only technical hardening. Combined with seller cash-out it is a P2P value-to-cash rail.
- **Why it costs money:** Money-transmitter exposure and App Review risk; it also powers the cash-out farm.
- **Fix:** Set threadCashSend false for launch until legal sign-off; at minimum block sends to accounts with Stripe Connect.
- **$ impact:** Regulatory/rejection risk; enables the $1.5k/mo per-seller leak

<a id="bt-112"></a>
### BT-112 · P0 · effort S · Cost model: up to $7.29/user/month; about $34k/month accrued at 20k MAU

- **Where:** n/a · `artifacts/api-server/src/lib/threadCash/streaks.ts:26,artifacts/api-server/src/lib/threadCash/streaks.ts:27,artifacts/api-server/src/lib/threadCash/streaks.ts:28,artifacts/api-server/src/lib/referrals/policy.ts:15`
- **Problem:** Arithmetic: daily 10c x 30 = $3.00; bonus 100c x (30/7 = 4.29) = $4.29; perfect-streak max = $7.29/user/mo ($87.50/yr). Blended at 20k MAU: 20% streakers x $7.29 = $1.46 + 30% casual (8 claim days, no bonus) x $0.80 = $0.24 -> $1.70/MAU -> $34k/mo accrued. Referrals: if 500 of ~2,000 new users/mo use a code -> $5k invitee + about 50% qualify -> $2.5k inviter. Total about $41.5k/mo of credit issued.
- **Why it costs money:** At 60% redemption this is about $25k/mo of real cash, half the $50k revenue target. Covering it needs $500k GMV/mo at 5% commission.
- **Fix:** Before launch, cut the bonus, set expiry 60-90 days, cap per-order redemption, add a monthly budget, and re-model with real retention data.
- **$ impact:** $25k-$41k/mo at 20k MAU; $146k/mo ceiling if every MAU streaks

<a id="bt-113"></a>
### BT-113 · P1 · effort S · Doc says Thread Cash checkout is 'implemented'; tests cover only destination charges

- **Where:** n/a · `docs/payments/thread-cash-checkout-todo.md:3,artifacts/api-server/src/lib/money/__tests__/threadCashCheckoutRoutes.integration.test.ts:169,docs/payments/money-flow.md:20`
- **Problem:** The todo doc claims the plan is built and covered end to end, but every test uses chargeModel 'destination' while money-flow.md says 'hold'/transfer is now the default. The default path is untested and wrong (see previous finding).
- **Why it costs money:** An operator could flip the flag on the strength of the doc and underpay every seller.
- **Fix:** Update the doc to 'NOT safe under PAYOUT_MODE=hold' and add transfer-model tests before sign-off.
- **$ impact:** Prevents a launch-day payout incident

<a id="bt-114"></a>
### BT-114 · P1 · effort M · Daily 7-minute reward is spoofable by a script in seconds

- **Where:** server · `artifacts/api-server/src/lib/threadCash/wallet.ts:177,artifacts/api-server/src/lib/threadCash/wallet.ts:225,artifacts/api-server/src/lib/threadCash/wallet.ts:247,artifacts/api-server/src/routes/thread-cash.ts:231`
- **Problem:** 'Use' is a client-reported activeSeconds (>=420) plus >=6 heartbeat rows; heartbeats are not time-spaced (each POST increments heartbeat_count, wallet.ts:193) and activeSeconds is taken from the claim body. A script can POST 6 heartbeats then /daily/claim with activeSeconds=420 instantly.
- **Why it costs money:** Bots earn the full reward (and 7-day streak bonus) per account without engaging, multiplying cost by every scripted account.
- **Fix:** Server-measure time: require heartbeats >=50s apart (store last_heartbeat_at) and compute active seconds server-side; add App Attest / Play Integrity on claim.
- **$ impact:** $7.29/mo per scripted account; 1,000 bot accounts = $7.3k/mo

<a id="bt-115"></a>
### BT-115 · P1 · effort M · Device cap is optional and client-supplied: omit deviceId to bypass

- **Where:** server · `artifacts/api-server/src/lib/threadCash/wallet.ts:256,artifacts/mobile/components/thread-cash/ThreadCashActiveTimeTracker.tsx:47`
- **Problem:** The per-device cap only runs `if (award.deviceId)`; deviceId is a random UUID in AsyncStorage the client chooses to send. Omitting it or rotating it defeats maxCheckInsPerDevicePerDay=3 (streaks.ts:35). No server-side device fingerprinting exists.
- **Why it costs money:** Multi-account farming is unbounded by device.
- **Fix:** Require a deviceId attested via App Attest/DeviceCheck (iOS) and Play Integrity (Android); reject claims without it.
- **$ impact:** Multiplies per-account cost by number of accounts per phone

<a id="bt-116"></a>
### BT-116 · P1 · effort S · Referral loyalty points (500 = $5) uncapped and paid on join, not purchase

- **Where:** buyer-invite · `artifacts/api-server/src/lib/referrals/rewards.ts:108,artifacts/api-server/src/lib/referrals/policy.ts:18`
- **Problem:** The inviter earns REFERRAL_JOIN_POINTS=500 ($5 of loyalty discount) for every invitee that joins, regardless of purchase and outside the 50-referral cap.
- **Why it costs money:** Fake signups generate $5 discount each, spendable at any store and funded by sellers (loyalty reduces the seller transfer and the 5% fee basis).
- **Fix:** Move the points to the qualifying-order hook and include them in the 50 cap.
- **$ impact:** $5 per fake invitee charged to sellers + 5% lost commission on the discount

<a id="bt-117"></a>
### BT-117 · P1 · effort S · Referral program is not buyer-only: sellers can invite and be invited

- **Where:** buyer-invite / onboarding · `artifacts/api-server/src/lib/referrals/rewards.ts:56,artifacts/mobile/app/onboarding.tsx:2414`
- **Problem:** applyReferralCode and qualifyReferralForOrder never check accountType/role; seller onboarding applies codes and sellers can generate codes via GET /referrals/code.
- **Why it costs money:** Contradicts the 'buyers only' business rule and, combined with cash-out, pays sellers cash.
- **Fix:** Enforce buyer accountType on both inviter and invitee server-side.
- **$ impact:** $10-$20 per seller referral pair

<a id="bt-118"></a>
### BT-118 · P1 · effort M · Self-referral only blocked by same Clerk id/email; alt accounts pass

- **Where:** server · `artifacts/api-server/src/lib/referrals/policy.ts:82,artifacts/api-server/src/lib/referrals/rewards.ts:76`
- **Problem:** Checks are inviter===invitee and canonical email equality. No device, payment-card fingerprint, IP or shipping-address match.
- **Why it costs money:** Users refer themselves from a second email on the same phone (8 accounts allowed) for $10 + $10 + 500 points.
- **Fix:** Compare Stripe card fingerprint and shipping address of the qualifying order with the inviter's, and device id at apply time.
- **$ impact:** $20+$5 per self-referral

<a id="bt-119"></a>
### BT-119 · P1 · effort S · Buyers can 'pay' sellers in chat with Thread Cash and skip the 5% commission

- **Where:** buyer-conversation / seller-conversation · `artifacts/mobile/app/buyer-conversation.tsx:70,artifacts/mobile/app/thread-cash-history.tsx:27,artifacts/api-server/src/lib/threadCash/cashOut.ts:3`
- **Problem:** ChatAttachThreadCash is wired into buyer and seller conversations; the seller history labels send_received as 'Message payment' and cash-out treats it as cashable. This is a payment for goods outside orders.
- **Why it costs money:** Platform-funded credit pays sellers directly with no order, no 5% commission, and no buyer protection.
- **Fix:** Remove the attach button from buyer-seller conversations, or route chat payments through a real order.
- **$ impact:** 100% of the amount sent plus lost 5% commission

<a id="bt-120"></a>
### BT-120 · P1 · effort S · Live gifts (when flag on) make platform rewards cashable with no follow gate

- **Where:** live · `artifacts/api-server/src/lib/threadCash/wallet.ts:853,artifacts/api-server/src/lib/threadCash/wallet.ts:912,artifacts/api-server/src/lib/liveTips.ts:15`
- **Problem:** sendLiveGift moves the viewer's reward balance (checkin/referral) to the host as 'live_gift'. There is no account-age check (unlike send), no mutual-follow check, and the host receive cap only counts live_gift, so it stacks with the separate $50/day send_received cap. Currently gated OFF by 'live_tips'.
- **Why it costs money:** When turned on, any alt account can gift its $10 referral credit to a seller's live within minutes of signup.
- **Fix:** Keep live_tips off for launch; when on, only allow gifting purchased value and apply minAccountAgeHoursForSend and a combined receive cap.
- **$ impact:** Another $50/day per seller host when enabled

<a id="bt-121"></a>
### BT-121 · P1 · effort M · Buyer-facing copy says Thread Cash can't be cashed out; code lets it be cashed out

- **Where:** thread-cash · `artifacts/mobile/app/thread-cash.tsx:349,artifacts/api-server/src/routes/thread-cash.ts:4`
- **Problem:** UI and route header state 'Thread Cash is not money: it can't be withdrawn, cashed out, or sent as cash' while the same wallet (shared by buyers and sellers, thread-cash.tsx:154) is cashed out at 1:1 via /cash-out.
- **Why it costs money:** Misleading terms create consumer-protection and App Review exposure, and weaken the legal position that Thread Cash is a non-cash reward.
- **Fix:** Separate buyer reward credit and seller earnings into two ledgers/balances and keep the copy true.
- **$ impact:** Legal/review risk; enables misclassification of liabilities

<a id="bt-122"></a>
### BT-122 · P1 · effort L · Buyer rewards and seller earnings share ONE balance per Clerk user

- **Where:** thread-cash / payouts · `artifacts/api-server/src/lib/threadCash/wallet.ts:60,artifacts/mobile/app/thread-cash.tsx:154`
- **Problem:** getBalanceCents sums all thread_cash_entries for the user id; there is no separate seller-earnings bucket, so expiry, spend, send and cash-out logic all act on mixed funds.
- **Why it costs money:** Root cause of reward-to-cash leakage and makes liability accounting impossible.
- **Fix:** Split into thread_cash_entries (rewards, non-cashable) and seller_earnings (cashable), or add a 'cashable' column enforced in every debit.
- **$ impact:** Underlies the P0 leaks above

<a id="bt-123"></a>
### BT-123 · P1 · effort M · Thread Cash is not booked as a liability anywhere in the money ledger

- **Where:** n/a · `artifacts/api-server/src/lib/money/ledger.ts:44,docs/payments/thread-cash-checkout-todo.md:91`
- **Problem:** ledger.ts states Thread Cash is tracked only as SUM(thread_cash_entries), not as a balance-sheet liability; the sign-off item 'confirm accounting treatment' is still open. Awards post nothing to the ledger; only top-ups and cash-outs do.
- **Why it costs money:** Finance can't see outstanding obligations (potentially tens of thousands/month accrued) and books will understate liabilities at launch.
- **Fix:** Post thread_cash_liability on every award/expiry/spend (debit marketing expense, credit liability) and add a daily outstanding-balance report.
- **$ impact:** ~$34k/mo accrued liability at 20k MAU not visible (see cost model)

<a id="bt-124"></a>
### BT-124 · P1 · effort M · No global budget cap or spend kill switch on platform-funded credits

- **Where:** server · `artifacts/api-server/src/lib/threadCash/wallet.ts:222,artifacts/api-server/src/lib/referrals/rewards.ts:27`
- **Problem:** No monthly/daily program budget, no per-user lifetime cap, no circuit breaker on awards, referral credits, top-ups or cash-outs (grep 'budget' in lib/threadCash and lib/referrals: no hits).
- **Why it costs money:** A viral spike or bot wave grows cost with no ceiling.
- **Fix:** Add a thread_cash_budget table with monthly cap; awards and top-ups refuse (or reduce to 0) once exceeded; alert at 80%.
- **$ impact:** Caps worst-case exposure (e.g. hold to $5k/mo)

<a id="bt-125"></a>
### BT-125 · P1 · effort S · The 'threadCash' kill switch is client-only; earn endpoints ignore it

- **Where:** server · `artifacts/api-server/src/routes/thread-cash.ts:144,artifacts/api-server/src/routes/thread-cash.ts:246,lib/db/migrations/085_thread_cash.sql:84,artifacts/mobile/components/thread-cash/ThreadCashActiveTimeTracker.tsx:58`
- **Problem:** Only the mobile tracker reads useFeatureFlag('threadCash'). /check-in, /daily/heartbeat, /daily/claim, and referral credits never call isFeatureEnabled('threadCash'), so flipping the flag off does not stop scripts from earning.
- **Why it costs money:** There is no working server-side off switch during an abuse incident.
- **Fix:** Check isFeatureEnabled('threadCash') in every earn path (and referral credit) and fail closed.
- **$ impact:** Lets ops stop a bleed in minutes instead of a deploy

<a id="bt-126"></a>
### BT-126 · P1 · effort S · Deprecated /check-in still pays without the 7-minute activity gate

- **Where:** server · `artifacts/api-server/src/routes/thread-cash.ts:144,artifacts/api-server/src/lib/threadCash/wallet.ts:108`
- **Problem:** POST /api/thread-cash/check-in (kept for older clients) calls awardDailyCheckInOnce, which has no heartbeat or activeSeconds requirement, so one tap/request earns the daily reward and the streak bonus.
- **Why it costs money:** Makes the '7 minutes of use' rule meaningless; trivial for scripts.
- **Fix:** Remove /check-in before launch (no older clients exist pre-launch) or return 410.
- **$ impact:** Same as full reward cost for every scripted account

<a id="bt-127"></a>
### BT-127 · P1 · effort S · Thread Cash never expires by default: liability grows forever

- **Where:** thread-cash · `artifacts/api-server/src/lib/threadCash/streaks.ts:30,lib/db/migrations/085_thread_cash.sql:49`
- **Problem:** expiryDays defaults to null ('never'); the expiry job exists (jobs/threadCashExpiry.ts) but does nothing without a value.
- **Why it costs money:** No breakage: every cent ever awarded stays a future cost, and dormant farm balances never lapse.
- **Fix:** Set expiry_days to 60-90 before launch (rules must be stated in the app at award time).
- **$ impact:** Breakage of 30-50% of awarded credit, roughly $10-17k/mo at 20k MAU

<a id="bt-128"></a>
### BT-128 · P1 · effort S · No per-order cap: Thread Cash can pay all but $0.50 of an order

- **Where:** buyer-checkout · `artifacts/api-server/src/lib/threadCash/streaks.ts:31,artifacts/api-server/src/routes/buyer.ts:81,artifacts/api-server/src/lib/threadCash/rules.ts:51`
- **Problem:** maxRedemptionPerOrderCents defaults to null, so maxRedeemableCents leaves only the 50c Stripe minimum. docs/review-readiness/reviewer-access.md:97 claims it is 'a capped checkout discount'.
- **Why it costs money:** Lets farmed balances buy goods almost free, maximizing platform top-up per order; doc misleads reviewers/ops.
- **Fix:** Set max_redemption_per_order_cents (e.g. $5 or 20% of merchandise) and require a minimum card spend.
- **$ impact:** Limits per-order platform cost to a known amount

<a id="bt-129"></a>
### BT-129 · P1 · effort M · Refund double-dip if top-up reversal fails (only logged, never retried)

- **Where:** server · `artifacts/api-server/src/lib/money/refunds.ts:437,artifacts/api-server/src/lib/money/refunds.ts:465`
- **Problem:** refundThreadCashSpend credits the buyer back first; if createReversal throws (seller balance empty, account closed), it logs 'needs review' and moves on. Buyer gets credit back AND the seller keeps the platform top-up. No sweep job retries reversals.
- **Why it costs money:** Platform pays twice for one refunded order.
- **Fix:** Record a pending reversal row and retry in moneySweep; debit future seller payouts if reversal is impossible.
- **$ impact:** Each failure costs the full Thread Cash amount

<a id="bt-130"></a>
### BT-130 · P1 · effort S · Cash-out has no minimum, hold period, daily limit or Stripe status check

- **Where:** payouts · `artifacts/api-server/src/lib/threadCash/cashOut.ts:99,artifacts/api-server/src/lib/threadCash/cashOut.ts:106`
- **Problem:** Any amount >= 1c is cashed out instantly as a separate Stripe transfer; only stripeAccountId presence is checked (not stripeAccountStatus 'active'). Credits received minutes ago are immediately withdrawable.
- **Why it costs money:** Fraud gets cashed out before review; many tiny transfers add cost and noise.
- **Fix:** Minimum $10, 7-day maturity on credits, daily cap, require active Connect status.
- **$ impact:** Reduces fraud loss and ops cost

<a id="bt-131"></a>
### BT-131 · P1 · effort S · Earning is live while spending is OFF, so a liability builds up to land at flag-flip

- **Where:** thread-cash · `lib/db/migrations/085_thread_cash.sql:87,artifacts/api-server/src/routes/buyer.ts:515`
- **Problem:** threadCash (earn) ships ON; threadCashCheckoutDiscount ships OFF. Buyers accumulate never-expiring balances they can't use at checkout (they can only send them, which feeds the cash-out leak). When checkout is enabled, months of backlog become spendable at once.
- **Why it costs money:** Sudden cash outflow at the flag flip plus a weak buyer value prop at launch (credit with nowhere to spend).
- **Fix:** Either launch both together with caps, or don't accrue (or show 'coming soon' without accruing) until checkout spend is safe.
- **$ impact:** Backlog of ~$34k per month of delay at 20k MAU

<a id="bt-132"></a>
### BT-132 · P1 · effort M · Loyalty points are platform-wide but seller-funded: sellers pay for rewards earned elsewhere

- **Where:** loyalty · `artifacts/api-server/src/routes/loyalty.ts:7,artifacts/api-server/src/routes/buyer.ts:977,docs/payments/thread-cash-checkout-todo.md:38`
- **Problem:** Points are earned on any store's order (1pt/$1, webhooks.ts:1396), on signup (100, auth.ts:163) and on referral (500), and redeemed at any store as a discount that reduces that seller's transfer and the fee basis ('correct for loyalty points (seller-funded rewards)').
- **Why it costs money:** Seller B pays for points that Brandthread gave away or that seller A generated, and Brandthread also loses 5% on the discounted amount. Sellers will see unexplained payout cuts.
- **Fix:** Make loyalty platform-funded (top-up like Thread Cash) or per-store, or remove it and fold it into Thread Cash.
- **$ impact:** ~1% of GMV shifted to sellers plus 5% of that lost in commission; seller churn risk

<a id="bt-133"></a>
### BT-133 · P1 · effort S · Gift card expiry as short as 1 month conflicts with CARD Act 5-year minimum

- **Where:** gift-cards-manage · `artifacts/api-server/src/lib/giftCards/settings.ts:55`
- **Problem:** saveGiftCardSettings allows expiryMonths 1-120. US federal CARD Act/Reg E requires gift cards not expire within 5 years of issue/load, and several states (e.g. CA) ban expiry.
- **Why it costs money:** Regulatory fines and chargebacks; Brandthread holds the funds (gift_card_liability) so it is the exposed party.
- **Fix:** Minimum 60 months for purchased cards (or no expiry); allow shorter only for seller-issued promotional cards with clear disclosure.
- **$ impact:** Legal exposure; blocks responsible launch of gift cards

<a id="bt-134"></a>
### BT-134 · P1 · effort S · Seller can void a customer-PURCHASED gift card; Brandthread keeps the money

- **Where:** gift-cards-manage · `artifacts/api-server/src/lib/giftCards/service.ts:381,artifacts/api-server/src/routes/gift-cards.ts:253`
- **Problem:** voidCard zeroes any card of the seller including source='purchase'; no refund of the purchaser's payment and no liability release posting.
- **Why it costs money:** Purchasers file chargebacks (platform pays + $15 dispute fee); ledger liability is left unreconciled.
- **Fix:** Only allow voiding seller_issued cards; purchased cards may only be voided with an automatic refund of the remaining balance.
- **$ impact:** Card value + $15 per dispute

<a id="bt-135"></a>
### BT-135 · P1 · effort M · Gift cards paid with stolen cards: code released instantly, platform eats chargeback

- **Where:** gift-card-buy · `artifacts/api-server/src/lib/giftCards/purchase.ts:51,artifacts/api-server/src/lib/giftCards/purchase.ts:124`
- **Problem:** Purchase is a PaymentIntent on Brandthread's balance up to $1,000 per card with no velocity limit, no 3DS requirement, no Radar review hold; the code is emailed and returned the moment payment succeeds and can be redeemed immediately, triggering a seller payout.
- **Why it costs money:** Gift cards are the top carding target; a chargeback hits Brandthread after the seller was paid.
- **Fix:** Require 3DS, cap per-buyer daily gift card volume (e.g. $200), hold code delivery 24h for new accounts, and enable Radar rules for gift cards.
- **$ impact:** Full card value + $15 fee per fraud; typical carding bursts are $5-20k

<a id="bt-136"></a>
### BT-136 · P2 · effort S · 8 accounts per device allowed; 4 can earn daily Thread Cash on one phone

- **Where:** account switcher · `artifacts/mobile/lib/accountSwitcherHelpers.ts:7,artifacts/api-server/src/lib/threadCash/streaks.ts:35`
- **Problem:** MAX_ACCOUNTS = 8 per device with Clerk multi-session; device cap counts OTHER buyers >= 3 so 4 accounts per device per day still earn, plus 100 signup loyalty points each.
- **Why it costs money:** One user can quadruple daily rewards and referral credits by switching accounts.
- **Fix:** Set maxCheckInsPerDevicePerDay to 0 (one earning account per device) and only grant rewards to the first account seen on a device.
- **$ impact:** Up to 4x reward cost for power users (~$22/mo extra per gaming user)

<a id="bt-137"></a>
### BT-137 · P2 · effort S · Inviter $10 not clawed back when the qualifying order is refunded

- **Where:** server · `artifacts/api-server/src/lib/referrals/rewards.ts:198,artifacts/api-server/src/lib/money/refunds.ts:436`
- **Problem:** qualifyReferralForOrder pays on the paid webhook; refunds.ts reverses loyalty and Thread Cash spend but nothing reverses the 'referral' inviter entry. Buy $10, get $10, refund the order.
- **Why it costs money:** Free $10 per alt account loop at the cost of only processing fees.
- **Fix:** Delay inviter credit until the order is delivered + return window, or post a negative referral entry on full refund.
- **$ impact:** $10 per abuse loop; ~$1k/mo at modest abuse

<a id="bt-138"></a>
### BT-138 · P2 · effort S · Existing accounts can claim the 'new customer' $10 any time

- **Where:** server · `artifacts/api-server/src/lib/referrals/rewards.ts:82`
- **Problem:** The only newness check is 'no orders yet'. A dormant account months old can apply a code and get $10; there is no apply window after signup.
- **Why it costs money:** Lets existing users and bulk-made dormant accounts claim welcome credit.
- **Fix:** Allow apply only within 7 days of users.createdAt.
- **$ impact:** $10 per dormant account

<a id="bt-139"></a>
### BT-139 · P2 · effort M · No admin UI/API to freeze a wallet or change Thread Cash config

- **Where:** admin · `artifacts/api-server/src/lib/threadCash/wallet.ts:78,artifacts/api-server/src/routes/feature-flags.ts:35`
- **Problem:** Freeze columns exist (migration 088) and config is a DB row, but no route writes thread_cash_streaks.frozen or thread_cash_config (grep 'frozen' in routes: none). Changing caps needs raw SQL in production.
- **Why it costs money:** Slow response to fraud; operators may avoid tightening caps.
- **Fix:** Add admin endpoints (requireModerator) to freeze/unfreeze wallets, edit config, and view top earners/senders.
- **$ impact:** Shortens fraud windows; hard to quantify

<a id="bt-140"></a>
### BT-140 · P2 · effort S · Destination-mode Thread Cash order may fail: application fee exceeds the discounted charge

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/buyer.ts:1030,artifacts/api-server/src/lib/money/checkoutPlan.ts:186`
- **Problem:** application_fee_amount is computed on the full pre-Thread-Cash price while the Stripe charge can be reduced to 50c. Stripe rejects an application fee larger than the charge, so large Thread Cash orders under PAYOUT_MODE=immediate likely fail to pay (needs Stripe test confirmation).
- **Why it costs money:** Failed checkouts lose the sale and the buyer's trust.
- **Fix:** Require card portion >= application fee (like the gift card feeFloorCents in giftCards/checkout.ts:71).
- **$ impact:** Lost orders when used; small until flag is on

<a id="bt-141"></a>
### BT-141 · P2 · effort M · Partial refunds: Thread Cash not returned and seller top-up not reversed

- **Where:** server · `artifacts/api-server/src/lib/money/refunds.ts:436`
- **Problem:** Thread Cash restoration and top-up reversal run only when fullyRefunded. On a partial refund the seller keeps the full platform top-up for refunded items, and the buyer loses their pro-rata Thread Cash.
- **Why it costs money:** Platform pays the seller for goods that were refunded; buyers complain about lost credit.
- **Fix:** Pro-rate: reverse top-up and return Thread Cash proportionally to the refunded merchandise.
- **$ impact:** Proportional to partial-refund volume on Thread Cash orders

<a id="bt-142"></a>
### BT-142 · P2 · effort S · Streak bonus is 10x the daily reward and makes up 59% of program cost

- **Where:** thread-cash · `artifacts/api-server/src/lib/threadCash/streaks.ts:27,artifacts/api-server/src/lib/threadCash/streaks.ts:127`
- **Problem:** Daily 10c, bonus 100c every 7th consecutive day (no cap). Per perfect week 70c + 100c = 170c; the bonus is 100/170 = 59% of cost and is easiest for bots (scripted daily claims) to hit.
- **Why it costs money:** Cost is concentrated in automated or habitual claimers, not in buyers who purchase.
- **Fix:** Tie the streak bonus to a purchase or engagement action (e.g. bonus only spendable on next order with a min spend), or lower to 30c.
- **$ impact:** Cutting the bonus to 30c lowers the max from $7.29 to $4.29/user/mo (-41%)

<a id="bt-143"></a>
### BT-143 · P2 · effort S · Loyalty redemption has no per-order cap and no flag

- **Where:** buyer-checkout · `artifacts/api-server/src/routes/loyalty.ts:102,artifacts/api-server/src/routes/loyalty.ts:424`
- **Problem:** Discount only needs to be below the order total by 1 cent; redemption is not feature-flagged. A buyer with farmed signup/referral points can take almost the whole item from one seller.
- **Why it costs money:** Concentrates loss on single sellers; platform fee goes to near 0 on those orders.
- **Fix:** Cap loyalty at e.g. 10% of merchandise and minimum 500 points; add a flag.
- **$ impact:** Bounded by points farmed; $5 per fake referral

<a id="bt-144"></a>
### BT-144 · P2 · effort M · Gift card float/breakage has no escheat or stored-value compliance handling

- **Where:** n/a · `artifacts/api-server/src/lib/giftCards/service.ts:158`
- **Problem:** Brandthread holds gift card money as gift_card_liability with no unclaimed-property (escheat) process, no handling when a seller closes their store, and no reporting.
- **Why it costs money:** State unclaimed-property audits and stored-value licensing questions; stranded balances when sellers churn.
- **Fix:** Add a policy: on store closure, refund remaining balances; get legal advice on escheat; add a liability report.
- **$ impact:** Compliance exposure grows with volume

<a id="bt-145"></a>
### BT-145 · P2 · effort S · IAP-bought boosts can't be refunded on admin rejection

- **Where:** admin-promotions · `artifacts/api-server/src/lib/promotions/refund.ts:19,artifacts/api-server/src/routes/admin-promotions.ts:11`
- **Problem:** refundPromotionPayment refunds only via Stripe checkoutSessionId; IAP purchases (iap-promotions.ts, gated by IAP_PROMOTIONS_ENABLED) have none, so 'rejection refunds in full' returns nothing_to_refund and the seller is charged for a rejected boost.
- **Why it costs money:** Seller complaints and Apple refund requests; possible review issue.
- **Fix:** For IAP-sourced boosts, issue a credit for a future boost or direct the seller to Apple refund with clear copy.
- **$ impact:** Value of rejected IAP boosts ($5-$500 each)

<a id="bt-146"></a>
### BT-146 · P2 · effort S · iap-rails doc misses that reward Thread Cash is cashable

- **Where:** n/a · `docs/review-readiness/iap-rails.md:16,docs/review-readiness/iap-rails.md:18`
- **Problem:** The doc marks Thread Cash PASS and calls gift cashability a future risk, but today daily check-in/referral credit is cashable through /cash-out and the send flow. App Review could see 'earn cash for time in app' as an incentive mechanic.
- **Why it costs money:** A wrong review-readiness verdict before an App Store-only launch.
- **Fix:** Update the doc after fixing cash-out source filtering; keep reward credit non-cashable.
- **$ impact:** Rejection risk at launch

<a id="bt-147"></a>
### BT-147 · P2 · effort S · Guests/demo can't earn (verified), but signed-in sellers also earn buyer rewards

- **Where:** server · `artifacts/api-server/src/routes/thread-cash.ts:75,artifacts/mobile/app/(buyer)/_layout.tsx:167`
- **Problem:** router.use(requireAuth) blocks guests and demo fixtures are client-only. However the earn endpoints don't check role, so seller accounts (and team members acting as the owner via teamContext) can call /daily/claim directly and accrue cashable rewards.
- **Why it costs money:** Sellers farm buyer rewards into cashable balance.
- **Fix:** Restrict earn endpoints to buyer accounts and to the actor (not the rewritten owner id).
- **$ impact:** ~$7/mo per seller account plus multi-account multiples

<a id="bt-148"></a>
### BT-148 · P3 · effort S · Cash-out idempotency lookup is not scoped to the seller

- **Where:** server · `artifacts/api-server/src/lib/threadCash/cashOut.ts:78`
- **Problem:** The existing-entry lookup filters only by idempotencyKey (globally unique) without buyerId, so a key that collides with another user's entry returns that user's transfer id as a 'success' response.
- **Why it costs money:** Confusing false-success responses and info leak; no direct loss.
- **Fix:** Add eq(threadCashEntries.buyerId, sellerId) to the lookup and namespace keys per seller.
- **$ impact:** Negligible direct $

<a id="bt-149"></a>
### BT-149 · P3 · effort S · Timezone is client-chosen per request, which allows an extra day's claim

- **Where:** server · `artifacts/api-server/src/routes/thread-cash.ts:81,artifacts/api-server/src/routes/thread-cash.ts:248`
- **Problem:** normalizeTimezone accepts any zone each call; switching between UTC-12 and UTC+14 opens a ~26h window, so a user can claim two local dates back to back. Comment at :140 acknowledges the shift.
- **Why it costs money:** Minor extra claims and streak gaming.
- **Fix:** Persist the timezone on the first claim and allow changes at most once per week.
- **$ impact:** <$100/mo

<a id="bt-150"></a>
### BT-150 · P3 · effort S · Signup grants 100 loyalty points to every account (farmable via 8 accounts/device)

- **Where:** onboarding · `artifacts/api-server/src/routes/auth.ts:163`
- **Problem:** Every new Clerk user gets 100 points ($1) at /auth/sync with no verification.
- **Why it costs money:** Small, but farmable at scale and funded by whichever seller is redeemed against.
- **Fix:** Grant signup points on first paid order instead.
- **$ impact:** $1 per account; ~$2k at 2k signups/mo

<a id="bt-151"></a>
### BT-151 · P3 · effort S · Loyalty earn uses order total including tax and shipping

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1396`
- **Problem:** points = floor(order.totalCents / 100) uses the Stripe total including tax and shipping, while the docs say '1 point per $1 spent'.
- **Why it costs money:** Over-awards about 10-15% vs merchandise-based earning, funded by sellers.
- **Fix:** Base points on merchandise subtotal minus discounts.
- **$ impact:** ~0.1-0.15% of GMV

<a id="bt-152"></a>
### BT-152 · P3 · effort S · Giveaway entries come from follows: bot follows inflate entries, no fraud checks

- **Where:** giveaway · `artifacts/api-server/src/lib/giveaways.ts:1`
- **Problem:** Entries are derived from follows/comments; only blocked accounts and the sponsor are excluded. Multi-accounts (8/device) and fresh accounts can enter, so real buyers lose to farms.
- **Why it costs money:** Sellers' prize spend goes to fake accounts, so sellers see no return and churn from the feature.
- **Fix:** Exclude accounts younger than 7 days or without a verified email/phone, and dedupe by device.
- **$ impact:** Indirect; seller retention

<a id="bt-153"></a>
### BT-153 · P3 · effort S · Seller discount codes shrink the 5% commission base

- **Where:** discounts · `artifacts/api-server/src/routes/buyer.ts:977,artifacts/api-server/src/routes/buyer.ts:1040`
- **Problem:** discountCodeAmountCents feeds combinedDiscountCents, which reduces merchandiseCents for the platform fee. Seller-funded promos therefore also cut Brandthread's commission (expected), with no floor.
- **Why it costs money:** A seller running a 50% off code halves platform revenue on those orders; 100%-off codes (to 1 cent) yield ~0 fee while the platform still carries risk.
- **Fix:** Set a minimum platform fee per order (e.g. $0.50) or compute the fee on list price for codes over X%.
- **$ impact:** ~5% x promo volume

<a id="bt-154"></a>
### BT-154 · P3 · effort S · Buyer wallet history labels cash_out/live_gift_sent as 'Adjustment'

- **Where:** thread-cash · `artifacts/mobile/app/thread-cash.tsx:31`
- **Problem:** historyLabel has no case for live_gift, live_gift_sent or cash_out, so they render as 'Adjustment' in the shared buyer/seller wallet.
- **Why it costs money:** Confusing statements lead to support tickets and erode trust in rewards.
- **Fix:** Add labels for all ledger sources (share one map with thread-cash-history.tsx).
- **$ impact:** Minor support cost

## AI & third-party cost exposure

50 findings: 11 P0 · 19 P1 · 15 P2 · 5 P3

<a id="bt-155"></a>
### BT-155 · P0 · effort S · Unlimited free logo generation via /api/onboarding-sample/generate

- **Where:** server · `artifacts/api-server/src/routes/index.ts:229, artifacts/api-server/src/routes/logo.ts:15-31,104-135, artifacts/api-server/src/lib/aiCredits/catalogue.ts:87`
- **Problem:** logoRouter, including its paid POST /generate handler, is also mounted at /onboarding-sample with only requireAuth: no requirePlan, no seller/onboarding check and no credit rule, because the credit regex only matches /logo/... So POST /api/onboarding-sample/generate gives any signed-in account, buyers included, unlimited gpt-image-1 high-quality logos. Each call runs up to 2 generations plus 2 QA calls. The only brake is an in-memory 5/min per-process Map, and the path is outside the 'expensive' rate-limit regex.
- **Why it costs money:** At $0.17-0.34 per call, 5/min comes to 7,200 calls a day per account per instance, about $1.2k-2.4k a day. Signing up is free.
- **Fix:** Mount only the /logo handler at /onboarding-sample (a separate router with just POST /logo), or add requirePlan plus a catalogue rule for /onboarding-sample/generate. Add 'onboarding-sample' to EXPENSIVE_PATH.
- **$ impact:** $36k-73k/mo worst case from one abusive free account (7,200/day x $0.17-0.34 x 30)

<a id="bt-156"></a>
### BT-156 · P0 · effort S · Credit prices are 5-20x below real gpt-image-1 cost

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:9-12,82-89, lib/integrations-openai-ai-server/src/image/client.ts:132-137,160-166, lib/integrations-openai-ai-server/src/image/quality.ts:322-343`
- **Problem:** The catalogue assumes 1 credit = about $0.01, so bg_remove = 2 credits ($0.02), logo/mockup = 5, photoshoot = 8. Every tool actually calls gpt-image-1 at quality 'high' (about $0.167 output per 1024px image, plus input-image tokens on edits). generateWithVisualQa can regenerate once, so one call costs $0.19-0.39.
- **Why it costs money:** Growth ($79) grants 4,000 credits, which buys 2,000 background removals costing $380-780 in provider fees. Every credit tool loses money at list price, and packs ($5.99 for 500 credits, before Apple's 15-30% cut) lose more.
- **Fix:** Re-price credits from measured cost: bg_remove 20-40, logo/mockup 20-35, photoshoot 25-40, mockup-to-model per reference. Or switch bg removal and drafts to quality 'low'/'medium' and price from ai_usage_events.
- **$ impact:** At 300 Growth sellers using half their allowance: about 300 x 2,000cr / 2 x $0.10 = ~$30k/mo provider cost against $23.7k revenue

<a id="bt-157"></a>
### BT-157 · P0 · effort M · Mockup-to-Model and Outfit Swap charge 8 credits for up to 10 image generations

- **Where:** design-mockup-to-model · `artifacts/api-server/src/routes/photography.ts:143-298,379-500, artifacts/api-server/src/lib/aiCredits/catalogue.ts:85`
- **Problem:** /photography/mockup-to-model runs one generateWithVisualQa (up to 2 gpt-image-1 high edits plus 2 QA calls) for each of up to 5 reference images. /outfit-swap does the same for up to 4 garments. Both are billed a flat 8 credits, and partial success returns 200, so nothing is refunded.
- **Why it costs money:** Worst case per call is 10 edits, about $1.90, billed at $0.08. A Pro seller (400 'generations' a day ceiling) can burn about $760 a day.
- **Fix:** Charge per reference or garment (for example 30 credits each), or debit after the run using the number of successful outputs. Count references, not requests, toward the Pro daily ceiling.
- **$ impact:** $1.9 of cost per $0.08 charge; one heavy Pro user is about $20k/mo

<a id="bt-158"></a>
### BT-158 · P0 · effort S · Retry endpoints bypass the credit gate entirely

- **Where:** design-mockup-to-model · `artifacts/api-server/src/routes/photography.ts:301-376,501-560, artifacts/api-server/src/lib/aiCredits/catalogue.ts:85, artifacts/mobile/lib/api.ts:1650-1658`
- **Problem:** The credit rule /^\/photography\/(mockup-to-model|outfit-swap)$/ does not match /mockup-to-model/retry or /outfit-swap/retry. Both run a full generateWithVisualQa (up to 2 high-quality edits plus QA) with no debit. The mobile app calls retryOutfitSwap.
- **Why it costs money:** A Growth or Pro seller can loop the retry endpoint for free high-quality generations, about $0.39 each, limited only by 30/min.
- **Fix:** Extend the regex to (mockup-to-model|outfit-swap)(\/retry)? with a per-image cost, and add a regression test listing every POST route under the growth-gated mounts.
- **$ impact:** 30/min x $0.39 is up to $16k/day per account; realistic abuse is $1-5k/mo

<a id="bt-159"></a>
### BT-159 · P0 · effort S · Trailing slash or uppercase path skips the credit debit

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/gate.ts:23-27, artifacts/api-server/src/lib/aiCredits/catalogue.ts:99-101, artifacts/api-server/src/middlewares/rateLimit.ts:224-225`
- **Problem:** findToolRule tests req.path against case-sensitive regexes anchored with $. Express 5 routers default to caseSensitive:false and strict:false, so POST /api/photography/generate/ or /api/PHOTOGRAPHY/generate still reaches the handler but matches no rule: no debit, no Pro ceiling, no global cap. The EXPENSIVE_PATH rate-limit regex is also case-sensitive, so the request falls back to the 120/min mutation policy. (Found by reading the code; could not run it because node_modules is not installed.)
- **Why it costs money:** A paying Growth or Pro account gets unlimited free image generation, and the global emergency cap never sees it.
- **Fix:** Normalise in the gate: path = req.path.toLowerCase().replace(/\/+$/, ''). Or create routers with { strict: true, caseSensitive: true }. Better still, debit inside each route via a helper instead of matching paths.
- **$ impact:** Unbounded: about 120 req/min x $0.2-1.9 per paying abuser

<a id="bt-160"></a>
### BT-160 · P0 · effort M · Trials and past_due subscriptions get full AI allowance (Pro unlimited) from day one

- **Where:** server · `artifacts/api-server/src/lib/nativeEntitlements.ts:195-201, artifacts/api-server/src/lib/aiCredits/ledger.ts:47-56,79-123, artifacts/api-server/src/lib/aiCredits/catalogue.ts:154-155`
- **Problem:** getEffectiveEntitlement treats 'trial', 'trialing' and 'past_due' as active. resolvePlan therefore returns growth or pro, and lockAccount grants the full 4,000 credits (Growth) or unlimited use (Pro, 400 generations a day) as soon as the 5-day trial starts. A seller can burn it all and cancel before the first charge.
- **Why it costs money:** One Pro trial is about 2,000 generations; at mockup-to-model's $1.90 worst case that is up to $3.9k per trial. Growth is 4,000 credits, about $400-950 of provider cost. Card-required trials don't stop this with prepaid or virtual cards.
- **Fix:** Grant a small trial allowance (for example 100 credits, Pro capped at 20 a day) and the full monthly grant only on the first paid invoice. Exclude past_due from AI tools after a 3-day grace period.
- **$ impact:** 100 trial abusers/mo x ~$500 = $50k/mo; even 10 is $5k

<a id="bt-161"></a>
### BT-161 · P0 · effort S · /store/ai/* has no input size limit and no plan gate, so one gpt-4.1 call can cost $1-2

- **Where:** store-generate · `artifacts/api-server/src/routes/store-ai.ts:65-90,162-201, artifacts/api-server/src/app.ts:160-161, artifacts/api-server/src/lib/aiCredits/catalogue.ts:76`
- **Problem:** /store/ai/generate and /from-social JSON.stringify the client 'answers' object straight into a gpt-4.1 prompt. app.ts allows 10MB bodies on /api/store/ai, which is roughly 1M tokens of context. These routes are 'text' (free) on every plan and only need sign-in. Buyers can call them too. Nothing checks for a seller.
- **Why it costs money:** About 900k input tokens x $2/M is about $1.80 per call. The shared 500/day text ceiling allows about $900 a day from one free account.
- **Fix:** Validate answers with a zod schema (whitelisted keys, each string <= 500 chars, total <= 4KB). Lower the body limit to 64KB except for the image routes, and require a seller account.
- **$ impact:** Up to $27k/mo per abusive free account; normal use is $0.03/call

<a id="bt-162"></a>
### BT-162 · P0 · effort S · Support chat sits before the AI gate, so it has no daily ceiling

- **Where:** support-chat · `artifacts/api-server/src/routes/index.ts:206,219, artifacts/api-server/src/routes/support-chat.ts:233-260, artifacts/api-server/src/middlewares/rateLimit.ts:224-225`
- **Problem:** /support-chat is mounted above router.use(aiCreditsGate), and support-chat has no AI_TOOL_RULES entry anyway, so the 500/day text ceiling never applies. The only brake is the 30/min 'expensive' policy. Each call sends up to 12 x 3,000 chars plus the system prompt to gpt-5.4-mini with up to 800 output tokens.
- **Why it costs money:** 30/min x 1,440 is 43,200 calls a day per account, at about $0.01 each, so about $500 a day from one free buyer account. It also does not count toward the global AI spend cap or alerts.
- **Fix:** Add a text rule for /support-chat/message and move the mount below the gate (or call allowTextRequest in the route). Cap support chat at about 50 messages per user per day.
- **$ impact:** Up to ~$15k/mo per abusive account (assumes gpt-5.4-mini at $0.75/$4.50 per M)

<a id="bt-163"></a>
### BT-163 · P0 · effort S · Hardcoded gpt-image-1 retires Oct 23, 2026 per an in-repo comment (pre-launch)

- **Where:** server · `lib/integrations-openai-ai-server/src/image/client.ts:133,161, artifacts/api-server/src/lib/aiImageProviders/config.ts:121-127`
- **Problem:** aiImageProviders/config.ts says 'gpt-image-1 is retired Oct 23, 2026' and adds getOpenAiImageModel() (OPENAI_IMAGE_MODEL, default gpt-image-2.5-flare). Nothing imports aiImageProviders. The shared client every route uses still sends model: 'gpt-image-1'.
- **Why it costs money:** If the date is right, every paid AI image feature (the Growth/Pro selling point and the credit packs) stops working one week before the Oct 31 launch. The successor model also needs new pricing in aiPricing.ts and in the credit catalogue.
- **Fix:** Confirm the date on OpenAI's deprecations page. Make the shared client read OPENAI_IMAGE_MODEL, benchmark the successor's cost, and re-price credits before Oct 23.
- **$ impact:** Blocks all AI-tool revenue (Growth upsell, packs) if the retirement date holds

<a id="bt-164"></a>
### BT-164 · P0 · effort S · Starter is sold 1,000 credits/mo and packs, but every credit tool needs Growth

- **Where:** plans · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:28,82-89,116-119, artifacts/api-server/src/routes/index.ts:239-244, artifacts/mobile/lib/proPerks.ts:64,70-74`
- **Problem:** Every 'credits' rule points at /logo, /mockup, /photography, /bg-removal, /lifestyle or /techpack, and all of those are mounted behind requirePlan('growth'). Starter still gets monthlyAllowance 1000 and packsEligible true, and the paywall shows '1,000 AI credits per month'. Starter credits and any purchased pack can never be spent. The gate debits, requirePlan returns 403, and the gate refunds.
- **Why it costs money:** Selling consumable packs that cannot be used invites refunds, chargebacks and App Store 3.1.1/5.6 complaints, and the advertised perk is false.
- **Fix:** Either open bg-removal and mockup to Starter (credits become the limiter and the upgrade path) or set Starter's allowance to 0 with packsEligible false and change the copy. Opening them is the better monetisation lever.
- **$ impact:** Blocks pack revenue from Starter and creates refund and review risk on every Starter sale

<a id="bt-165"></a>
### BT-165 · P0 · effort M · Worst-case monthly AI and third-party exposure summary

- **Where:** server · `artifacts/api-server/src/routes/index.ts:206-229, artifacts/api-server/src/lib/aiCredits/catalogue.ts:152-158`
- **Problem:** One abusive FREE account (email signup) today: onboarding-sample logos about $36-73k, store-ai at 500 text calls a day with 1M-token prompts about $27k, support chat about $15k, places per IP about $6k, which is roughly $85k/mo, more than the $50k revenue target. 1,000 normal no-plan sellers: chat about 30 msgs ($0.18), helpers ($0.04), store AI ($0.09), onboarding logo ($0.25, once), support ($0.03), places ($0.05), so about $0.5-0.65 each, or $500-650/mo. If those 1,000 are in Growth trials using about 30 images each: +$5-11k/mo.
- **Why it costs money:** With these holes, a single bad actor can wipe out a month of revenue.
- **Fix:** Fix the P0s first (onboarding-sample route, retry/slash bypass, support-chat ceiling, store-ai input cap, trial grants, re-pricing), then add dollar-based global caps and an OpenAI project budget.
- **$ impact:** Worst case ~$85k/mo from one free account; ~$0.6k/mo for 1k normal free sellers (assumes gpt-5.4-mini $0.75/$4.50 per M, gpt-image-1 high $0.167/img)

<a id="bt-166"></a>
### BT-166 · P1 · effort S · AI chat accepts an unbounded client brandMemory/context, inflating prompt tokens

- **Where:** ai-assistant · `artifacts/api-server/src/routes/ai.ts:33-64,153-158,196-203, artifacts/api-server/src/app.ts:165`
- **Problem:** brandMemory (Record<string,string>) and context.* (productName, customerName, ...) come from the request body and are interpolated into the system prompt with no size limit. Messages are capped at 40 x 4,000 chars, but the global JSON limit is 45MB. The snapshot and help docs add several thousand tokens on every turn.
- **Why it costs money:** Up to the model context (hundreds of thousands of tokens) per call, at about $0.30 each with gpt-5.4-mini. The 500/day ceiling allows about $150 a day per free account.
- **Fix:** Load brandMemory server-side from the DB (it is derivable through /brand-memory/rebuild). Whitelist context keys and truncate to 200 chars, and cap the total system prompt at about 6k tokens.
- **$ impact:** Up to ~$4.5k/mo per abusive account

<a id="bt-167"></a>
### BT-167 · P1 · effort S · Any signed-in account, buyers included, can use the free text AI tools

- **Where:** ai-assistant · `artifacts/api-server/src/routes/index.ts:221,258,344, artifacts/api-server/src/routes/ai.ts:145, artifacts/api-server/src/routes/store-ai.ts:14, artifacts/api-server/src/lib/aiCredits/catalogue.ts:72-79`
- **Problem:** /ai/chat, /ai/chat/stream, /ai/brand-memory/rebuild, /store/ai/* and /ai-helpers/* only require auth plus teamContext. No seller account type or plan is checked, and text is free on every plan with a 500/day ceiling.
- **Why it costs money:** Brandthread pays for AI usage by accounts that will never pay. It also gives away a feature that could drive Starter and Growth upgrades.
- **Fix:** Require accountType = seller. Give no-plan sellers a small daily text quota (for example 20/day) and show 'Upgrade for more'.
- **$ impact:** Normal free use is ~$0.3-0.6/seller/mo; the cap removes the abuse tail of ~$5-27k/mo per bad actor

<a id="bt-168"></a>
### BT-168 · P1 · effort M · Spend cap and alerts only see credit tools, not text, captions or support

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/ledger.ts:197-199,219, artifacts/api-server/src/lib/aiCredits/alerts.ts:54-69, artifacts/api-server/src/lib/aiCredits/catalogue.ts:152`
- **Problem:** ai_spend_daily (global scope) only grows when debitCredits runs. Free text tools, /support-chat, /onboarding-sample/*, /store/ai, whisper captions and the photography retry routes never add to it, so AI_GLOBAL_DAILY_CREDIT_CAP and the 50/80/100% alerts never fire for the biggest exposures. Alerts also need AI_ALERT_WEBHOOK_URL or AI_ALERT_EMAIL to be set.
- **Why it costs money:** Runaway spend through the uncovered routes is invisible until the OpenAI invoice arrives.
- **Fix:** Build the global cap and alerts from ai_usage_events cost_micros (dollars) instead of credits, and set an OpenAI or Replit project hard budget limit. Make the alert env vars mandatory in production.
- **$ impact:** Turns a multi-thousand-dollar incident into a capped one

<a id="bt-169"></a>
### BT-169 · P1 · effort S · The AI usage meter misses several providers and most models

- **Where:** server · `lib/integrations-openai-ai-server/src/client.ts:59-73, artifacts/api-server/src/routes/store-ai.ts:8-11, artifacts/api-server/src/lib/admin/aiPricing.ts:11-20, artifacts/api-server/src/lib/captions.ts:190`
- **Problem:** Only openai.chat.completions.create, images.generate and images.edit on the shared client are metered, and streaming calls are skipped (client.ts:63), so /ai/chat/stream goes unrecorded. store-ai.ts builds its own OpenAI client, so it is unmetered. Whisper audio.transcriptions is unmetered. The price table has no gpt-5.4-mini (chat, agent, helpers, support) and no gpt-5 (store AI), so those rows record cost 0 with priced=false. Image input tokens are priced at the $5 text rate instead of $10.
- **Why it costs money:** The admin AI spend dashboard under-reports most text spend, so pricing decisions are made blind.
- **Fix:** Wrap audio.transcriptions, request stream_options.include_usage, reuse the shared client in store-ai, and add current prices for gpt-5.4-mini, gpt-5 and gpt-image-*.
- **$ impact:** Indirect: enables the re-pricing fixes above

<a id="bt-170"></a>
### BT-170 · P1 · effort S · Pro 'Unlimited AI': 400 gens/day and a fair-use queue that never stops anything

- **Where:** plans · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:31,154-156, artifacts/api-server/src/lib/aiCredits/lowPriority.ts:1-50, artifacts/api-server/src/lib/aiCredits/ledger.ts:187-209`
- **Problem:** Pro has no balance. The hidden ceiling is 400 requests a day (not images). Past 10,000 credits-worth a month, jobs go to a 2-slot FIFO queue, but a waiter that outlasts 10 minutes 'runs anyway', so the queue only adds delay.
- **Why it costs money:** 400 a day x 30 is 12,000 requests a month. At $0.2-1.9 each, that is $2.4k-23k of cost against $199 of revenue.
- **Fix:** Give Pro a real monthly allowance (for example 15,000 credits) with 'unlimited' text only, or a hard fair-use stop with an upsell to packs. Count images, not requests.
- **$ impact:** One power user can cost $2-20k/mo; at 50 Pro sellers that is real money

<a id="bt-171"></a>
### BT-171 · P1 · effort S · AI text and image chat refunds on 4xx let abusers make paid generations free

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/gate.ts:68-72, artifacts/api-server/src/middlewares/aiSafetyGuard.ts:130-140, lib/integrations-openai-ai-server/src/image/quality.ts:322-343`
- **Problem:** The gate refunds any response with status >= 400. Responses that come after the provider has already been paid include ImageQualityError 422 (2 generations plus 2 QA calls already spent), AI_OUTPUT_BLOCKED 422 from output moderation, and 502 when QA is unavailable.
- **Why it costs money:** Prompts that reliably fail QA or moderation burn about $0.39 per attempt at zero credit cost to the user, and output moderation becomes a free retry loop for policy-violating prompts.
- **Fix:** Charge a partial fee (for example 50%) when the provider ran, or count failed attempts against a per-day failure cap (for example 20) after which the tool locks.
- **$ impact:** $0.39 per failed attempt; a few hundred dollars a month at modest abuse

<a id="bt-172"></a>
### BT-172 · P1 · effort S · Google Places autocomplete is unauthenticated, has no session token and no cache

- **Where:** post-composer · `artifacts/api-server/src/routes/places.ts:139-182, artifacts/api-server/src/lib/places.ts:140-163`
- **Problem:** GET /api/places/search is public and calls Places Autocomplete (New) once per keystroke query whenever GOOGLE_PLACES_API_KEY is set. There is no sessionToken (so every request is billed rather than per session), no server cache, and the only limit is public-read 240 per 5 min per IP.
- **Why it costs money:** At about $2.83/1k requests, a scripted IP can cost about $195 a day, and rotating IPs is unbounded. Normal typing also bills 5-10 requests per place tag.
- **Fix:** Require auth, pass a sessionToken (shared with the follow-up Details call), cache q+bias for 24h in Redis, debounce to 3+ chars, and set a Google Cloud quota cap.
- **$ impact:** ~$6k/mo per abusive IP; ~$50-300/mo normal at launch scale

<a id="bt-173"></a>
### BT-173 · P1 · effort M · Background removal uses gpt-image-1 high instead of a cheap segmentation model

- **Where:** design-bg-removal · `artifacts/api-server/src/routes/bg-removal.ts:118-196,200-260`
- **Problem:** /bg-removal/remove runs an image edit with background:'transparent' at quality high and no size, so OpenAI may pick 'auto' (up to 1536px), plus a gpt-4o-mini QA pass and possibly a second generation. The output is a regenerated image, not a mask cutout.
- **Why it costs money:** $0.19-0.39 per cutout, against about $0.01-0.05 for dedicated APIs (remove.bg, Photoroom, fal birefnet) or near zero self-hosted. This is the most-used tool for product photos.
- **Fix:** Use a segmentation model for /remove, keep gpt-image only for /replace, and set size explicitly.
- **$ impact:** At 20k removals/mo: ~$5k with gpt-image-1 vs <$500 with a segmentation API

<a id="bt-174"></a>
### BT-174 · P1 · effort S · Every image tool hardcodes quality 'high' with no draft or preview tier

- **Where:** ai-studio · `lib/integrations-openai-ai-server/src/image/client.ts:96-104,127-137,160-166`
- **Problem:** generateImageBuffer and editImages default to quality:'high' and no route passes anything lower, including iterative design drafts (design-text-to-design refine/variation) and 4-up sketch variations.
- **Why it costs money:** High costs about $0.167 per 1024px image versus about $0.042 for medium and $0.011 for low, so drafts cost 4-15x more than they need to.
- **Fix:** Generate drafts or variations at low/medium and offer 'Upscale to HD' as a separate higher-credit action (also an upsell surface).
- **$ impact:** ~60-70% cut of image spend; several $k/mo at scale

<a id="bt-175"></a>
### BT-175 · P1 · effort S · Sketch-to-design fires 4 parallel generations and discards them all if one fails

- **Where:** design-upload-sketch · `artifacts/mobile/services/designService.ts:1454-1461,1505-1520, artifacts/mobile/app/design-upload-sketch.tsx:101, artifacts/api-server/src/routes/mockup.ts:20-35`
- **Problem:** generateN uses Promise.all over 4 /mockup/generate calls (20 credits, $0.7-1.4 of provider cost). /mockup has an in-memory limit of 5 per minute, so a second attempt inside a minute gets 429s on some calls. Promise.all then rejects and the successful, already-charged images are thrown away.
- **Why it costs money:** Users pay credits and Brandthread pays OpenAI for images the user never sees, which drives retries (more cost) and churn.
- **Fix:** Use Promise.allSettled, show partial results, refund only the failed ones, and send a single n=4 request instead.
- **$ impact:** Roughly 10-25% of design-studio image spend wasted

<a id="bt-176"></a>
### BT-176 · P1 · effort S · Brand screen makes 3 logos per tap, shows no cost, no upsell without a plan

- **Where:** brand · `artifacts/mobile/app/brand.tsx:64-90, artifacts/api-server/src/routes/index.ts:239`
- **Problem:** handleGenerateLogo fires 3 parallel /api/logo/generate calls (15 credits, about $0.5-1.0) on every tap. Non-Growth sellers get 403 PLAN_REQUIRED on all three and see only 'Generation failed'.
- **Why it costs money:** This misses the clearest Starter-to-Growth upsell moment and spends 3x per tap without telling the user.
- **Fix:** Show '15 credits' on the button. Detect PLAN_REQUIRED via getEntitlementRejection and open /plans?highlight=growth.
- **$ impact:** Upsell conversion: even 2% of 1k Starter sellers upgrading is about $1k MRR

<a id="bt-177"></a>
### BT-177 · P1 · effort M · Most AI tool screens show no credit cost and no upgrade path on 402/403

- **Where:** ai-studio · `artifacts/mobile/app/ai-studio.tsx:1-7,200-216, artifacts/mobile/app/design-bg-removal.tsx:280-293, artifacts/mobile/app/lifestyle-images.tsx, artifacts/mobile/app/ai-mockup-chat.tsx, artifacts/mobile/app/ai-photography-chat.tsx, artifacts/mobile/app/design-text-to-design.tsx, artifacts/mobile/app/design-upload-sketch.tsx`
- **Problem:** Only design-mockup-to-model and design-ai-photoshoot render AiCreditsChip/AiToolButtons (grep 'credit' finds 0 hits in the other screens). ai-studio lists 5 tools with no Growth lock badge or cost. design-bg-removal uses raw fetch(), which bypasses api.ts's surfaceAiCreditsError, so a 402 shows 'Not enough AI credits' with no link to buy, and a 403 shows 'Plan required' text with no button.
- **Why it costs money:** Pack sales and plan upgrades are lost exactly when intent is highest.
- **Fix:** Add AiCreditsChip and per-action cost labels to every AI screen, route design-bg-removal through api.bgRemoval, and add a shared PLAN_REQUIRED handler that opens /plans.
- **$ impact:** Credit packs plus upgrades: an estimated $1-3k/mo at target scale

<a id="bt-178"></a>
### BT-178 · P1 · effort S · Credit packs are loss-making after Apple's cut

- **Where:** ai-credits · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:103-110, artifacts/mobile/lib/aiCredits.ts:32-36`
- **Problem:** Packs are $5.99/500, $14.99/1,500 and $44.99/5,000 credits, about 1.2c per credit, and native purchases go through RevenueCat (Apple/Google keep 15-30%). Real provider cost is about 4-20c per credit-equivalent (see the re-pricing finding), so a 500-credit pack spent on bg removal costs about $47-97 against about $4.20-5.10 of net revenue.
- **Why it costs money:** Each pack sold increases losses.
- **Fix:** After re-pricing credits from measured cost, re-derive pack prices with at least 60% gross margin after store fees.
- **$ impact:** Each pack loses ~$40-90 at current pricing

<a id="bt-179"></a>
### BT-179 · P1 · effort S · Pack credits are not clawed back on refund or chargeback

- **Where:** ai-credits · `artifacts/api-server/src/lib/aiCredits/purchases.ts:111-129, artifacts/api-server/src/routes/webhooks.ts:281-310,546`
- **Problem:** grantRevenueCatCreditPurchase and the Stripe checkout fulfilment grant credits, but no handler deducts them on a RevenueCat REFUND/CANCELLATION or a Stripe charge.refunded/dispute. grep found no reversal path for credit packs.
- **Why it costs money:** A user can buy a pack, spend it, and get an Apple refund, so Brandthread pays the provider cost plus the dispute fee.
- **Fix:** Handle refund/dispute events by inserting a 'pack_refund' ledger row that debits purchased_balance (allow it to go negative and block AI until settled).
- **$ impact:** ~1-3% of pack revenue plus provider cost of the refunded usage

<a id="bt-180"></a>
### BT-180 · P1 · effort S · Shared free text ceiling is 500 requests a day per user, which is far too high

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:158, artifacts/api-server/src/lib/aiCredits/ledger.ts:311-316`
- **Problem:** AI_TEXT_DAILY_LIMIT_PER_USER defaults to 500 across chat, agent, store AI and helpers on every plan, including no plan. Combined with the unbounded prompts above, that is the multiplier for the store-ai and chat abuse cases.
- **Why it costs money:** Each request can cost $0.005-1.80, so 500 a day for every free account is a large open liability.
- **Fix:** Make the ceiling plan-aware (free 20, Starter 100, Growth 300, Pro 500) and show the remaining count in the app as an upsell.
- **$ impact:** Caps the per-account text tail from ~$27k/mo to <$50/mo

<a id="bt-181"></a>
### BT-181 · P1 · effort S · Unlimited forced Whisper re-captioning per video post

- **Where:** post-detail · `artifacts/api-server/src/routes/post-captions.ts:64-80, artifacts/api-server/src/lib/captions.ts:26-31,217-245`
- **Problem:** POST /posts/:id/captions/generate with {force:true} skips the 'ready' check and re-runs the ffmpeg extract plus whisper-1 on up to 15 minutes of video. The only limits are an in-process inFlight set per post and 30/min. It is gated by the autoCaptions DB feature flag.
- **Why it costs money:** At $0.006/min, a 15-minute video is $0.09 per run, and many posts in parallel could reach about $3.9k a day. ffmpeg on the API host adds CPU.
- **Fix:** Allow force at most once per post per 24h (store the last force timestamp) and count it in the AI spend ledger.
- **$ impact:** $0 while the flag is off; up to ~$100k/mo theoretical with it on; normal ~$50/mo

<a id="bt-182"></a>
### BT-182 · P1 · effort M · Mobile client times out at 90s while generations keep running and stay charged

- **Where:** design-ai-photoshoot · `artifacts/mobile/lib/api.ts:93-101,1110-1111, artifacts/api-server/src/lib/aiCredits/gate.ts:68-72, artifacts/mobile/app/design-bg-removal.tsx:280-286`
- **Problem:** EXPENSIVE_REQUEST_TIMEOUT_MS is 90s, but mockup-to-model (5 refs at concurrency 2, each up to 2 high edits) or any 2-attempt QA run can take longer. The client aborts and shows 'Request timed out', while the server finishes, pays OpenAI, and returns 200 to a closed socket. The gate's 'finish' handler sees no error, so credits stay debited.
- **Why it costs money:** The user pays credits for nothing and retries, so Brandthread pays the provider twice.
- **Fix:** Make long generations async (job id plus poll or push), or set the client timeout above the worst-case server time and propagate req 'close' to an AbortController passed to the OpenAI call.
- **$ impact:** Duplicate spend on an estimated 5-15% of heavy generations

<a id="bt-183"></a>
### BT-183 · P1 · effort M · FFmpeg video compose runs on the API server with no concurrency limit

- **Where:** post-composer · `artifacts/api-server/src/routes/post-video.ts:19-25,369-576`
- **Problem:** /posts/compose-video accepts up to 12 clips, 1.5GB and 600s and runs ffmpeg inline in the API process. It has only the generic mutation limit (120/min) and no queue or concurrency cap. Avatar video, captions and thumbnails also shell out to ffmpeg.
- **Why it costs money:** A few concurrent composes saturate the API instance's CPU, so it needs larger instances or autoscaling and slows checkout for everyone.
- **Fix:** Move transcoding to a queue or worker with concurrency 1-2 per instance, or a managed service (Mux or Cloudflare Stream at about $1/1k min). Rate-limit compose to about 10 per user per hour.
- **$ impact:** $100-500/mo extra compute, plus checkout latency risk

<a id="bt-184"></a>
### BT-184 · P1 · effort S · Media is served through the API with no CDN by default

- **Where:** feed · `artifacts/api-server/src/lib/objectStorage.ts:93-112, artifacts/api-server/src/lib/cdnUrl.ts:1-15, docs/performance/launch-and-media.md:104-118`
- **Problem:** downloadObject streams GCS objects through the Node API (createReadStream) for /api/posts/media and the other media paths. CDN_BASE_URL is off unless configured, and the doc says 'Nothing here requires one'.
- **Why it costs money:** Every video view pays GCS egress (about $0.12/GB) plus API bandwidth and CPU. A feed of video posts at 1k DAU can easily push TBs a month.
- **Fix:** Put Cloud CDN or Cloudflare in front of the bucket before launch and set CDN_BASE_URL plus EXPO_PUBLIC_CDN_BASE_URL. Serve via signed CDN URLs, not API proxying.
- **$ impact:** ~$100-1,200/mo egress at launch scale (1-10TB); >50% saved with a CDN

<a id="bt-185"></a>
### BT-185 · P2 · effort S · Gate debits before requirePlan, so non-Growth requests churn the ledger and the global cap

- **Where:** server · `artifacts/api-server/src/routes/index.ts:219,239-244, artifacts/api-server/src/lib/aiCredits/gate.ts:47-77`
- **Problem:** aiCreditsGate runs on /logo, /mockup and the other tools before requirePlan('growth'). Starter or free sellers with any balance get a debit, then a 403, then a refund, and each request takes row locks on ai_credit_accounts and the global ai_spend_daily row (FOR UPDATE).
- **Why it costs money:** Extra DB contention on a single hot row that every paid generation serialises on. It also inflates the alert counters briefly.
- **Fix:** Run requirePlan before the gate for these mounts (or have the gate skip when the plan is below the route's minimum), and shard the global counter.
- **$ impact:** Indirect: DB load and latency

<a id="bt-186"></a>
### BT-186 · P2 · effort S · Global emergency cap is shared by all users, so abusers can lock out paying sellers

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/catalogue.ts:152, artifacts/api-server/src/lib/aiCredits/ledger.ts:197-199`
- **Problem:** Once 250,000 credits are spent in a UTC day, every seller, Pro included, gets 503 'AI limit reached'. There is no per-plan reservation and no per-user share.
- **Why it costs money:** A handful of abusive Pro or trial accounts can take AI offline for all paying customers for the rest of the day, which drives churn and refunds.
- **Fix:** Add per-user daily dollar caps (for example Growth $5/day, Pro $20/day) and reserve global headroom for paid plans.
- **$ impact:** Churn risk on an AI-led seller base

<a id="bt-187"></a>
### BT-187 · P2 · effort S · In-memory per-route limiters key on req.auth?.userId and may collapse to 'anon'

- **Where:** server · `artifacts/api-server/src/routes/logo.ts:17-31,106, artifacts/api-server/src/routes/mockup.ts:20-35,59, artifacts/api-server/src/routes/lifestyle.ts:20-35,71`
- **Problem:** The limiters read (req as any).auth?.userId and fall back to 'anon'. requireAuth uses getAuth(req) and sets req.clerkUserId. With @clerk/express ^2.x, where req.auth is callable, the property read can be undefined, so either every user shares one 5/min bucket (throttling paying users) or the limit is effectively per-process only. Maps are never pruned and don't span instances. (Needs a runtime check.)
- **Why it costs money:** Either throttles legitimate paid usage or fails to cap cost when scaled horizontally.
- **Fix:** Use req.clerkUserId and the Redis-backed rateLimit middleware with a dedicated 'image-gen' policy.
- **$ impact:** Indirect

<a id="bt-188"></a>
### BT-188 · P2 · effort S · ai-helpers comment says the tools are 'priced in AI_TOOL_RULES', but they are free text

- **Where:** product-editor · `artifacts/api-server/src/routes/index.ts:221, artifacts/api-server/src/lib/aiCredits/catalogue.ts:77-79, artifacts/api-server/src/routes/ai-helpers.ts:119,178,235`
- **Problem:** The mount comment says caption, description and size chart are priced, but the catalogue marks them 'text' (free, never debited). product-description sends up to 4 product images (low detail) to gpt-5.4-mini.
- **Why it costs money:** Misleading docs, and a missed chance to meter the image-bearing helper.
- **Fix:** Fix the comment. Either charge 1 credit for product-description with images or cap it per day for no-plan sellers.
- **$ impact:** Small: ~$0.003/call

<a id="bt-189"></a>
### BT-189 · P2 · effort S · Store AI vision routes use gpt-5 for store theme JSON with no caching

- **Where:** store-from-moodboard · `artifacts/api-server/src/routes/store-ai.ts:93-159,166-191`
- **Problem:** from-logo, from-moodboard and from-social call gpt-5, a reasoning model at $1.25/$10 per M, with max_completion_tokens 1500. The output is a simple JSON theme. Results aren't cached and the client can re-run them freely. Errors leak String(err) to the client.
- **Why it costs money:** About 5-10x the cost of gpt-5-mini or 4.1-mini for the same output. Reasoning tokens can also eat the 1,500 budget and return empty JSON, which drives retries.
- **Fix:** Switch to gpt-5.4-mini or gpt-4.1-mini with json_schema, cache by image hash, and return generic errors.
- **$ impact:** ~$0.02-0.03 per call saved; small at scale

<a id="bt-190"></a>
### BT-190 · P2 · effort S · Seller snapshot rebuilt from about 12 DB queries on every chat message

- **Where:** ai-assistant · `artifacts/api-server/src/routes/ai.ts:168-196, artifacts/api-server/src/lib/sellerSnapshot.ts:220-330`
- **Problem:** buildSellerSnapshot(userId) runs fresh for every /ai/chat and /chat/stream turn, and the full snapshot JSON plus help docs is resent as the system prompt every turn. OpenAI prompt caching only helps if the prefix is identical, and the snapshotAt timestamp changes it every time.
- **Why it costs money:** Extra DB load and full-price input tokens on every message.
- **Fix:** Cache the snapshot for about 60s per user, move snapshotAt after the static help docs (stable prefix first) so prompt caching applies, and send the snapshot only on the first turn.
- **$ impact:** ~30-50% of chat input-token cost

<a id="bt-191"></a>
### BT-191 · P2 · effort S · Shopify store-URL import is unmetered: up to 400 fetches plus a gpt-4.1 call per job

- **Where:** store-from-shopify · `artifacts/api-server/src/routes/shopify-import.ts:42-66,229-280, artifacts/api-server/src/lib/shopifyImport.ts:8-10,177-180`
- **Problem:** POST /shopify-imports and /:id/continue each start a job that makes up to 400 outbound requests (8MB each) and a gpt-4.1 copy call. The only gates are requireRole('manager') and the generic mutation limit (120/min). There is no plan check and no per-day job cap.
- **Why it costs money:** Bandwidth, CPU and token cost per job, plus a risk of being used as a scraping proxy against third-party stores.
- **Fix:** Limit to about 5 jobs per seller per day, and add the path to EXPENSIVE_PATH.
- **$ impact:** ~$0.05-0.2 per job; abuse in the low hundreds per month

<a id="bt-192"></a>
### BT-192 · P2 · effort S · 1:1 Agora video calls are free for every user with no duration or daily cap

- **Where:** conversation · `artifacts/api-server/src/routes/call.ts:26,122-188`
- **Problem:** POST /call/token issues a 15-minute publisher token to any DM participant (buyers included), and a new token can be requested freely. Ordinary DMs have no per-day minute cap and no plan gate.
- **Why it costs money:** Agora bills about $3.99 per 1,000 user-minutes for HD video. Two colluding accounts calling around the clock cost about $345/mo, and normal buyer-seller calls are unpriced.
- **Fix:** Cap call minutes per user per day (for example 60), use audio-only by default for buyer DMs, and consider making seller video calls a Growth perk.
- **$ impact:** ~$345/mo per abusive pair; normal usage likely <$100/mo

<a id="bt-193"></a>
### BT-193 · P2 · effort M · Live streams have no maximum duration; every stream records 720p to cloud storage

- **Where:** go-live · `artifacts/api-server/src/routes/live.ts:48,89-140, artifacts/api-server/src/lib/agoraCloudRecording.ts:172-205`
- **Problem:** Pro hosts can stay live indefinitely (token TTL 2h, renewable). Every stream starts Agora mix-mode cloud recording at 720x1280, 1,130 kbps, and stores HLS+MP4 forever. Agora also bills every viewer-minute.
- **Why it costs money:** A 24/7 stream is about 43k host-minutes, about $170 of RTC plus about $260 of recording plus about 360GB of storage a month, more than the $199 Pro price. A 1,000-viewer hour is about $240.
- **Fix:** Cap streams at 4h, auto-end on host idle, expire replays after 90 days unless pinned, and price viewer-heavy usage (for example via live commission).
- **$ impact:** Low until live is popular; each viral stream costs $100s

<a id="bt-194"></a>
### BT-194 · P2 · effort S · Email marketing has no plan gate and a 1,000/day per-seller cap

- **Where:** email-campaigns · `artifacts/api-server/src/routes/email-marketing.ts:13-40,205-340, artifacts/api-server/src/lib/emailMarketing/sender.ts:18-26`
- **Problem:** Any seller with the marketing permission, including no plan or Starter, can send up to EMAIL_DAILY_SEND_CAP (default 1,000) emails a day through Resend. grep for requirePlan or plan in the route found nothing.
- **Why it costs money:** 30k emails a month per seller at about $0.0009 each is about $27/mo per active seller. Email is also a standard paid-tier feature that is being given away.
- **Fix:** Gate campaigns to Growth+ (or a plan-based monthly send quota: Starter 500, Growth 10k, Pro 50k) and show the quota as an upsell.
- **$ impact:** At 1k free/Starter sellers sending: up to ~$27k/mo; also an upsell lever

<a id="bt-195"></a>
### BT-195 · P2 · effort S · SMS OTP sign-in exposes the Clerk account to SMS pumping fraud

- **Where:** sign-in · `artifacts/mobile/app/sign-in.tsx:96-103,177-205`
- **Problem:** sign-in offers phone-code sign-in whenever Clerk allows it (signIn.phoneCode.sendCode). The app adds no country allowlist, CAPTCHA or per-number throttle. Protection depends entirely on Clerk dashboard settings.
- **Why it costs money:** International SMS pumping can run to thousands of dollars per incident, and Clerk bills SMS beyond the included US/CA volume.
- **Fix:** In the Clerk dashboard, restrict SMS to launch countries, enable bot protection, and consider email-first OTP with phone as optional.
- **$ impact:** $0 normally; $1-10k per pumping incident

<a id="bt-196"></a>
### BT-196 · P2 · effort S · Design Studio gives every signed-in account 2GB of cloud storage with no plan tiering

- **Where:** design-canvas · `artifacts/api-server/src/routes/index.ts:347, artifacts/api-server/src/routes/design-studio.ts:22-25,430-440`
- **Problem:** /design-studio requires auth plus teamContext only, and MAX_OWNER_ASSET_BYTES is 2GB for every account regardless of plan. Background-removal results are also saved to GCS forever (bg-removal.ts saveToGCS) with no retention policy.
- **Why it costs money:** Storage grows without bound across free accounts, and plan-based storage is a common upsell that is being missed.
- **Fix:** Tier storage (free 100MB, Starter 1GB, Growth 5GB, Pro 20GB) and add lifecycle deletion for bg-removal results after 30 days.
- **$ impact:** ~$0.04/GB-mo; small but grows; upsell lever

<a id="bt-197"></a>
### BT-197 · P2 · effort S · Review-readiness doc says no AI credit product exists, but credit packs are live

- **Where:** n/a · `docs/review-readiness/iap-rails.md:15, artifacts/api-server/src/lib/aiCredits/catalogue.ts:103-110, artifacts/mobile/app/ai-credits.tsx:13-16,120-181`
- **Problem:** iap-rails.md row 5 says 'No credit or pay-per-use AI product exists ... PASS'. The code now sells 3 consumable packs (RevenueCat on native, Stripe on web) and needs App Store Connect consumable products brandthread_ai_credits_500/1500/5000.
- **Why it costs money:** Review notes and App Store Connect setup will be wrong. Missing IAP products leave the pack section hidden on iOS (lost revenue), or the review gets rejected over an undeclared consumable.
- **Fix:** Update the doc, create the 3 consumables in ASC and Play, and attach them to the review submission.
- **$ impact:** Pack revenue blocked on iOS until the products exist

<a id="bt-198"></a>
### BT-198 · P2 · effort S · Pro ceiling counts requests, not images, with no per-user concurrency limit

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/ledger.ts:187-209, artifacts/api-server/src/lib/aiCredits/catalogue.ts:154`
- **Problem:** The proDailyGenerations ceiling increments by 1 per request, whether that request is one bg removal or a 5-reference mockup-to-model run (up to 10 edits). Requests have no per-user concurrency limit.
- **Why it costs money:** The ceiling understates real spend by up to 10x.
- **Fix:** Increment by the number of output images (or by credit cost) and cap concurrent jobs per user at 2.
- **$ impact:** Part of the Pro exposure above

<a id="bt-199"></a>
### BT-199 · P2 · effort S · Expensive-path rate-limit regex misses several paid AI routes

- **Where:** server · `artifacts/api-server/src/middlewares/rateLimit.ts:224-225`
- **Problem:** EXPENSIVE_PATH covers ai|logo|mockup|photography|lifestyle|techpack|bg-removal|store/ai|support-chat/message. It does not match /ai-helpers (the regex needs '/ai/' or '/ai' at the end), /onboarding-sample, /posts/:id/captions/generate (which adds it explicitly), /brandthread-agent (which has its own policy), /shopify-imports or /places. It is also case-sensitive.
- **Why it costs money:** Uncovered routes fall back to the 120/min mutation policy, 4x looser.
- **Fix:** Replace the regex with explicit per-router rateLimit('expensive') middleware, or make it case-insensitive and list every AI mount.
- **$ impact:** Multiplier on the abuse cases above

<a id="bt-200"></a>
### BT-200 · P3 · effort S · Techpack PDF is billed 4 credits for one gpt-4.1 text call costing about $0.01

- **Where:** tech-pack-generator · `artifacts/api-server/src/routes/techpack.ts:83-100,261-345, artifacts/api-server/src/lib/aiCredits/catalogue.ts:89`
- **Problem:** techpack/generate makes one generateText call (default gpt-4.1, about 2-3k tokens) and renders the PDF locally with PDFKit. It is priced at 4 credits and gated to Growth.
- **Why it costs money:** No loss here, but Starter sellers, who would value tech packs for manufacturers, can't use it at all.
- **Fix:** Consider opening tech packs to Starter at 4 credits as a reason to subscribe, since it is profitable per call.
- **$ impact:** Upsell lever, ~$0.01 cost per call

<a id="bt-201"></a>
### BT-201 · P3 · effort S · Brandthread Agent chat has sensible limits (reference point)

- **Where:** brandthread-agent · `artifacts/api-server/src/routes/brandthread-agent.ts:29-33,81-160, artifacts/api-server/src/middlewares/rateLimit.ts:141-147`
- **Problem:** The agent has no tool loop. It uses 16 history messages, 2,000-char inputs, max_completion_tokens 300, the agent-chat limit (20/min) and the 500/day text ceiling. Cost is about $0.002 per message.
- **Why it costs money:** Low exposure. It is listed so it is not mistaken for an unbounded agent loop.
- **Fix:** No change needed beyond plan-aware text ceilings.
- **$ impact:** <$0.01/msg

<a id="bt-202"></a>
### BT-202 · P3 · effort S · Image moderation and prompt moderation use free OpenAI moderation (no cost issue)

- **Where:** server · `artifacts/api-server/src/lib/aiSafety/promptFilter.ts:200-225, artifacts/api-server/src/lib/imageModeration.ts:41-46, artifacts/api-server/src/lib/mediaModeration.ts:125-127`
- **Problem:** omni-moderation-latest is free. The one cost is the extra round trip per AI request. The guard skips signed-out traffic.
- **Why it costs money:** No direct cost.
- **Fix:** Keep it. Make sure AI_INTEGRATIONS_OPENAI_API_KEY is set in prod so moderation actually runs.
- **$ impact:** $0

<a id="bt-203"></a>
### BT-203 · P3 · effort S · analytics-insights and product-seo make no paid AI calls despite their names

- **Where:** analytics · `artifacts/api-server/src/routes/analytics-insights.ts:46-47,525-796, artifacts/api-server/src/routes/product-seo.ts:58-244`
- **Problem:** grep for openai, generateText and completeJson finds no hits in either file. Insights are SQL-based, and /advanced is gated by requirePlan('pro'). SEO fields are entered manually.
- **Why it costs money:** No cost. This is a monetisation gap: AI SEO title/description generation is a cheap (~$0.002) feature that would justify paid tiers.
- **Fix:** Add an AI SEO suggestion through ai-helpers (credit-priced or Starter+).
- **$ impact:** Upsell lever only

<a id="bt-204"></a>
### BT-204 · P3 · effort S · Credit ledger cannot go negative and debits atomically before the call (verified working)

- **Where:** server · `artifacts/api-server/src/lib/aiCredits/ledger.ts:167-236, artifacts/api-server/src/lib/aiCredits/gate.ts:47-89`
- **Problem:** debitCredits locks the account row, checks total >= cost, debits rollover, then monthly, then purchased, and fails closed (503) if billing errors. Free/no-plan accounts get 0 monthly credits. Refunds are idempotent. For matched paths the gate design is sound; the leaks are unmatched paths and the pricing.
- **Why it costs money:** None directly. Fixes should reuse this ledger rather than replace it.
- **Fix:** Keep it. Move cost into the route (a debit helper) so path regexes can't drift.
- **$ impact:** n/a

## Seller funnel: install → first sale

44 findings: 3 P0 · 19 P1 · 13 P2 · 9 P3

<a id="bt-205"></a>
### BT-205 · P0 · effort S · Simple product (no size/color options) is saved with zero variants and no price; it cannot be bought

- **Where:** add-product · `artifacts/mobile/app/add-product.tsx:638-648,736-766,786-790,artifacts/api-server/src/routes/products.ts:239-243,artifacts/api-server/src/lib/money/cartCheckout.ts:160-175,artifacts/mobile/app/buyer-product-detail.tsx:149,784-791,851`
- **Problem:** For a product with no options, localVariants is [], so productVariantsForServer is [] and serverCreatePayload has no price field (products has no price column). The server inserts the product with no product_variants rows. Buyers see lowestPrice 0 ($0.00), findVariant returns undefined, and addToCart returns early (line 851). Checkout prices only from product_variants. The "In stock" stepper (stockStr) is also never sent. A seller who lists a one-size tee or a print gets a "Product published! … is now live" sheet for an item nobody can buy.
- **Why it costs money:** This is the most common first listing for a new brand. Every one of those listings produces $0 GMV, and therefore $0 commission, while the seller believes they are live.
- **Fix:** Additive: in handlePublish, when localVariants is empty, send one default variant { sku: auto, priceCents: pricing.priceCents, stock: parseInt(stockStr) || 0 }. Add a server-side guard too: if status=active and there are no variants, create a default variant from a new priceCents body field.
- **$ impact:** blocks commission on every no-options listing; likely 30-50% of first listings, so tens of $k GMV/month and roughly $1-3k/mo commission at target scale

<a id="bt-206"></a>
### BT-206 · P0 · effort S · Sellers can activate products and publish the store before Stripe Connect; buyer checkout then fails

- **Where:** add-product / store-publish / buyer checkout · `artifacts/api-server/src/routes/store.ts:870-881,artifacts/api-server/src/routes/products.ts:146-265,artifacts/api-server/src/lib/money/cartCheckout.ts:209-211,artifacts/api-server/src/routes/buyer.ts:685-692`
- **Problem:** Product create and store publish do not check stripeAccountStatus. Discover and feed show the products. Only at checkout does the buyer get SELLER_PAYMENTS_UNAVAILABLE / "Seller payment account is not yet active".
- **Why it costs money:** Each buyer who reaches checkout on an unconnected seller is a lost sale and a worse buyer impression of the platform.
- **Fix:** Additive: (1) a "Payouts not set up — buyers can’t check out yet" interstitial on add-product (status=active) and on launch-publish; (2) a buyer-facing "Notify me when available" on product detail when the seller is not connected. Don’t hard-block publishing.
- **$ impact:** ~$2-4k/mo of GMV commission plus lost buyers on early sellers who list before connecting

<a id="bt-207"></a>
### BT-207 · P0 · effort M · Shipping-label from-address falls back to the buyer’s address

- **Where:** fulfill-order / shipping-label · `artifacts/mobile/app/fulfill-order.tsx:246-247,artifacts/mobile/app/fulfill-batch.tsx:72-74,artifacts/mobile/app/order-detail.tsx:155-171,artifacts/api-server/src/routes/shipping-labels.ts:76-77`
- **Problem:** fulfill-order sends fromAddress = order.fulfillment.fromAddress ?? order.customer.shippingAddress. adaptApiOrder never sets fulfillment.fromAddress, so it is always undefined and the buyer’s own address becomes address_from on the Shippo shipment. Rates are quoted buyer-to-buyer (wrong price), and the purchased label shows the buyer as sender, so undeliverable returns go to the buyer.
- **Why it costs money:** The first order is mis-shipped or mis-priced. Seller support and refunds follow, and the label cost charged against the seller balance may not match the real shipment.
- **Fix:** Additive: add a ship-from address step (reuse /locations) before the first label, map it into fulfillment.fromAddress, and have the server reject /rates when fromAddress equals shippingAddress.
- **$ impact:** every first order that buys a label is affected; refunds and churn on first sales

<a id="bt-208"></a>
### BT-208 · P1 · effort M · Funnel count: ~15 screens/~40 taps to first listing; ~25 screens/~75 taps to get paid

- **Where:** n/a · `artifacts/mobile/app/splash.tsx:23-36,artifacts/mobile/lib/onboardingFlow.ts:64-76,artifacts/mobile/app/onboarding.tsx:2510-2820,artifacts/mobile/app/(tabs)/index.tsx:88-103,artifacts/mobile/app/add-product.tsx:2010-2045,artifacts/mobile/components/StripeConnectWarning.tsx:93-115,artifacts/mobile/app/launch-publish.tsx:66-84`
- **Problem:** Path to the first listing (email signup): native splash and splash.tsx (auto-advance after 2.5s, 0 taps), then onboarding WELCOME (1), ACCOUNT_TYPE (2: card + Continue), AUTH (about 9 inputs: first, last, email, username, password, confirm, DOB, terms, Create; then a 6-digit code and Verify, about 11), NAME (1, already prefilled), BRAND_NAME (2), BRAND_STAGE (1), GOALS (1, Skip), PLAN preview/sample (1), PLAN pick (1), LOADING (auto), NOTIFICATIONS (2 with the OS prompt), SUCCESS (1). That is 13 onboarding screens and about 25 taps. The dashboard then auto-opens the setup walkthrough sheet and a 3-step FirstRunTip tour (about 4 taps to clear). Add product (1), photo (about 4), name (1), price (1), status pill set to Active (2), Save (1). Total: about 15 screens and about 40 taps to a "published" product, and that product cannot be bought (see the no-variant finding). To actually get paid, add the Stripe Connect banner (1), Stripe hosted Express onboarding (about 8-12 external screens, about 25 taps), Launch card, Publish, Publish (3) and variant/stock setup (about 6). That is about 25+ screens and about 75 taps.
- **Why it costs money:** Every extra required screen before the first live, buyable listing costs signups. Industry onboarding drop-off is roughly 5-10% per required step, and two of the steps here (duplicate NAME, plan screen with no purchase) add friction without adding value.
- **Fix:** Keep the flow but add nothing new to it. Auto-advance NAME when it is already prefilled, route SUCCESS straight into add-product, and put a single "Get paid" CTA on the add-product success sheet so the money path is one continuous track.
- **$ impact:** ~$3-6k/mo: a 15-25% lift in sellers reaching a live, buyable product directly scales both subscription and 5% commission revenue

<a id="bt-209"></a>
### BT-209 · P1 · effort S · New product variants default to stock 0 with tracking on; "published" listings show as sold out

- **Where:** add-product · `artifacts/mobile/app/add-product.tsx:236-237,590,641,741-742,artifacts/api-server/src/routes/products.ts:198,artifacts/mobile/app/buyer-product-detail.tsx:790`
- **Problem:** trackInventory defaults to true. Generated variants start with qty "" and are sent as stock 0. validateForPublish only checks name, price and photo. An Active product can be saved with every variant at 0 stock, and buyers see it as out of stock (inStock requires inventoryQuantity > 0). There is no warning at Save.
- **Why it costs money:** The first listing looks live to the seller but cannot convert. The seller sees traffic and no sales and churns.
- **Fix:** Additive: add a validateForPublish warning ("All variants have 0 in stock — buyers will see Sold out. Publish anyway?") when status=active and total stock is 0.
- **$ impact:** ~$1-2k/mo of lost first-week GMV commission plus seller churn

<a id="bt-210"></a>
### BT-210 · P1 · effort S · New products default to Draft, and the success sheet offers no "Publish now" or share step

- **Where:** add-product · `artifacts/mobile/app/add-product.tsx:219,2010-2013,2194-2207`
- **Problem:** storeSettings.status defaults to "draft". The only way to go Active is a small header status pill and an action sheet. If the seller just fills the form and taps Save, the sheet says "Draft saved!" with "View product" and "Done". Nothing on it offers "Publish now" or "Share your product".
- **Why it costs money:** Drafts earn $0. New sellers often don’t notice the pill and leave their first product invisible.
- **Fix:** Additive: when kind=created and status=draft, add a primary "Publish now" action to the SuccessSheet (it calls api.products.update with status active). When published, add a "Share product" action.
- **$ impact:** ~$1-2k/mo: recovers first listings stuck in draft

<a id="bt-211"></a>
### BT-211 · P1 · effort S · "Add your first product" checklist task completes on a draft, and the server launch checklist counts drafts/archived

- **Where:** dashboard / launch-checklist · `artifacts/mobile/app/add-product.tsx:786-789,artifacts/api-server/src/routes/seller-launch-checklist.ts:33-34,artifacts/api-server/src/lib/launchChecklist.ts:62`
- **Problem:** completeSetupTaskAfter("first_product") uses the default confirmsSuccess=()=>true, so a draft ticks the task. The server launch checklist uses count(*) over products with deletedAt null, which includes draft and archived. Both checklists say the product step is done when nothing is buyable.
- **Why it costs money:** Inaccurate progress removes the nudge exactly when the seller still needs it.
- **Fix:** Pass confirmsSuccess: () => finalStatus === "active" in add-product, and add `AND status = 'active'` to the launch-checklist product count.
- **$ impact:** ~$500-1k/mo: keeps the nudge alive for sellers whose only product is a draft

<a id="bt-212"></a>
### BT-212 · P1 · effort S · No seller alert when a buyer is blocked at checkout because the seller has no payouts

- **Where:** server · `artifacts/api-server/src/lib/money/cartCheckout.ts:209-211,artifacts/api-server/src/routes/buyer.ts:680-692`
- **Problem:** When checkout throws SELLER_PAYMENTS_UNAVAILABLE, nothing notifies the seller. A grep of lib, routes and jobs finds no "lost sale" or "seller_not_ready" publishNotification.
- **Why it costs money:** This is the strongest possible activation nudge ("A buyer just tried to pay you $48 — finish payouts to get it"), and it goes unsent.
- **Fix:** Additive: on SELLER_PAYMENTS_UNAVAILABLE, call publishNotification({ userId: sellerId, type: "checkout_blocked_no_payouts" }), throttled to once per 24h per seller, with a deep link to /payouts.
- **$ impact:** ~$1-3k/mo: converts blocked buyers into connected sellers and recovered sales

<a id="bt-213"></a>
### BT-213 · P1 · effort M · No activation nudge jobs: nothing fires for 0 products, unfinished payouts, or abandoned onboarding

- **Where:** server · `artifacts/api-server/src/jobs/ (abandonedCartRecovery, sellerTrialReminder, teamInviteReminder, etc.)`
- **Problem:** The jobs directory has buyer cart recovery, trial-day-4 and team-invite reminders, but no seller activation job. Searches for activation, nudge, drip, "first product" and "finish setup" found nothing. A seller who signs up and has 0 products after 24h, a product but no Stripe after 48h, or a Clerk account but onboarding_complete=false gets no push or email.
- **Why it costs money:** Activation is the biggest lever on a subscription business. Sellers who list in week 1 are far more likely to stay.
- **Fix:** Additive: add a jobs/sellerActivationNudges.ts modeled on sellerTrialReminder.ts (lease plus event table): T+24h with 0 active products, T+48h with no stripe active, T+72h with no publish, and incomplete onboarding at T+2h and T+24h by email.
- **$ impact:** ~$3-5k/mo: a 10-20% activation lift on the signup cohort

<a id="bt-214"></a>
### BT-214 · P1 · effort M · Buyer-to-seller conversion is impossible in-app: account-type-settings has no entry point

- **Where:** account-type-settings · `artifacts/mobile/app/account-type-settings.tsx:87-112,artifacts/mobile/services/settingsCatalog.ts:34-130,artifacts/mobile/app/_layout.tsx:808-812`
- **Problem:** account-type-settings.tsx exists, but no buyer settings menu or other screen links to it (it is only referenced in parentFallback and SellerGlobalTabBar). If a buyer did reach it, it only PATCHes accountType and says "Restart the app". Local AsyncStorage user_role stays "buyer", and AuthGate trusts the local role first, so they stay in (buyer). No brandName or brandStage is collected either, which the server requires for seller completion (auth.ts:663-667).
- **Why it costs money:** Buyers who make things are the cheapest seller acquisition channel, and that path is closed.
- **Fix:** Additive: add a "Start selling on Brandthread" row to the buyer settings catalog that opens onboarding in an add-seller mode (BRAND_NAME → BRAND_STAGE → PLAN → finishSeller), updates the local user_role, and routes to /(tabs).
- **$ impact:** ~$1-3k/mo: even 1% of buyers converting to subscribing sellers is meaningful at scale

<a id="bt-215"></a>
### BT-215 · P1 · effort S · Seller onboarding ends on the dashboard rather than the value moment (add product)

- **Where:** onboarding (SUCCESS) · `artifacts/mobile/app/onboarding.tsx:2440,artifacts/mobile/app/(tabs)/index.tsx:88-103,artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:289-296`
- **Problem:** finishSeller does router.replace("/(tabs)/"). On first open the dashboard stacks the StripeConnectWarning banner, the auto-opened SetupWalkthroughSheet, the anchored 3-step FirstRunTip tour, the new-seller card and the LaunchChecklistCard. That is five competing prompts before the seller lists anything.
- **Why it costs money:** Choice overload at the first touch lowers first-product completion.
- **Fix:** Additive: on firstCompletion route to /add-product?from=onboarding, and suppress FirstRunTip and the walkthrough auto-open until after the first product.
- **$ impact:** ~$1-2k/mo via higher day-0 listing rate

<a id="bt-216"></a>
### BT-216 · P1 · effort S · Launch checklist orders Payouts last, after Publish; buyers arrive before payment works

- **Where:** launch-checklist · `artifacts/api-server/src/lib/launchChecklist.ts:7-16,artifacts/mobile/lib/launchChecklist.ts:80-93`
- **Problem:** Step order is name, logo/banner, accent, socials, first_product, preview, publish, payouts. "Next:" on the dashboard card walks the seller through publishing (and the "You’re live — share link" moment) before payouts.
- **Why it costs money:** Sellers share a store they cannot get paid from, and every early buyer hits SELLER_PAYMENTS_UNAVAILABLE.
- **Fix:** Reorder LAUNCH_STEP_IDS so payouts comes before publish (an additive reorder of the array, no UI change).
- **$ impact:** ~$1-2k/mo of early GMV that currently fails at checkout

<a id="bt-217"></a>
### BT-217 · P1 · effort S · launch-publish "You’re live" screen has no payouts warning

- **Where:** launch-publish · `artifacts/mobile/app/launch-publish.tsx:66-84,130-178`
- **Problem:** publish() calls publishStore and then shows the "You’re live" share/QR screen. It never reads checklist.steps.payouts, and StripeConnectWarning is not on this screen. It is mounted only on the dashboard, payouts, seller-settings and billing-access.
- **Why it costs money:** The share burst after going live sends traffic to a store that cannot take money.
- **Fix:** Additive: render <StripeConnectWarning /> at the top of the live state, and show a "Set up payouts so buyers can pay" row when payouts is not done.
- **$ impact:** ~$500-1.5k/mo

<a id="bt-218"></a>
### BT-218 · P1 · effort S · publishStore() swallows the server publish error and still reports "You’re live"

- **Where:** store-publish / launch-publish · `artifacts/mobile/services/storeService.ts:1532-1552`
- **Problem:** publishStore saves publishStatus="published" to local AsyncStorage and then calls `try { await api.store.publish(); } catch { /* no-op */ }`, returning success:true either way. On a network or 5xx failure the seller sees the "You’re live" celebration, but the server storefront stays draft, and the server-derived checklist still says unpublished.
- **Why it costs money:** The seller shares a store that the server considers unpublished, and the visible state contradicts the checklist.
- **Fix:** Have the catch return { success:false, message:"Couldn’t publish — try again" } instead of swallowing the error (additive error handling).
- **$ impact:** ~$300-800/mo of lost launches plus support tickets

<a id="bt-219"></a>
### BT-219 · P1 · effort M · Storefront draft is cached device-wide (bt:store:v1), not per user, and never cleared on sign-out

- **Where:** store-builder / store-publish · `artifacts/mobile/services/storeService.ts:21,375-431`
- **Problem:** getStorefront and saveStorefront use one AsyncStorage key that is not scoped to the user, and local storage is treated as "local truth". saveStorefront then fire-and-forgets api.store.save with the local copy. A second seller on the same device inherits and can push the previous seller’s storefront. A reinstall or new device starts from defaults, and the next save overwrites the server design.
- **Why it costs money:** Lost storefront work makes sellers re-setup or churn, and the cross-account leak is a trust and privacy problem.
- **Fix:** Scope the key to the userId the way setupStore does (@brandthread/setup_state:<userId>), clear it on sign-out in AuthGate, and hydrate from api.store.get() when no local copy exists.
- **$ impact:** ~$500-1k/mo of churn and support; also a privacy risk

<a id="bt-220"></a>
### BT-220 · P1 · effort S · Three different store URLs are shown to the seller

- **Where:** store-publish / share-store / launch-publish · `artifacts/mobile/app/store-publish.tsx:116-119,artifacts/mobile/app/share-store.tsx:22,42-47,artifacts/mobile/lib/storeQr.ts:12-15`
- **Problem:** store-publish confirms "live at https://<storeUrl>.brandthread.app" (a subdomain). share-store uses https://brandthread.app/store/<handle>. When the username is missing, share-store falls back to a slug of the brand name, which store/[handle] cannot resolve. launch-publish uses buildStoreUrl, which returns null with no handle and hides the link.
- **Why it costs money:** Sellers paste whichever URL they saw. If the subdomain or the brand-name slug does not resolve, all their launch traffic is lost.
- **Fix:** Additive: use buildStoreUrl() everywhere. In share-store, when there is no username, show "Set your @handle to get a link" instead of a made-up slug.
- **$ impact:** ~$500-1k/mo of misdirected launch traffic

<a id="bt-221"></a>
### BT-221 · P1 · effort S · CSV/Etsy/Shopify imports don’t tick "first product" and land as drafts with no bulk publish

- **Where:** product-import / shopify-import / products-bulk-edit · `artifacts/mobile/app/product-import.tsx:108-109,174,artifacts/api-server/src/lib/productImport/commit.ts:171,artifacts/mobile/components/products/ProductImportPreview.tsx:56,artifacts/mobile/app/products-bulk-edit.tsx:123-142,artifacts/api-server/src/routes/product-bulk.ts:6`
- **Problem:** Imports never call completeSetupTask("first_product"). CSV and Etsy commits force status "draft". The bulk-edit screen only exposes archive and draft (runStatus("archived"|"draft")), even though the server /product-bulk/status already accepts "active". A seller migrating 80 products must open and publish each one.
- **Why it costs money:** Migrating sellers are the highest-value cohort (existing catalog and buyers), and they get stuck at 0 live products.
- **Fix:** Additive: add a "Publish selected" action to products-bulk-edit calling productBulk.status({ status: "active" }), add a "Publish all imported" button to ProductImportPreview, and complete first_product on a successful commit.
- **$ impact:** ~$1-3k/mo: catalog sellers drive disproportionate GMV

<a id="bt-222"></a>
### BT-222 · P1 · effort S · Dashboard keeps saying "List your first product" until the first sale, even with products live

- **Where:** dashboard · `artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:654-655,894-901,artifacts/mobile/lib/sellerDashboardStats.ts:145-147,artifacts/mobile/components/SellerDashboardSetupCard.tsx:41-47`
- **Problem:** newSeller is everSoldCount <= 0, so a seller with 30 active products and 0 orders still sees "List your first product / Add a product". This is the moment a "Share your store" loop should replace it.
- **Why it costs money:** Sellers who have listed but not sold need traffic, not more products. The wrong CTA delays the first sale.
- **Fix:** Additive: when the active product count is > 0 and everSoldCount is 0, render a "Share your store to get your first sale" card (share-store, QR, copy link) in place of the add-product card.
- **$ impact:** ~$1-2k/mo: earlier first sale lifts retention and commission

<a id="bt-223"></a>
### BT-223 · P1 · effort S · No "share your store/product" loop after the first product is created

- **Where:** add-product · `artifacts/mobile/app/add-product.tsx:2194-2207,artifacts/mobile/app/share-store.tsx:57-66`
- **Problem:** Share prompts exist only on launch-publish and in the dashboard traffic panel (onShareStore). Creating the first Active product, the strongest share moment, gives "View product / Done".
- **Why it costs money:** This loses the free-distribution loop that brings the first buyers, especially before Meta Ads or Boost.
- **Fix:** Additive: add a "Share" action (Share.share with the product URL) to the SuccessSheet when kind=created and status=active.
- **$ impact:** ~$1-2k/mo of organic first-sale traffic

<a id="bt-224"></a>
### BT-224 · P1 · effort S · No checkout shipping charge unless the seller configured rates; sellers eat label costs

- **Where:** add-product / shipping / checkout · `artifacts/api-server/src/lib/money/cartCheckout.ts:252-257,artifacts/mobile/app/add-product.tsx:629,artifacts/mobile/lib/setupStore.ts:75-81`
- **Problem:** With no shipping zones and no active shipping_rate, checkout charges shippingCents = 0. The add-product "Shipping cost" field (estimatedShippingCostCents) is not used at checkout. Shipping setup is a non-blocking checklist item, so a new seller’s first orders ship free, and labels are then paid from their balance (FUNDS_RESERVED_FOR_LABELS).
- **Why it costs money:** First-order margin is negative for the seller ($5-10 per label), which is a common reason sellers quit after the first sale.
- **Fix:** Additive: in add-product, or when publishing the first Active product, show "Buyers currently pay $0 shipping — set rates" with a link to /shipping, plus a dashboard row when there are 0 shipping rates.
- **$ impact:** ~$500-1.5k/mo of seller margin and retention

<a id="bt-225"></a>
### BT-225 · P1 · effort S · Money features are buried: More tab unreachable, Subscription excluded from Studio menu

- **Where:** (tabs)/_layout / more / SellerStudioRadialMenu · `artifacts/mobile/app/(tabs)/_layout.tsx:115-120,artifacts/mobile/app/(tabs)/more.tsx:88-92,107-113,artifacts/mobile/components/SellerStudioRadialMenu.tsx:165-170,artifacts/mobile/services/settingsCatalog.ts:172-204`
- **Problem:** The More screen (with its "Money" section: Payouts, Subscription) has href:null, and nothing pushes to it except back-fallbacks. The Studio radial menu explicitly excludes "subscription". Subscription and Compare plans are reachable only through Profile, the settings gear, seller-settings and then the "Plan/subscription" section (about 4 taps, below the fold). Payouts is reachable from the Studio menu.
- **Why it costs money:** Self-serve upgrades need a visible path. Burying the plan cuts upgrade revenue.
- **Fix:** Additive: add a "Plan" row and badge to the dashboard header or profile top bar, and add "subscription" back into CARD_ORDER of the Studio menu.
- **$ impact:** ~$1-3k/mo of self-serve upgrades

<a id="bt-226"></a>
### BT-226 · P1 · effort S · Trial reminder job exists, but no trial is ever started in the seller funnel

- **Where:** server · `artifacts/api-server/src/jobs/sellerTrialReminder.ts:1-30,artifacts/mobile/app/onboarding.tsx:2389-2441`
- **Problem:** sellerTrialReminder sends a day-4 push to sellers on a live trial. Because onboarding never starts a trial, the job has nothing to act on. That is wasted engineering, and the docs and code suggest a working trial funnel that does not exist.
- **Why it costs money:** The conversion reminder, the last lever before auto-renew, never fires.
- **Fix:** This resolves automatically once the PLAN step triggers the trial. Cross-ref subscription-iap.
- **$ impact:** part of the trial-conversion loss above

<a id="bt-227"></a>
### BT-227 · P2 · effort S · Welcome email tells new sellers "Your style space is ready… discover brands" (buyer copy)

- **Where:** server · `artifacts/api-server/src/routes/auth.ts:212-224,artifacts/api-server/src/lib/brandthreadEmail.ts:245-253`
- **Problem:** sendWelcomeEmail fires on the first /auth/sync (created=true), which runs during the AUTH step before accountType is saved. finishSeller sets accountType later (onboarding.tsx:2406-2411). user.accountType is null, so roleLabel is "buyer" and the body is the buyer text. The CTA is a generic https://brandthread.app instead of a deep link to add-product.
- **Why it costs money:** The one guaranteed seller email is spent on the wrong message with no activation CTA.
- **Fix:** Additive: also send a seller-specific welcome at POST /auth/onboarding/complete firstCompletion when accountType=seller (idempotency key welcome-seller/<id>), with a CTA deep link to add-product, and skip the generic welcome when accountType is null.
- **$ impact:** ~$300-800/mo through better first-week activation

<a id="bt-228"></a>
### BT-228 · P2 · effort S · Invite-only flag gates buyers and sellers alike; no seller-only or buyer-only mode

- **Where:** access-code · `artifacts/api-server/src/lib/access/inviteOnly.ts:36-47,artifacts/api-server/src/routes/auth.ts:678-692,docs/launch/invite-only.md:1-25`
- **Problem:** inviteOnlySignup is a single global flag, and getAccessStatus does not look at accountType. It is OFF by default (migration 241), so organic seller signups are not blocked at launch. If Dev turns it on to throttle seller quality, it also blocks every organic buyer. The doc does not mention this.
- **Why it costs money:** Turning it on at launch would cut buyer acquisition, and therefore GMV, to zero for non-invited users.
- **Fix:** Additive: add an inviteOnlySellerSignup flag and check it only when accountType=seller in onboarding/complete and access/status. Document in invite-only.md that the current flag is all-roles.
- **$ impact:** would block all organic GMV if flipped; ~$0 while OFF

<a id="bt-229"></a>
### BT-229 · P2 · effort S · Seller NAME step re-asks the first name already captured on the auth form

- **Where:** onboarding (NAME) · `artifacts/mobile/app/onboarding.tsx:2677-2699,1154-1155,artifacts/mobile/lib/onboardingFlow.ts:68,artifacts/mobile/app/onboarding.ux.test.ts:112`
- **Problem:** The seller auth form requires formFirstName (canSubmit line 1202) and passes it in with onFirstNamePrefill. The next screen is a full NAME step asking "What should we call you?" with the same value prefilled. It is a non-skippable extra tap and screen.
- **Why it costs money:** This is one redundant required step in the highest-drop-off part of the funnel.
- **Fix:** Auto-advance past NAME when firstName.trim().length >= 2 came from the auth form or OAuth (keep the step for OAuth users with no name).
- **$ impact:** ~$300-700/mo: a few % fewer onboarding drop-offs

<a id="bt-230"></a>
### BT-230 · P2 · effort M · Plan/price screen comes before any value moment

- **Where:** onboarding (PLAN) · `artifacts/mobile/lib/onboardingFlow.ts:64-76,artifacts/mobile/app/onboarding.tsx:2772-2797`
- **Problem:** The price wall ($29/$79/$199) is step 7 of 10, before the seller has a workspace, a product or a storefront. The only value preview is one AI logo sample (SellerPreviewStep). Today it is harmless because nothing is charged. Once the trial is wired it will sit before value.
- **Why it costs money:** If the trial goes live here, conversion to trial is likely lower than after the first product. A card-required trial converts best right after an "aha" moment.
- **Fix:** Option A: keep the recommendation step but launch the purchase sheet after the first product is published, as an additive post-publish sheet. Option B: keep it in onboarding but show the sample storefront and logo inside the paywall. A/B test both.
- **$ impact:** ~$2-4k/mo swing in trial starts depending on placement

<a id="bt-231"></a>
### BT-231 · P2 · effort S · Launch checklist cannot reach 8/8 without an Instagram or TikTok account

- **Where:** launch-checklist / store-setup-socials · `artifacts/api-server/src/lib/launchChecklist.ts:50-61,artifacts/mobile/app/store-setup-socials.tsx:50-52`
- **Problem:** The socials step is required for checklist completion (hasSocial needs instagram or tiktok), and store-setup-socials disables Continue until one valid handle is entered. There is no skip. Sellers with no IG/TikTok, or who sell through Pinterest or offline, never finish, so the "Launch your store" card stays forever.
- **Why it costs money:** A permanently incomplete checklist reads as "not ready", and it is a forced step that could be deferred.
- **Fix:** Additive: add a "Skip for now" link on store-setup-socials that records socials_skipped_at, and treat that as done in deriveLaunchChecklist.
- **$ impact:** ~$200-500/mo through cleaner launch completion

<a id="bt-232"></a>
### BT-232 · P2 · effort S · Store publish has no product/payout gate; an empty store can go "live"

- **Where:** store-publish · `artifacts/mobile/services/storeService.ts:1505-1530,artifacts/api-server/src/routes/store.ts:870-881`
- **Problem:** validateStore blocks only on store name, sections and URL. It does not check active product count or payouts. The server /store/publish has no checks at all.
- **Why it costs money:** An empty live store shared to followers wastes the seller’s one launch moment.
- **Fix:** Additive: add warnings (not errors) in validateStore for "No active products yet" and "Payouts not connected — buyers can’t pay", fed from api.seller.launchChecklist.get().
- **$ impact:** ~$300-600/mo

<a id="bt-233"></a>
### BT-233 · P2 · effort M · Two parallel setup checklists on the dashboard with different steps, order and data sources

- **Where:** dashboard · `artifacts/mobile/lib/setupStore.ts:48-114,artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:963-976,artifacts/mobile/components/LaunchChecklistCard.tsx:24-44,artifacts/api-server/src/lib/launchChecklist.ts:7-16`
- **Problem:** The local setupStore has 9 tasks in AsyncStorage (payments is #2, includes domain and first video). The server launch checklist has 8 steps (payouts is #8, includes socials and accent). Both render on the dashboard (SetupContinueBanner and LaunchChecklistCard) with different percentages and different "Next" items.
- **Why it costs money:** Conflicting guidance makes the next step unclear, and sellers stall.
- **Fix:** Additive: have the setup walkthrough read its done flags from the server launch checklist where they overlap (first_product, payouts, publish), and hide SetupContinueBanner while LaunchChecklistCard is visible.
- **$ impact:** ~$500-1k/mo

<a id="bt-234"></a>
### BT-234 · P2 · effort S · Setup checklist makes "Connect a domain" and "Post your first video" required; it rarely reaches 100%

- **Where:** dashboard / setup · `artifacts/mobile/lib/setupStore.ts:82-88,96-102,316-329,artifacts/mobile/components/SetupCelebration.tsx:57-61`
- **Problem:** connect_domain ("a custom domain you already own") and first_post are not marked optional. isSetupComplete needs completed, not skipped, on every required task, so skipping keeps the banner up forever and SetupCelebration never fires. The celebration also has only a dismiss button, with no share CTA.
- **Why it costs money:** This forces steps that could be deferred and shows a nag banner forever. The celebration moment is wasted without a share loop.
- **Fix:** Mark connect_domain and first_post optional:true, count skipped tasks as done in isSetupComplete, and add a "Share your store" primaryAction to SetupCelebration.
- **$ impact:** ~$200-500/mo

<a id="bt-235"></a>
### BT-235 · P2 · effort S · Products empty state offers only "Add your first product"; import options are hidden in the menu

- **Where:** (tabs)/products · `artifacts/mobile/app/(tabs)/products.tsx:770-797,817-825`
- **Problem:** The empty state has one action (add-product). CSV, Shopify and Etsy import only appear inside the header "…" action sheet. Sellers with an existing catalog don’t discover them at the moment they matter.
- **Why it costs money:** This slows activation for sellers who already have a catalog elsewhere.
- **Fix:** Additive: add a secondaryAction "Import from Shopify/CSV" to the all-filter EmptyState.
- **$ impact:** ~$300-800/mo

<a id="bt-236"></a>
### BT-236 · P2 · effort S · Orders tab empty state has no CTA (no share-store or add-product)

- **Where:** (tabs)/orders · `artifacts/mobile/app/(tabs)/orders.tsx:1123-1127`
- **Problem:** The empty Orders shows "No orders yet. Orders show up here once a buyer checks out." with no action.
- **Why it costs money:** This is a dead end at the exact point the seller should be driving traffic.
- **Fix:** Additive: add actionLabel "Share your store" and onAction router.push("/share-store") (or "Add a product" when there are 0 active products).
- **$ impact:** ~$200-500/mo

<a id="bt-237"></a>
### BT-237 · P2 · effort S · New-order alert is push-only; sellers who skipped notifications miss the first order

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1297-1308,artifacts/mobile/app/onboarding.tsx:2805-2811`
- **Problem:** new_order_received goes through publishNotification (push and in-app feed). No seller email is sent for a new order (brandthreadEmail has no seller order template). Onboarding lets sellers skip the push permission.
- **Why it costs money:** A missed first order means late shipment, buyer cancellation or refund, and a bad first-sale experience.
- **Fix:** Additive: send a seller "You made a sale" email (sendBrandthreadEmail) on new_order_received, at least for the first 10 orders or when push is not granted.
- **$ impact:** ~$300-800/mo of saved first orders

<a id="bt-238"></a>
### BT-238 · P2 · effort S · AI store generator (store-generate/from-logo/from-social) is outside the new-seller path

- **Where:** store-generate / store-from-* · `artifacts/mobile/app/store-editor.tsx:685-687,artifacts/mobile/lib/setupStore.ts:89-95`
- **Problem:** The headline "AI builds your store" flows are reachable only from store-editor’s menu. The setup task customize_store routes to /store-builder, and the launch checklist routes to store-setup-brand. New sellers never see the differentiating feature during setup.
- **Why it costs money:** The differentiator that justifies the subscription stays hidden during the trial window.
- **Fix:** Additive: add a "Let AI design my store" secondary CTA on store-setup-brand that pushes /store-generate.
- **$ impact:** ~$500-1k/mo of trial-to-paid lift

<a id="bt-239"></a>
### BT-239 · P2 · effort S · Onboarding tests lock in "seller success → tabs" with no plan purchase assertion

- **Where:** onboarding tests · `artifacts/mobile/app/onboarding.ux.test.ts:97-100,artifacts/mobile/tests/onboarding-flow-e2e.test.tsx`
- **Problem:** onboarding.ux.test.ts asserts the seller success routes to tabs. No test asserts that a trial or purchase starts at the PLAN step. The e2e test has no "plans", "purchase" or "trial" assertions.
- **Why it costs money:** Regressions in the revenue-critical step will pass CI.
- **Fix:** Add a test asserting the PLAN Continue button navigates to /plans?fromOnboarding=true (or calls the purchase) before finishSeller.
- **$ impact:** guards the subscription funnel

<a id="bt-240"></a>
### BT-240 · P3 · effort S · Invite gate appears only after full Clerk signup and email verification

- **Where:** access-code · `artifacts/mobile/app/_layout.tsx:848-852,962-965,artifacts/mobile/lib/api.ts:1141`
- **Problem:** AuthGate checks api.access.status() only once isSignedIn is true. With the flag on, a seller fills the full auth form and verifies email, then gets bounced to /access-code. The public POST /api/access/validate endpoint exists but nothing in the app calls it, so there is no "have a code?" step before account creation.
- **Why it costs money:** Users who already invested about 11 taps hit a wall, which hurts waitlist conversion when the flag is on.
- **Fix:** Additive: when access status is unavailable pre-auth, show an optional invite-code field on the WELCOME/ACCOUNT_TYPE step that calls api.access.validate(), and stash the code for redeem after signup.
- **$ impact:** only matters if invite-only is enabled

<a id="bt-241"></a>
### BT-241 · P3 · effort S · Waitlist invites are never emailed; admin must copy each code and send it by hand

- **Where:** admin waitlist · `artifacts/api-server/src/routes/admin/access.ts:61-104,docs/launch/invite-only.md:52-54`
- **Problem:** POST /admin/access/waitlist/:id/invite creates the code and returns it to the admin. It sends no email (no sendBrandthreadEmail call), and the runbook says "send it to them".
- **Why it costs money:** With invite-only on, every waitlisted seller needs manual work. Invites go stale and sellers are lost.
- **Fix:** Additive: call sendBrandthreadEmail with the code and an app deep link inside the invite transaction’s success path (idempotency key waitlist-invite/<id>).
- **$ impact:** only matters if invite-only is enabled

<a id="bt-242"></a>
### BT-242 · P3 · effort S · Under-18 sellers fill the whole wizard, then get a generic "check your connection" error

- **Where:** onboarding (SUCCESS) · `artifacts/mobile/app/onboarding.tsx:2389-2457,artifacts/api-server/src/routes/auth.ts:654-658,artifacts/mobile/lib/ageGate.ts:44,125`
- **Problem:** The server returns 403 AGE_RESTRICTED from onboarding/complete for 13-17 sellers. finishSeller’s catch only special-cases username conflicts and shows "We couldn’t save your brand profile. Check your connection" with Retry, which loops forever. bandMaySell and AGE_RESTRICTED_COPY exist, but onboarding never uses them after the DOB is entered.
- **Why it costs money:** This wastes support time. A teen who could be routed to the buyer flow (and buy) is stuck instead.
- **Fix:** Additive: after the auth step records the DOB, check bandMaySell. If false on the seller flow, show AGE_RESTRICTED_COPY with a "Continue as a buyer" button.
- **$ impact:** small; mostly support cost and lost buyer conversions

<a id="bt-243"></a>
### BT-243 · P3 · effort S · Account-type card promises "AI-powered design studio", but AI routes 403 for non-Growth sellers

- **Where:** onboarding (ACCOUNT_TYPE) · `artifacts/mobile/app/account-type.tsx:34-45,artifacts/api-server/src/routes/index.ts:239-244`
- **Problem:** The seller card leads with "AI-powered design studio". /logo, /mockup, /photography, /bg-removal, /lifestyle and /techpack are mounted with requirePlan("growth"). A new seller (Starter fallback, no trial) gets PLAN_REQUIRED on first use.
- **Why it costs money:** Feature-promise mismatch at the first touch hurts trust, but it is also an upsell moment if handled well.
- **Fix:** Additive: add "(Growth plan)" to that bullet, or make sure the Growth trial starts in onboarding so the promise holds during the trial.
- **$ impact:** minor; mostly trust

<a id="bt-244"></a>
### BT-244 · P3 · effort S · Setup checklist progress is device-local; reinstall or new device resets it

- **Where:** dashboard / setup · `artifacts/mobile/lib/setupStore.ts:127-131,215-268`
- **Problem:** Setup state is stored only in AsyncStorage (@brandthread/setup_state:<userId>). Only verify_account and connect_payments re-derive from server data. A seller who switches phones sees "Add your first product" again even with 40 products.
- **Why it costs money:** Inaccurate nudges erode trust and hide the real next step.
- **Fix:** Additive: on getSetupState, merge done flags from api.seller.launchChecklist.get() (first_product, publish, payouts) and from the shipping-rates count.
- **$ impact:** small

<a id="bt-245"></a>
### BT-245 · P3 · effort S · Analytics tab with no data has no next step

- **Where:** (tabs)/analytics · `artifacts/mobile/app/(tabs)/analytics.tsx:182-195`
- **Problem:** Visits and Revenue tiles show 0, and the chart shows "No revenue data yet". There is no CTA to share the store or create a post.
- **Why it costs money:** A missed loop to drive the first traffic.
- **Fix:** Additive: when summary.visits === 0, render a small card with "Share your store" (/share-store) and "Post to the Thread" (/create-post).
- **$ impact:** small

<a id="bt-246"></a>
### BT-246 · P3 · effort S · Guided setup screen (/setup) is orphaned

- **Where:** setup · `artifacts/mobile/app/setup.tsx:1-293,artifacts/mobile/app/navigation-isolation-probe.tsx:8`
- **Problem:** setup.tsx renders a full guided-setup checklist, but the only link to it is the navigation-isolation probe. The dashboard uses SetupWalkthroughSheet instead.
- **Why it costs money:** This is dead code that confuses audits, though it is not user-facing.
- **Fix:** Either link it from SetupContinueBanner "See all" or delete it later. No user impact today.
- **$ impact:** none directly

<a id="bt-247"></a>
### BT-247 · P3 · effort S · Preview/demo fixtures are correctly gated away from real accounts (verified)

- **Where:** dashboard / products / orders · `artifacts/mobile/lib/devPreview.ts:109-126,167-176,artifacts/mobile/lib/buildFlags.ts:31-43,artifacts/mobile/lib/devBypass.ts:8-11,artifacts/mobile/app/(tabs)/products.tsx:467-473`
- **Problem:** isPreviewDemoMode and isSellerDevPreview return false in release native builds (IS_PROD_NATIVE), when !__DEV__ && !NAVIGATION_ISOLATION_TEST, and on production hosts. Demo data needs an explicit &demo=1. No demo seller data leaks into real seller accounts. Residual risk: an exported web build with EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST=1 on a non-production host would show preview data.
- **Why it costs money:** No direct loss. This is listed so the team does not re-audit it.
- **Fix:** Optional: add a CI check that the production web export has EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST unset.
- **$ impact:** none

<a id="bt-248"></a>
### BT-248 · P3 · effort S · No dead routes in funnel screens (verified by script)

- **Where:** n/a · `artifacts/mobile/app/**/*.tsx,artifacts/mobile/components/**/*.tsx`
- **Problem:** A script checked every literal router.push/replace/route/nav target in app/, components/ and lib/ against the expo-router file tree. The only unmatched target was a template-built /u/<handle>, which resolves to app/u/. Button-level dead ends are listed in the other findings.
- **Why it costs money:** None.
- **Fix:** None.
- **$ impact:** none

## Buyer funnel: install → repeat purchase

52 findings: 5 P0 · 18 P1 · 21 P2 · 8 P3

<a id="bt-249"></a>
### BT-249 · P0 · effort S · Guest checkout unreachable: cart and Shop-sheet push /thread-checkout, which is not a guest route

- **Where:** (buyer)/cart, ShopProductSheet · `artifacts/mobile/lib/guestRoutes.ts:13-37,artifacts/mobile/app/(buyer)/cart.tsx:984,artifacts/mobile/components/ShopProductSheet.tsx:847,artifacts/mobile/app/_layout.tsx:955-958`
- **Problem:** GUEST_TOP_LEVEL allows 'buyer-checkout' but not its alias 'thread-checkout'. The cart's startCheckout always pushes /thread-checkout?source=cart, and Shop sheet Buy now pushes /thread-checkout. AuthGate then sees a signed-out user on a protected route and router.replace()s to /sign-in with no returnTo, so the cart context is lost.
- **Why it costs money:** Guest checkout (routes/guest-checkout.ts) is built but no signed-out buyer can reach it from the two main buy paths. Every guest impulse purchase turns into a forced signup.
- **Fix:** Add 'thread-checkout' (and 'thread-product-detail', see next finding) to GUEST_TOP_LEVEL in lib/guestRoutes.ts. This is a one-line additive change. Add a test asserting every alias re-export of a guest route is itself guest-allowed.
- **$ impact:** ~$5-10k/mo: guests are typically 20-40% of first-time mobile commerce buyers, and at the $50k target this path is fully blocked

<a id="bt-250"></a>
### BT-250 · P0 · effort S · Guests tapping any product in feed/search/discover/category are bounced to sign-in

- **Where:** thread-product-detail · `artifacts/mobile/lib/guestRoutes.ts:16-37,artifacts/mobile/components/discover/DiscoveryProductGrid.tsx:50,artifacts/mobile/components/discover/EditorialTile.tsx:50,artifacts/mobile/app/buyer-search.tsx:320,artifacts/mobile/components/ShopProductSheet.tsx:859`
- **Problem:** thread-product-detail.tsx re-exports buyer-product-detail, but only 'buyer-product-detail' is in the guest allow-list. Discover tiles, search results, category/trending grids, Shop sheet 'View details', saved items and recently viewed all push /thread-product-detail, so a guest gets replaced to /sign-in.
- **Why it costs money:** 'Browse as a guest' (WelcomeStep, sign-in) leads to Discover, where the first product tap hits a sign-in wall. That is the forced-signup-before-browsing pattern the guest mode was built to avoid, and it is a Guideline 5.1.1(v) rejection risk.
- **Fix:** Add 'thread-product-detail' to GUEST_TOP_LEVEL. Also add a CI test that walks every push('/x') target in buyer components and asserts it is either guest-allowed or protected by requireSignIn.
- **$ impact:** blocks all guest browsing-to-PDP; plausibly $3-8k/mo plus App Review rejection risk

<a id="bt-251"></a>
### BT-251 · P0 · effort M · Hosted checkout returns to unregistered 'mobile://' scheme via openBrowserAsync

- **Where:** buyer-checkout (hosted path) · `artifacts/mobile/lib/api.ts:1780-1781,artifacts/mobile/lib/api.ts:1891-1892,artifacts/mobile/app.json:8,artifacts/mobile/app/buyer-checkout.tsx:762-767`
- **Problem:** successUrl and cancelUrl are 'mobile://checkout/return…', but the app scheme is 'brandthread'. The flow uses WebBrowser.openBrowserAsync, not openAuthSessionAsync, so the redirect never closes the browser. The buyer must tap Done, which returns type 'cancel', and the code shows 'Payment cancelled' and returns before verifySession runs. In a multi-seller loop, the remaining sellers are never processed. The hosted path is used for every guest, every pre-order/drop, every Thread Cash or loyalty order, and whenever EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing.
- **Why it costs money:** Buyers who paid are told they cancelled. That drives duplicate attempts, support tickets and chargebacks, and multi-store hosted carts only pay the first seller. Drops and pre-orders are a core format and always take this path.
- **Fix:** Use WebBrowser.openAuthSessionAsync(url, 'brandthread://checkout/return') (or Linking.createURL) and set success/cancel URLs to the brandthread:// scheme or an https universal link. Treat 'cancel' as 'verify first, then decide'.
- **$ impact:** blocks all guest + pre-order + Thread Cash revenue; likely 30-50% of GMV at launch

<a id="bt-252"></a>
### BT-252 · P0 · effort S · PDP: one-size / no-option products can never be added to cart or bought

- **Where:** buyer-product-detail / thread-product-detail · `artifacts/mobile/app/buyer-product-detail.tsx:789,artifacts/mobile/app/buyer-product-detail.tsx:843-849,artifacts/mobile/app/buyer-product-detail.tsx:923-926,artifacts/mobile/app/buyer-product-detail.tsx:1466-1470`
- **Problem:** allSelected = product.options.length > 0 && …, so a product whose variants have no size and no color (accessories, bags, one-size, and every CSV/bulk-imported product, whose default variant has no size/color: api-server routes/products.ts:643-650) is never 'allSelected'. Add to cart silently returns, and Buy now shows 'Select options' with no options rendered. ShopProductSheet handles this case correctly (ShopProductSheet.tsx:672-674).
- **Why it costs money:** A whole class of listings is unbuyable from the full product page, which is where search, category, saved and recently-viewed traffic lands.
- **Fix:** Change to allSelected = product.options.length === 0 || Object.keys(selections).length === product.options.length, and auto-select when there is exactly one variant (mirroring ShopProductSheet.tsx:611-623).
- **$ impact:** blocks all sales of no-option products from PDP; easily $1-3k/mo

<a id="bt-253"></a>
### BT-253 · P0 · effort S · Shared product link opens the SELLER's admin screen, not the buyer PDP

- **Where:** store/product/[productId] → product-detail · `artifacts/mobile/app/store/product/[productId].tsx:16-21,artifacts/mobile/app/product-detail.tsx:1-5,artifacts/mobile/app/product-detail.tsx:240-243,artifacts/mobile/services/productService.ts:245-248`
- **Problem:** The canonical product share URL https://brandthread.app/store/product/{id} router.replace()s to /product-detail?id=, which is the seller's 8-tab management screen. It reads getProduct() from the seller's own local product list, so for any recipient it is not found. product-detail is also not guest-allowed, so a signed-out recipient is bounced to sign-in.
- **Why it costs money:** A seller sharing a product to IG/TikTok/SMS is the #1 acquisition path for an indie-brand marketplace, and every such tap dead-ends.
- **Fix:** Redirect to /buyer-product-detail?productId=… (or /thread-product-detail). Keep /product-detail for the seller's own products only, by checking ownership before redirecting.
- **$ impact:** blocks share-driven sales; ~$3-8k/mo at target

<a id="bt-254"></a>
### BT-254 · P1 · effort S · Category and Trending 'see all' pages are not guest-allowed

- **Where:** buyer-category, buyer-trending · `artifacts/mobile/lib/guestRoutes.ts:16-37,artifacts/mobile/components/discover/DiscoverShopRails.tsx:35,artifacts/mobile/app/(buyer)/discover.tsx:320-321`
- **Problem:** Discover's 'Shop by category' chips push /buyer-category, and 'See all' trending pushes /buyer-trending. Neither is in GUEST_TOP_LEVEL, and both only read public endpoints (api.publicDiscovery.*), so guests get bounced to sign-in.
- **Why it costs money:** These are the highest-intent browse taps on Discover, and guests lose them.
- **Fix:** Add 'buyer-category' and 'buyer-trending' to GUEST_TOP_LEVEL. Both screens already use public APIs only.
- **$ impact:** ~$1-2k/mo of guest browse sessions that currently dead-end

<a id="bt-255"></a>
### BT-255 · P1 · effort M · Guest hosted checkout drops discount codes (doc claims fixed)

- **Where:** buyer-checkout (guest) · `artifacts/mobile/app/buyer-checkout.tsx:733-752,artifacts/api-server/src/routes/guest-checkout.ts:106,docs/payments/multi-store-cart.md:38-39`
- **Problem:** The signed-in hosted branch passes discountCode per group. The guest branch (api.guest.checkout.createSession) passes no discountCode, and routes/guest-checkout.ts does not read one. docs/payments/multi-store-cart.md says 'The hosted Stripe fallback loop … now passes each group its own code', which is true only for signed-in buyers.
- **Why it costs money:** Influencer and creator codes are the main traffic driver for indie brands. A guest who arrives from an IG code and sees no discount applied abandons the purchase or files a dispute.
- **Fix:** Accept discountCode in POST /api/guest/checkout/session (reuse priceCartGroup/discount validation) and pass it from the guest branch.
- **$ impact:** ~$1-3k/mo of code-driven guest orders

<a id="bt-256"></a>
### BT-256 · P1 · effort M · Guest hosted checkout makes the buyer re-enter address and card on the Stripe page

- **Where:** buyer-checkout (guest) · `artifacts/api-server/src/routes/guest-checkout.ts:299-306,artifacts/mobile/app/buyer-checkout.tsx:736-751`
- **Problem:** The app collects contact (email AND phone required) plus full address, then opens Stripe Checkout with shipping_address_collection enabled and no prefilled shipping. The guest types the address a second time, then the card, in a separate browser. Per seller.
- **Why it costs money:** Double data entry is one of the top causes of mobile checkout abandonment, and guests are the least committed buyers.
- **Fix:** Drop shipping_address_collection on the guest session (the address is already validated server-side and stored on checkoutSessions) or prefill it via customer + payment_intent_data.shipping. Better still, route guests through the in-app PaymentIntent path (checkout-intent.ts) with Apple Pay.
- **$ impact:** ~$1-2k/mo guest conversion lift

<a id="bt-257"></a>
### BT-257 · P1 · effort L · Guests never get native Apple Pay / Google Pay sheet

- **Where:** buyer-checkout · `artifacts/mobile/lib/checkoutPayment.ts:44-53,artifacts/mobile/components/checkout/StripePayment.tsx:200-300`
- **Problem:** choosePaymentPath returns 'hosted' for !signedIn, so the in-app ExpressPay (PlatformPayButton with live shipping/tax re-pricing) is only offered to signed-in buyers. Guests, the users who most need one-tap pay, get a web redirect.
- **Why it costs money:** Apple Pay usually lifts mobile conversion significantly. Withholding it from guests wastes the guest-checkout investment.
- **Fix:** Let the PaymentIntent route (routes/checkout-intent.ts) accept a guest email + guestAccessToken like guest-checkout.ts does, and allow in_app for guests in choosePaymentPath.
- **$ impact:** ~$2-4k/mo

<a id="bt-258"></a>
### BT-258 · P1 · effort L · Pre-orders, Thread Cash and loyalty force the per-seller hosted loop

- **Where:** buyer-checkout · `artifacts/mobile/lib/checkoutPayment.ts:44-53,artifacts/mobile/app/buyer-checkout.tsx:22-31`
- **Problem:** hasPreOrder, threadCashApplied and loyaltyApplied each force path 'hosted' (separate Stripe Checkout per seller, browser redirect, no Apple Pay sheet), and this inherits the broken return URL above.
- **Why it costs money:** Drops/pre-orders are the brand-launch format, and Thread Cash is the retention hook. Both are pushed onto the worst-converting payment path.
- **Fix:** Extend checkout-intent.ts to support held (transfer) charge plans and the Thread Cash/loyalty tokens, then remove those clauses from choosePaymentPath.
- **$ impact:** ~$2-5k/mo across drops + Thread Cash orders

<a id="bt-259"></a>
### BT-259 · P1 · effort S · Imported products get a default variant with stock 0 (born sold out)

- **Where:** server · `artifacts/api-server/src/routes/products.ts:642-651`
- **Problem:** Bulk/CSV import inserts one default variant with stock: 0 and no size/color, so every imported product shows Sold Out (PDP inStock false) and hits the no-option bug above.
- **Why it costs money:** Sellers onboarding via import (the fastest catalog path) launch with an entirely unbuyable catalog and do not know why.
- **Fix:** Import the row's stock/quantity column (or default to a seller-set quantity), and show a post-import 'set inventory' prompt.
- **$ impact:** seller catalog dead-on-arrival; indirect but large

<a id="bt-260"></a>
### BT-260 · P1 · effort S · No Share button on the buyer product page

- **Where:** buyer-product-detail · `artifacts/mobile/app/buyer-product-detail.tsx:966-1460; artifacts/mobile/app/buyer-product-detail.tsx (grep 'Share' returns no share action),artifacts/mobile/lib/shareLinks.ts:41-43`
- **Problem:** grep for 'Share' in buyer-product-detail.tsx finds nothing. Buyers cannot send a product to a friend; the only product share link in the app is the seller-side one (product-detail.tsx:241).
- **Why it costs money:** Word-of-mouth shares are free acquisition, and 'send to a friend for opinion' is a standard fashion purchase step. Cross-ref growth-loops.
- **Fix:** Add a share icon in the PDP header that shares https://brandthread.app/store/product/{id} (after fixing the redirect), with referral code appended for signed-in buyers.
- **$ impact:** ~$1-2k/mo

<a id="bt-261"></a>
### BT-261 · P1 · effort S · PDP returns/cancellation policy is hardcoded, not the seller's actual policy

- **Where:** buyer-product-detail · `artifacts/mobile/app/buyer-product-detail.tsx:165-166,artifacts/mobile/app/buyer-product-detail.tsx:1291-1294,lib/db/src/schema/index.ts:108-109`
- **Problem:** adaptApiProductToBuyerProduct hardcodes cancellationPolicy 'All sales final. Returns accepted only for damaged or incorrect items.' and refundPolicy 'Contact the seller within 7 days…' for every product, although users.return_policy / cancellation_policy exist and sellers edit them in store-policies/refund-policy screens.
- **Why it costs money:** 'All sales final' on every listing suppresses conversion for sellers who offer returns. For sellers who don't, it misstates their terms. Both cases create disputes.
- **Fix:** Return the seller's returnPolicy/cancellationPolicy from GET /api/public/products/:id (public.ts:483) and render them, falling back to a neutral 'See seller's policy' link.
- **$ impact:** ~$1-2k/mo conversion + dispute reduction

<a id="bt-262"></a>
### BT-262 · P1 · effort S · Shop sheet shows placeholder 'Ships in 2-3 days' and 'Easy returns' / 'Fast shipping' to every buyer

- **Where:** ShopProductSheet · `artifacts/mobile/components/ShopProductSheet.tsx:161-162,artifacts/mobile/components/ShopProductSheet.tsx:1182-1186,artifacts/mobile/components/ShopProductSheet.tsx:1244-1248`
- **Problem:** SHIPPING_ESTIMATE_COPY is marked '// PLACEHOLDER' and shown on all products. The trust row hardcodes 'Easy returns' and 'Fast shipping', while the PDP for the same product says 'All sales final'. DEFAULT_RETURNS_COPY 'Free returns within 14 days' is shown when refundPolicy is empty.
- **Why it costs money:** Fabricated shipping/returns promises create chargebacks (item 'not as described') and FTC/consumer-protection exposure. Pre-orders show 'Ships in 2-3 days' too.
- **Fix:** Additive: replace the constants with the seller's shipping-zone processingDays (shippingZones.processingDays) and the seller's returnPolicy from the product API, and hide the trust cues the seller hasn't earned.
- **$ impact:** dispute/chargeback exposure; ~$500-1.5k/mo

<a id="bt-263"></a>
### BT-263 · P1 · effort M · No shipping cost or estimated delivery date anywhere before checkout

- **Where:** buyer-product-detail, ShopProductSheet, cart · `artifacts/mobile/app/buyer-product-detail.tsx:1053-1060,artifacts/mobile/app/(buyer)/cart.tsx:745,artifacts/mobile/app/(buyer)/cart.tsx:603-610,artifacts/mobile/services/cartService.ts:554-557`
- **Problem:** The PDP has no shipping line. The cart computes calculateCartSummary(cart.items) with shippingTotalCents defaulting to 0, so it displays 'Shipping & fees $0.00' and 'Est. tax $0.00' with a footnote. The real shipping first appears on the checkout screen.
- **Why it costs money:** Unexpected shipping cost is the #1 cited reason for cart abandonment. Showing $0.00 and then a higher number is worse than showing nothing.
- **Fix:** Additive: fetch fetchShippingRateDetails per seller group in the cart (already used by createCheckoutSession) and render 'Shipping from {seller}: $X / Free over $Y'. On the PDP, show a 'Shipping $X · Free over $Y · Arrives by {date}' line from the seller's zone.
- **$ impact:** ~$2-4k/mo

<a id="bt-264"></a>
### BT-264 · P1 · effort S · Delivery guarantee (15-day / 60-day auto-refund) is never shown before purchase

- **Where:** buyer-product-detail, buyer-checkout · `docs/payments/delivery-guarantee.md:1-12,artifacts/mobile/components/orders/DeliveryTracker.tsx:93,artifacts/mobile/components/BuyerProtectionNote.tsx:1-80`
- **Problem:** The guarantee line (guaranteeLine) only renders in DeliveryTrackerCard on buyer-order-detail, after payment. grep 'guarantee' finds nothing in buyer-product-detail, ShopProductSheet or components/checkout. BuyerProtectionNote quotes generic Terms text only.
- **Why it costs money:** 'Delivered in 15 days or automatic refund' is a strong trust signal for unknown indie brands, and it is unused at the moment of decision.
- **Fix:** Add one line to BuyerProtectionNote and the checkout order summary: 'Delivered by {paid+15d} or automatic refund' ('60 days' for pre-orders).
- **$ impact:** ~$1-2k/mo conversion lift on unknown-brand trust

<a id="bt-265"></a>
### BT-265 · P1 · effort M · No post-delivery review request (push or email)

- **Where:** server · `artifacts/api-server/src/routes/orders.ts:570-571,artifacts/api-server/src/jobs (no review job)`
- **Problem:** grep for review_request / 'leave a review' / 'how was your' across routes, lib and jobs finds nothing. The 'delivered' push says only 'Your order was delivered!'. The review form exists only inside buyer-order-detail behind status=delivered.
- **Why it costs money:** Without solicitation most products will have 0 reviews at launch, and new buyers see no social proof.
- **Fix:** Add a job: N days after deliveredAt with no review, publishNotification type 'review_request' deep-linking to buyer-order-detail?id=…&review=1, plus an email.
- **$ impact:** ~$1-2k/mo via social proof on repeat traffic

<a id="bt-266"></a>
### BT-266 · P1 · effort M · Home 'For You' is chronological; the built ranking engine is never called

- **Where:** (buyer)/index → (tabs)/feed · `artifacts/mobile/services/socialService.ts:1906-1913,artifacts/mobile/services/socialService.ts:1988-1994,artifacts/api-server/src/routes/public.ts:1685-1729,artifacts/api-server/src/routes/feed.ts:116`
- **Problem:** getThreadPostsPage('for-you') reads /api/public/posts ordered by createdAt desc. GET /api/feed/for-you (lib/ranking/forYou.ts, using style interests, not_interested, purchases) exists, and the client wrapper getForYouFeedPage exists, but no screen calls it (grep finds only its definition).
- **Why it costs money:** Onboarding collects style interests and brand likes, and the home feed ignores them. Relevance drives shop-clicks per session.
- **Fix:** Additively, for signed-in buyers, use getForYouFeedPage as the first source in getThreadPostsPage 'for-you' mode, falling back to /public/posts.
- **$ impact:** ~$2-4k/mo from higher shop-click rate

<a id="bt-267"></a>
### BT-267 · P1 · effort S · Empty Home For You is a dead end ('No posts yet / Check back soon') with no CTA

- **Where:** (buyer)/index · `artifacts/mobile/app/(tabs)/feed.tsx:3107-3116`
- **Problem:** When there are no seller posts (likely at launch with few sellers, since preview content is __DEV__-only: feed.tsx:2456), the For You empty state shows 'Check back soon for new drops' with no button. Only the Following tab gets a 'Find friends' CTA.
- **Why it costs money:** A new buyer whose first screen is empty churns immediately. Dev builds always look full, which hides this.
- **Fix:** Add a 'Shop products' CTA to /(buyer)/discover and a 'Trending products' rail (api.publicDiscovery.trendingProducts) inside the empty state.
- **$ impact:** ~$1-2k/mo day-1 retention

<a id="bt-268"></a>
### BT-268 · P1 · effort S · Onboarding notifications 'Continue' does not request push permission

- **Where:** onboarding (buyer) · `artifacts/mobile/app/onboarding.tsx:2633-2636,artifacts/mobile/app/onboarding.tsx:464-523,artifacts/mobile/lib/contextualPushPermission.ts:52-75`
- **Problem:** The 'Never miss what matters' soft-ask has Continue and Not now, but onEnable just calls transitionTo(SUCCESS). No OS prompt is ever shown. The first real prompt waits for a first order/follow/friend action.
- **Why it costs money:** A buyer who said yes gets no pushes. Abandoned-cart pushes (1h), price-drop, back-in-stock and drop alerts all depend on a token, so the re-engagement stack goes silent for most new buyers.
- **Fix:** On Continue, call Notifications.requestPermissionsAsync() (the user opted in on the soft-ask), then register the token after onboarding completes. Keep Not now silent.
- **$ impact:** ~$2-3k/mo of push-driven recovery and repeat sales

<a id="bt-269"></a>
### BT-269 · P1 · effort S · Add-to-cart is not a push-permission trigger, so abandoned-cart pushes miss first-time buyers

- **Where:** buyer-product-detail, ShopProductSheet · `artifacts/api-server/src/jobs/abandonedCartRecovery.ts:65-80,artifacts/mobile/components/checkout/OrderConfirmation.tsx:184,artifacts/mobile/lib/contextualPushPermission.ts:52`
- **Problem:** requestContextualPushPermission fires after order, follow and friend events, but not after add-to-cart. A first-time buyer who adds to bag and leaves has no push token, so the 1-hour abandoned-cart push goes to nobody and only the 24h email remains.
- **Why it costs money:** Cart-recovery push is one of the highest-ROI messages, and it is lost for exactly the buyers who haven't converted yet.
- **Fix:** Call requestContextualPushPermission(userId, api) after a successful addToCart for signed-in onboarded buyers (it is already rate-limited to once per user).
- **$ impact:** ~$1-2k/mo recovered carts

<a id="bt-270"></a>
### BT-270 · P1 · effort M · Thread Cash at checkout is flag-off, and when on it forces hosted checkout and a single store

- **Where:** cart, buyer-checkout (cross-ref thread-cash) · `artifacts/mobile/contexts/FeatureFlagContext.tsx:36,artifacts/mobile/app/buyer-checkout.tsx:341-347,artifacts/mobile/app/(buyer)/cart.tsx:946-953,artifacts/mobile/lib/checkoutPayment.ts:49,docs/payments/thread-cash-checkout-todo.md:1-15; artifacts/api-server/src/lib/money/cartCheckout.ts:17`
- **Problem:** threadCashCheckoutDiscount defaults false, so buyers earn daily Thread Cash (ThreadCashActiveTimeTracker in (buyer)/_layout.tsx:162) but cannot spend it. When enabled it is single-store only ('Rewards need one store') and routes to the hosted path with the mobile:// return bug.
- **Why it costs money:** An earn-only currency with no spend path frustrates buyers, and the 'checkout credit' promise in the business model is not delivered at launch.
- **Fix:** Complete the sign-off and flip the flag after fixing hosted return. Medium term, support Thread Cash on the in-app PaymentIntent path and split across stores.
- **$ impact:** retention lever; ~$1-3k/mo repeat purchases

<a id="bt-271"></a>
### BT-271 · P1 · effort S · Apple Pay depends on an unverified prod env key and merchant setup

- **Where:** buyer-checkout · `artifacts/mobile/components/checkout/stripePaymentTypes.ts:10-14,artifacts/mobile/components/checkout/StripePayment.tsx:43-61,artifacts/mobile/app.json:439-445,artifacts/mobile/eas.json:34-45`
- **Problem:** The plugin config is correct (merchant.com.brandthread.mobile, enableGooglePay). But stripePaymentAvailable() silently returns false when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing, and eas.json production sets no env (it relies on the EAS 'production' environment). If the key or the Apple merchant ID/Stripe Apple Pay cert (new LLC Stripe account) is missing, every signed-in buyer silently falls to hosted checkout with the broken return.
- **Why it costs money:** A silent fallback converts the best payment path into the worst one with no error.
- **Fix:** Add a launch check: production build logs/Sentry-alerts when stripePaymentAvailable() is false, and confirm the merchant ID and Apple Pay certificate on the new Stripe account (docs/launch/dev-only-tasks.md).
- **$ impact:** guards all in-app card revenue

<a id="bt-272"></a>
### BT-272 · P2 · effort S · Seller verified badge dropped on PDP although API returns it

- **Where:** buyer-product-detail · `artifacts/api-server/src/routes/public.ts:483,artifacts/mobile/app/buyer-product-detail.tsx:151-178,artifacts/mobile/app/buyer-product-detail.tsx:1256-1265`
- **Problem:** GET /public/products/:id returns sellerVerified, but adaptApiProductToBuyerProduct never copies it, and the seller card renders only name/initials. ShopProductSheet does show it (ShopProductSheet.tsx:1545,1615). sellerHandle is also hardcoded ''.
- **Why it costs money:** Identity-verified seller is a key trust cue for small brands, and it is missing on the page with the highest purchase intent.
- **Fix:** Map row.sellerVerified into BuyerProduct and render the existing verified badge next to sellerName.
- **$ impact:** ~$300-800/mo

<a id="bt-273"></a>
### BT-273 · P2 · effort S · No star rating / review count near the price; renderStars helper unused

- **Where:** buyer-product-detail, product grids · `artifacts/mobile/app/buyer-product-detail.tsx:185-188,artifacts/mobile/components/ProductReviewsSection.tsx:168,artifacts/api-server/src/routes/public.ts:483-491`
- **Problem:** renderStars() is defined but never called. Reviews render only at the bottom via ProductReviewsSection (hidden when 0). The public product payload has no avgRating/reviewCount, so grids and cards can't show stars either.
- **Why it costs money:** Above-the-fold ratings are one of the strongest PDP conversion levers, and buyers won't scroll past description/video to find them.
- **Fix:** Add avgRating/reviewCount to GET /public/products/:id and list endpoints, and render '★ 4.6 (128)' under the price (tap scrolls to reviews).
- **$ impact:** ~$500-1k/mo

<a id="bt-274"></a>
### BT-274 · P2 · effort S · Size chart missing from Shop sheet (main buy surface)

- **Where:** ShopProductSheet · `artifacts/mobile/components/ShopProductSheet.tsx (no sizeChart reference),artifacts/mobile/app/buyer-product-detail.tsx:1167,artifacts/mobile/app/buyer-product-detail.tsx:1238-1253`
- **Problem:** The PDP renders the size chart table/image, but ShopProductSheet (the in-feed Shop sheet, where most Buy now taps happen) never references sizeChart or sizeChartImageUrl.
- **Why it costs money:** Size uncertainty is the top reason for apparel returns and abandonment, and buyers must leave the sheet to find it.
- **Fix:** Add a 'Size guide' link next to the size chips in the sheet that opens the existing SizeChartViewer / image modal.
- **$ impact:** ~$500-1k/mo + fewer returns

<a id="bt-275"></a>
### BT-275 · P2 · effort S · Dev builds hide cold-start emptiness: all preview content is __DEV__-gated

- **Where:** feed, discover, search · `artifacts/mobile/lib/previewCatalog.ts:21-26,artifacts/mobile/app/(tabs)/feed.tsx:2456-2458,artifacts/mobile/lib/discoverFeed.ts:186-190`
- **Problem:** FASHION_PREVIEW_POSTS, preview catalog and preview discover posts fill the UI whenever __DEV__ and the API returns little. In production none of this renders, which is correct, but every QA/demo run sees a full app.
- **Why it costs money:** The launch-day buyer experience (sparse catalog) is untested, and empty rails/feeds will ship unnoticed.
- **Fix:** Before launch, run a production-mode build against a near-empty staging DB and review every buyer surface. Also add a seller-seeding plan (minimum N live products) as a launch gate.
- **$ impact:** risk control; prevents dead-app first impression

<a id="bt-276"></a>
### BT-276 · P2 · effort M · No abandoned-checkout recovery for guests

- **Where:** server · `artifacts/api-server/src/routes/cart-db.ts:16,artifacts/api-server/src/routes/webhooks.ts:320-330,artifacts/api-server/src/routes/guest-checkout.ts:299-310`
- **Problem:** The cart server sync requires auth, so guest carts live only in AsyncStorage and are never recoverable. Guest Stripe sessions capture email, but checkout.session.expired only releases loyalty, and after_expiration.recovery / a follow-up email is not used.
- **Why it costs money:** Guests who typed their email and then bailed are the cheapest recoverable revenue.
- **Fix:** Set after_expiration.recovery on guest sessions and, on checkout.session.expired with guest metadata, send a 'complete your order' email with the recovery URL.
- **$ impact:** ~$500-1.5k/mo

<a id="bt-277"></a>
### BT-277 · P2 · effort S · Cart summary shows 'Shipping & fees $0.00' and 'Est. tax $0.00'

- **Where:** (buyer)/cart · `artifacts/mobile/app/(buyer)/cart.tsx:603-610,artifacts/mobile/app/(buyer)/cart.tsx:745,artifacts/mobile/services/cartService.ts:556`
- **Problem:** SummaryCard always receives shipping 0 and tax 0 (tax hardcoded 0 in calculateCartSummary), so the cart total equals the subtotal and the checkout total is higher.
- **Why it costs money:** A price jump between cart and pay screen breaks trust and causes drop-off.
- **Fix:** Show 'Calculated at checkout' text instead of $0.00 when unknown, and show real per-seller shipping once fetched (see shipping finding).
- **$ impact:** ~$300-800/mo

<a id="bt-278"></a>
### BT-278 · P2 · effort M · Klarna/Afterpay hidden on iOS/Android; on web only shown to buyers with saved cards

- **Where:** buyer-checkout · `artifacts/mobile/app/buyer-checkout.tsx:1070,artifacts/mobile/components/checkout/PaymentSection.tsx:213-243`
- **Problem:** bnplAvailable = Platform.OS === 'web' && …, and the BNPL row renders only when savedCards.length > 0, so first-time buyers (no saved cards) never see it even on web. Native apps never offer BNPL.
- **Why it costs money:** BNPL lifts AOV and conversion on $100-500 fashion items, the price band in the catalog.
- **Fix:** Show the BNPL row whenever the quote offers it (not gated on saved cards). Add Klarna/Afterpay via the Stripe RN SDK confirmPayment with the matching paymentMethodType on native.
- **$ impact:** ~$1-2k/mo AOV lift

<a id="bt-279"></a>
### BT-279 · P2 · effort S · Address autocomplete is auth-only and env-gated, so guests get none

- **Where:** buyer-checkout ShippingSection · `artifacts/api-server/src/routes/buyer.ts:55,artifacts/api-server/src/routes/buyer.ts:163-171,artifacts/mobile/components/AddressAutocompleteInput.tsx:100`
- **Problem:** /api/buyer/address-suggestions sits behind router.use(requireAuth) and returns 503 without GOOGLE_MAPS_API_KEY, so guests (the users without saved addresses) type every field manually.
- **Why it costs money:** Manual address entry on mobile is slow and error-prone, which means abandonment and mis-deliveries (auto-refund cost).
- **Fix:** Expose a rate-limited public variant (e.g. /api/guest/address-suggestions) and confirm GOOGLE_MAPS_API_KEY is set in production env.
- **$ impact:** ~$300-700/mo

<a id="bt-280"></a>
### BT-280 · P2 · effort S · Google Pay sheet total is pre-shipping/pre-tax estimate

- **Where:** buyer-checkout ExpressPay · `artifacts/mobile/components/checkout/StripePayment.tsx:268-283`
- **Problem:** googlePay.amount is amountCents before any address quote (only Apple Pay re-prices via onShippingContactSelected). The intent is then created for the quoted total, so the amount the buyer approved differs from the charge.
- **Why it costs money:** Mismatched amounts produce 'I was overcharged' disputes on Android and can violate Google Pay display rules.
- **Fix:** Quote first from the default/saved address before opening Google Pay, or label the amount as an estimate and re-confirm.
- **$ impact:** dispute risk; ~$200-500/mo

<a id="bt-281"></a>
### BT-281 · P2 · effort M · Guest 'Track order' and 'View receipt' bounce to sign-in

- **Where:** OrderConfirmation → buyer-order-detail · `artifacts/mobile/components/checkout/OrderConfirmation.tsx:216-220,artifacts/mobile/components/checkout/OrderConfirmation.tsx:428-434,artifacts/mobile/lib/guestRoutes.ts:16-37`
- **Problem:** After a guest pays, the pinned 'Track order' button pushes /buyer-order-detail, which is not guest-allowed (it uses authenticated buyer endpoints), so the guest's first post-purchase tap lands on a sign-in wall.
- **Why it costs money:** A confusing post-purchase moment produces 'where is my order' tickets and disputes, and the guest never builds a relationship with the app.
- **Fix:** For guests, render the confirmation's own order summary and an 'Email me tracking' line, or add a token-authenticated guest order view (the guestAccessToken already exists).
- **$ impact:** ~$200-600/mo support/dispute cost

<a id="bt-282"></a>
### BT-282 · P2 · effort M · Guest orders not linked to the account created afterwards

- **Where:** OrderConfirmation, auth · `artifacts/mobile/components/checkout/OrderConfirmation.tsx:388-397,artifacts/api-server/src/routes/orders.ts:346-352`
- **Problem:** 'Create an account to track orders faster' goes to /sign-in, but no server code claims orders by orders.guest_email on signup (grep guestEmail shows only admin/email usage). The new account shows no orders, no review eligibility and no Thread Cash/referral credit.
- **Why it costs money:** The best guest-to-account conversion moment yields an empty account, and repeat-purchase loops (Buy again, reviews) never start.
- **Fix:** On first sign-in with a verified email, attach orders where buyer_id IS NULL AND guest_email = email. Route the CTA to onboarding with returnTo.
- **$ impact:** ~$500-1k/mo repeat purchases

<a id="bt-283"></a>
### BT-283 · P2 · effort S · Sign-in wall from AuthGate drops returnTo; 'Create an account' drops it too

- **Where:** AuthGate, sign-in · `artifacts/mobile/app/_layout.tsx:955-958,artifacts/mobile/app/sign-in.tsx:804-808,artifacts/mobile/hooks/useSignInGate.ts:27-33`
- **Problem:** useSignInGate passes returnTo, but the AuthGate route-level redirect (router.replace('/sign-in')) does not. On sign-in, 'Create an account' replaces to /onboarding without carrying returnTo, so a guest who signs up from an action lands on the explainer and then Home, not the product.
- **Why it costs money:** Intent is lost at the exact moment the user commits to an account.
- **Fix:** Pass returnTo=current path in the AuthGate redirect and forward it through onboarding (store in AsyncStorage and consume after thread-explainer).
- **$ impact:** ~$500-1k/mo

<a id="bt-284"></a>
### BT-284 · P2 · effort M · Cold open to paid order takes about 17 taps plus ~6s of forced animation for a new buyer

- **Where:** splash → onboarding → thread-explainer → feed → sheet → checkout · `artifacts/mobile/app/splash.tsx:22-37,artifacts/mobile/lib/onboardingFlow.ts:51-62,artifacts/mobile/app/onboarding.tsx:363,artifacts/mobile/app/thread-explainer.tsx:121-127`
- **Problem:** Path: splash (2.5s auto) → Welcome 'Get started' (1) → account type (2-3) → Apple sign-in (4-5) → name (6) → style (7) → sizes (8) → brands (9) → loading (~3.2s auto) → notifications (10) → success (11) → thread-explainer (12) → Home → Shop on post (13) → size (14) → Buy now (15) → Apple Pay (16) → confirm (17). The guest path is 1 tap (the 'Browse as a guest' ghost button) to Discover, but then hits the walls above.
- **Why it costs money:** Each extra pre-value step loses a share of installs. Style, sizes, brands, notifications, success and explainer are 6 screens before any product.
- **Fix:** Additive: show 'Browse as a guest' as a secondary (not ghost) button, make Sizes and Notifications skippable in one tap, and merge Success with thread-explainer. Do not change existing screen styles.
- **$ impact:** ~$1-2k/mo from install→first-session retention

<a id="bt-285"></a>
### BT-285 · P2 · effort S · Search 'no results' state has no product fallback

- **Where:** buyer-search · `artifacts/mobile/app/buyer-search.tsx:466-476`
- **Problem:** No-results shows 'Try a different spelling' plus 'Clear search' only. No trending products, categories or 'request this' CTA (fuzzy pg_trgm search exists server-side: api-server/src/routes/public.ts:543-585).
- **Why it costs money:** Zero-result searches are high-intent sessions that end with nothing to buy.
- **Fix:** Add a 'Trending now' DiscoveryProductGrid (api.publicDiscovery.trendingProducts) under the empty state, and log zero-result queries for sellers/waitlist-demand.
- **$ impact:** ~$300-800/mo

<a id="bt-286"></a>
### BT-286 · P2 · effort S · Guest Profile and Inbox tabs hard-redirect to sign-in instead of an inline prompt

- **Where:** (buyer)/_layout tab bar · `artifacts/mobile/lib/guestRoutes.ts:13,artifacts/mobile/app/(buyer)/_layout.tsx:142-146,artifacts/mobile/app/_layout.tsx:955-958`
- **Problem:** GUEST_BUYER_TABS excludes 'profile', 'inbox', 'orders', 'activity', so tapping those tab-bar slots as a guest replaces the whole navigator with /sign-in and throws away the browse stack. ('search' is listed but no (buyer)/search route exists.)
- **Why it costs money:** An abrupt wall on a tab tap reads as forced signup and makes users quit rather than convert.
- **Fix:** Allow these tabs for guests and render an inline 'Sign in to see your orders/messages' card (existing EmptyState + requireSignIn).
- **$ impact:** ~$300-700/mo

<a id="bt-287"></a>
### BT-287 · P2 · effort S · Out-of-stock / payment-unavailable sellers still let buyers fill the cart

- **Where:** buyer-product-detail, cart · `artifacts/mobile/app/buyer-product-detail.tsx:1094-1104,artifacts/mobile/app/(buyer)/cart.tsx:956-976`
- **Problem:** When a seller's Stripe account isn't ready, the PDP says 'You can still add this item to your cart', and the cart then blocks checkout for the whole selection with an Alert ('Payments unavailable'). Guests skip the payment check entirely and fail at the hosted session (guest-checkout.ts:176-178).
- **Why it costs money:** Buyers invest effort and are then blocked late. Inactive-Connect sellers are a launch reality, since onboarding sellers lag.
- **Fix:** Exclude payment-unready sellers from public listings (or label 'Not accepting orders yet' on cards), and in the cart only block that seller's group, not the full checkout.
- **$ impact:** ~$300-800/mo

<a id="bt-288"></a>
### BT-288 · P2 · effort M · Back-in-stock waitlist and price-drop alerts require sign-in and push

- **Where:** buyer-product-detail, buyer-saved · `artifacts/mobile/app/buyer-product-detail.tsx:812-825,artifacts/api-server/src/routes/waitlist.ts:20,artifacts/api-server/src/lib/stockNotifications.ts:130-190`
- **Problem:** Restock/price-drop notifications are wired server-side (good), but 'Notify me' requires an account and the delivery is in-app/push. Waitlisted buyers without push permission (see onboarding finding) only see an Activity row they won't open.
- **Why it costs money:** Restock alerts convert at very high rates, and delivery quality decides the revenue.
- **Fix:** Add an email channel to notifyBackInStock/notifyPriceDrop, and allow a guest email for the waitlist.
- **$ impact:** ~$300-800/mo

<a id="bt-289"></a>
### BT-289 · P2 · effort M · No buyer win-back / re-engagement job

- **Where:** server · `artifacts/api-server/src/jobs (no buyer re-engagement job)`
- **Problem:** Jobs exist for abandoned carts, drops, live reminders, seller trial and thread-cash expiry, but nothing targets lapsed buyers (no 'new from brands you follow' digest, no 7/30-day inactivity nudge). grep for winback/re-engage/inactive finds nothing buyer-facing.
- **Why it costs money:** Repeat purchase is where marketplace GMV compounds, and without nudges buyer retention decays to organic.
- **Fix:** Add a weekly digest job: new products from followed sellers + saved-item price drops, via email (+push if granted), respecting notification prefs.
- **$ impact:** ~$1-3k/mo repeat GMV

<a id="bt-290"></a>
### BT-290 · P2 · effort M · Onboarding style interests are not used to personalize Home

- **Where:** onboarding → feed · `artifacts/api-server/src/routes/buyer-recommended-brands.ts:29-91,artifacts/mobile/services/socialService.ts:1906-1913`
- **Problem:** buyer_style_interests and likedBrandIds feed only buyer-recommended-brands (the BrandsYouMightLikeRow on Discover). The Home feed (/api/public/posts) is identical for every buyer.
- **Why it costs money:** Buyers answer survey steps and see no payoff, which wastes the onboarding cost (6 screens).
- **Fix:** Wire Home to /api/feed/for-you (see ranking finding), which already consumes these signals.
- **$ impact:** covered by ranking finding

<a id="bt-291"></a>
### BT-291 · P2 · effort L · Hosted-path multi-seller cart makes the buyer pay N separate times

- **Where:** buyer-checkout (hosted) · `artifacts/mobile/app/buyer-checkout.tsx:658-770`
- **Problem:** In the hosted path (guests, pre-orders, rewards) the code loops deliveryGroups, opening a separate Stripe Checkout browser per seller. Any cancel mid-loop leaves a partially paid cart.
- **Why it costs money:** A cart with 3 brands means 3 card entries, and most buyers abandon after the first.
- **Fix:** Route these cases to the one-PaymentIntent cart path (checkout-intent.ts) as noted above. Until then, show 'You'll pay each store separately (N payments)' before Pay.
- **$ impact:** ~$500-1.5k/mo

<a id="bt-292"></a>
### BT-292 · P2 · effort S · Inbox 'Message filters' is a coming-soon placeholder; story-create has dead controls

- **Where:** (buyer)/inbox, buyer-story-create · `artifacts/mobile/app/(buyer)/inbox.tsx:1076,artifacts/mobile/app/buyer-story-create.tsx:1517,artifacts/mobile/app/buyer-story-create.tsx:1679`
- **Problem:** inbox shows snackbar 'Message filters — coming soon'. story-create has a Pressable with onPress={() => {}} and a 'More tools … coming soon' Alert.
- **Why it costs money:** Dead buttons read as unfinished, and App Review flags placeholder features (Guideline 2.1/2.2).
- **Fix:** Hide these controls until implemented (additive conditional render).
- **$ impact:** review-risk only

<a id="bt-293"></a>
### BT-293 · P3 · effort S · Phone number mandatory for every checkout

- **Where:** buyer-checkout · `artifacts/mobile/lib/checkoutReadiness.ts:44,artifacts/mobile/lib/checkoutReadiness.ts:77,artifacts/api-server/src/routes/checkout-intent.ts:106,artifacts/api-server/src/routes/guest-checkout.ts:54`
- **Problem:** contactPhone is required by client readiness and by the zod schemas of all three checkout routes. Apple/Google Pay also force PhoneNumber in required fields.
- **Why it costs money:** Each required field costs conversion, and privacy-sensitive buyers abandon at a phone requirement for a fashion purchase.
- **Fix:** Make phone optional (still collected when the carrier requires it) in the schemas and readiness checks.
- **$ impact:** ~$200-500/mo

<a id="bt-294"></a>
### BT-294 · P3 · effort S · Recently viewed is buried at the bottom of an infinite Discover list

- **Where:** (buyer)/discover · `artifacts/mobile/app/(buyer)/discover.tsx:335,artifacts/mobile/components/RecentlyViewedRow.tsx:37`
- **Problem:** RecentlyViewedRow is passed as ListFooterExtra of the For You grid (loads up to 120 posts), so it is effectively never seen. It is also on the cart page.
- **Why it costs money:** Recently-viewed is the cheapest repeat-visit conversion surface.
- **Fix:** Render RecentlyViewedRow in the Discover header (after DiscoverFeaturedRail) for signed-in buyers with ≥1 item.
- **$ impact:** ~$200-500/mo

<a id="bt-295"></a>
### BT-295 · P3 · effort S · Discover infinite scroll stops at 120 and refetches the whole list each page

- **Where:** (buyer)/discover · `artifacts/mobile/app/(buyer)/discover.tsx:336-341,artifacts/mobile/app/(buyer)/discover.tsx:192-200`
- **Problem:** onEndReached increments forYouLimit by 30 and refetches all rows via composeDiscoverPosts (limit grows to 120, then stops). The grid ends silently at 120 posts and each page re-downloads everything.
- **Why it costs money:** Browsing dead-ends for engaged buyers, and server/bandwidth cost scales quadratically per session.
- **Fix:** Paginate with offset/cursor and append, and remove the 120 cap.
- **$ impact:** small; cost + engagement

<a id="bt-296"></a>
### BT-296 · P3 · effort S · Feed 'See all' drops push the buyer into the seller (tabs) group

- **Where:** (tabs)/feed (buyer mode) · `artifacts/mobile/app/(tabs)/feed.tsx:3163,artifacts/mobile/app/_layout.tsx:1021-1023`
- **Problem:** JustDroppedRailPage onSeeAll pushes '/(tabs)/following'. For signed-in buyers AuthGate then router.replace()s to /(buyer)/following (double navigation, back stack broken). For guests, (tabs) is protected, so it goes to sign-in.
- **Why it costs money:** A broken drop discovery path means fewer drop sales.
- **Fix:** Push '/(buyer)/following' (or /buyer-drops, which is guest-allowed) when isBuyerSurface.
- **$ impact:** ~$100-300/mo

<a id="bt-297"></a>
### BT-297 · P3 · effort S · Search, category and PDP have no currency/locale handling (US-only checkout)

- **Where:** buyer-checkout, StripePayment · `artifacts/api-server/src/routes/checkout-intent.ts:380,artifacts/api-server/src/routes/guest-checkout.ts:162,artifacts/mobile/components/checkout/StripePayment.tsx:151,artifacts/mobile/components/checkout/StripePayment.tsx:280-282`
- **Problem:** Currency is hardcoded 'usd' everywhere. CardField countryCode is 'US', and Google Pay allowedCountryCodes is ['US'], while sellers can configure worldwide shipping zones (shippingZones.zoneType 'rest_of_world').
- **Why it costs money:** International buyers who find brands via social can see listings but cannot complete Google Pay with a non-US address, which confuses them and loses those sales.
- **Fix:** For launch, explicitly label 'Ships to US only' when the buyer locale is non-US. Later, remove the Google Pay US restriction where the seller ships internationally.
- **$ impact:** ~$200-500/mo

<a id="bt-298"></a>
### BT-298 · P3 · effort S · PDP fetches seller payment status only for signed-in buyers

- **Where:** buyer-product-detail · `artifacts/mobile/app/buyer-product-detail.tsx:625-630,artifacts/mobile/app/buyer-product-detail.tsx:933-951`
- **Problem:** api.buyer.sellerPaymentStatus is skipped when !isSignedIn, so guests see a normal Buy now and only learn at the hosted session that 'Seller payment account is not active'.
- **Why it costs money:** Late failure after the guest has filled in contact and address means a lost buyer.
- **Fix:** Expose payment readiness on the public product payload (stripeAccountStatus === 'active' boolean) and use it for all viewers.
- **$ impact:** ~$100-300/mo

<a id="bt-299"></a>
### BT-299 · P3 · effort S · Cart checkout re-validates and checks every seller sequentially before opening checkout

- **Where:** (buyer)/cart · `artifacts/mobile/app/(buyer)/cart.tsx:933-976`
- **Problem:** startCheckout awaits validateCart, then one sellerPaymentStatus call per seller in a for-loop, then createCheckoutSession, which fetches shipping per seller, all before navigation. Checkout then validates again (buyer-checkout.tsx:404-431).
- **Why it costs money:** Multi-second spinner on the Checkout tap, and latency at the commit moment reduces conversion.
- **Fix:** Run payment-status checks in Promise.all, or navigate immediately and let checkout show per-seller issues inline (it already does).
- **$ impact:** ~$100-300/mo

<a id="bt-300"></a>
### BT-300 · P3 · effort S · Saved-items 'Buy now' skips seller payment / vacation checks

- **Where:** buyer-saved · `artifacts/mobile/app/buyer-saved.tsx:150-165`
- **Problem:** buyer-saved Buy now creates a buy-now session and pushes /buyer-checkout with no sellerPaymentStatus or vacation check (PDP does both).
- **Why it costs money:** Failures surface late inside checkout, after the buyer has committed.
- **Fix:** Reuse the PDP's handleBuyNow pre-checks (or route through thread-product-detail).
- **$ impact:** small

## Growth loops: referrals, links, web, SEO, affiliates

56 findings: 10 P0 · 18 P1 · 17 P2 · 11 P3

<a id="bt-301"></a>
### BT-301 · P0 · effort S · Production routing sends every root-level API page (/.well-known, /l, /bio, /g, /u) to the SPA

- **Where:** server · `artifacts/api-server/.replit-artifact/artifact.toml:10,artifacts/mobile/.replit-artifact/artifact.toml:14,artifacts/api-server/src/app.ts:53,artifacts/api-server/src/app.ts:182-192,artifacts/mobile/server/serve.js:177-208`
- **Problem:** The API artifact only claims the path prefix "/api" while the mobile web artifact claims "/". The API mounts /.well-known/*, /u/:username, /l/:code, /bio/:slug(/go|/shop|/p), and /g/:code at the site root (app.ts), so on brandthread.app those requests reach mobile/server/serve.js. serve.js has no handlers for them, so they get the SPA shell (or a plain 404 for non-HTML requests). Integration tests use supertest against the API app directly, so they pass while production is broken.
- **Why it costs money:** Universal links, tracked short links, link-in-bio pages, and giveaway landings all depend on these routes, and every one of them is dead in production. That removes the main ways sellers can drive outside traffic to purchases.
- **Fix:** Add the root paths to the API artifact's services.paths ("/.well-known", "/l", "/bio", "/g"), or add a small proxy in serve.js that forwards those prefixes to the API origin (SHARE_PREVIEW_API_BASE) before the SPA fallback. Add a deployed smoke test that curls brandthread.app/.well-known/apple-app-site-association.
- **$ impact:** $5k-10k/mo: deep links, short links, bio pages, and giveaways are all off-platform acquisition, roughly 10-20% of GMV-driving traffic at the $50k target

<a id="bt-302"></a>
### BT-302 · P0 · effort S · apple-app-site-association/assetlinks unreachable and empty: universal links never verify

- **Where:** server · `artifacts/api-server/src/routes/wellKnown.ts:30-35,artifacts/api-server/src/routes/wellKnown.ts:43-54,artifacts/mobile/app.json:26-29,artifacts/mobile/docs/launch/README.md:113-121`
- **Problem:** AASA is served by the API at /.well-known, which production routing never reaches (see the routing finding). Even if it were reachable, it returns details: [] unless APPLE_TEAM_ID is set, and assetlinks returns [] unless ANDROID_SHA256_CERT_FINGERPRINTS is set. Neither variable appears in .replit or any deployment config. iOS caches the AASA at install time, so a failed fetch at launch keeps links in Safari until the app is reinstalled or updated.
- **Why it costs money:** Every shared https link (product, post, profile, store, invite, drop) opens the website instead of the app, which drops buyers into a weaker web flow. Most social shares lose the in-app purchase path.
- **Fix:** Fix the routing, set APPLE_TEAM_ID and ANDROID_SHA256_CERT_FINGERPRINTS on the deployment before the App Store build, and verify with Apple's AASA validator. Also consider writing static-build/.well-known/* in build-web.js so serve.js serves it directly.
- **$ impact:** $3k-6k/mo: a large share of link-driven installs and purchases fall back to web or stall

<a id="bt-303"></a>
### BT-303 · P0 · effort S · Signed-out visitors on shared product links are bounced to splash/sign-in

- **Where:** product-detail · `artifacts/mobile/lib/guestRoutes.ts:16-35,artifacts/mobile/app/_layout.tsx:952-955`
- **Problem:** store/product redirects to 'product-detail', and 'product-detail' is not in GUEST_TOP_LEVEL. A signed-out visitor (anyone who just installed the app, or any web visitor) is therefore forced to /splash or /sign-in, even though buyer-product-detail and guest checkout are guest-allowed.
- **Why it costs money:** Shared and advertised product links ask cold traffic for an account before they see the product, which kills conversion.
- **Fix:** After pointing the redirect at buyer-product-detail (previous finding), the guest path works. Also add 'p', 'tag', 'place' and 'invite' to GUEST_TOP_LEVEL explicitly instead of relying on effect ordering.
- **$ impact:** Included in the product-link finding; guest conversion on product links goes to about zero

<a id="bt-304"></a>
### BT-304 · P0 · effort S · Store share links (/store/{username}) return HTTP 404 with no preview

- **Where:** share-store · `artifacts/mobile/server/sharePreview.js:60-73,artifacts/api-server/src/routes/share-preview.ts:82-100,artifacts/api-server/src/routes/store.ts:812-813,artifacts/mobile/app/share-store.tsx:22,41-47`
- **Problem:** share-store.tsx and launch-publish.tsx share https://brandthread.app/store/{username}. The OG preview looks up storefronts.slug = {username}, but storefront slugs are generated as store-<random hex> (store.ts:813) or set to the Clerk owner id (seller-settings-route.ts:79), so they never match. The API returns 404, and sharePreview.js then serves the page with HTTP status 404 and robots noindex.
- **Why it costs money:** A seller's main store link shows no card on iMessage, Instagram, or Facebook and is marked not-found to crawlers. Sellers' own promotion of their store gets no click-through.
- **Fix:** In share-preview.ts, resolve /stores/:slug by users.username first (seller name, avatar, bio) and fall back to storefronts.slug; never 404 a valid seller username.
- **$ impact:** $1k-3k/mo: store links are the main asset sellers post on their own socials

<a id="bt-305"></a>
### BT-305 · P0 · effort S · Signed-out profile or store landing shows no products, only Sign in / Join

- **Where:** u/[username] · `artifacts/mobile/app/u/[username].tsx:11-13,334,433-438,artifacts/mobile/lib/guestRoutes.ts:26`
- **Problem:** Signed-in visitors are forwarded to /seller-profile, but signed-out visitors stay on PublicProfileLanding ("no posts, no seller commerce data") with only Sign in and Join buttons. 'seller-profile' is already a guest-allowed route, so guests could browse and buy, but they are never sent there. Store links and creator ?aff links resolve here.
- **Why it costs money:** Cold traffic from a seller's Instagram bio, store link, or Meta ad (destinationUrl is this profile URL) hits a signup wall instead of products.
- **Fix:** For accountType 'seller', also replace to /seller-profile?sellerId=... when signed out. Keep the landing only for buyer profiles.
- **$ impact:** $2k-5k/mo: every store link, creator link, and paid ad lands here

<a id="bt-306"></a>
### BT-306 · P0 · effort S · Buyers have no entry point to the Invite / Give $10 Get $10 screen

- **Where:** buyer-invite · `artifacts/mobile/app/(tabs)/marketing.tsx:268-271,artifacts/mobile/app/buyer-settings-menu.tsx:97-98,artifacts/mobile/lib/activity.ts:628`
- **Problem:** /buyer-invite is only pushed from the seller Marketing tab, from the referral_joined activity (which only fires after a successful referral), and from the invite deep link when the user is already signed in. The buyer profile, buyer settings menu (Rewards, Thread Cash wallet), thread-cash.tsx and loyalty.tsx have no Invite row. loyalty.tsx:164 describes referrals with no button.
- **Why it costs money:** The business model limits referral rewards to buyers, but buyers cannot find the program, so the main buyer acquisition loop never starts.
- **Fix:** Add an 'Invite friends, get $10' row to buyer-settings-menu, the buyer profile header, the thread-cash wallet, and the post-purchase success screen, all pushing /buyer-invite.
- **$ impact:** $2k-5k/mo: the referral loop is effectively off; even a k-factor of 0.1 at the target scale matters

<a id="bt-307"></a>
### BT-307 · P0 · effort S · *.brandthread.app store subdomains are advertised but never wired (no DNS, TLS, or host routing)

- **Where:** store-publish · `artifacts/mobile/app/store-publish.tsx:116-119,277-279,292,artifacts/mobile/app/store-settings.tsx:157,artifacts/mobile/app/store-domain.tsx:165-168`
- **Problem:** Sellers are told 'Your store will be live at https://{storeUrl}.brandthread.app', and the success screen has a 'View store' button that opens that URL. Nothing in the API or serve.js reads the Host header to resolve a storefront (grep for req.hostname/headers.host finds only the Clerk proxy), and there is no wildcard DNS or TLS config. The link fails to resolve.
- **Why it costs money:** The seller's first moment after publishing is a broken link. Sellers who print or share it lose all that traffic and lose trust in what they're paying for.
- **Fix:** Until wildcard hosting exists, show and share the working URL (brandthread.app/u/{username}, or the storefront path) everywhere. Later, add wildcard DNS and TLS plus host-based storefront resolution in a front proxy.
- **$ impact:** Seller trust and churn risk; every shared subdomain link loses 100% of its clicks

<a id="bt-308"></a>
### BT-308 · P0 · effort S · Tracked short links (brandthread.app/l/CODE) are dead in production

- **Where:** growth-links · `artifacts/api-server/src/lib/growth/destinations.ts:6,artifacts/api-server/src/routes/growth.ts:62,artifacts/api-server/src/app.ts:187`
- **Problem:** Sellers create UTM short links whose URL is `${getWebOrigin()}/l/${code}` = https://brandthread.app/l/CODE. /l/* is not routed to the API in production, so the link opens the SPA shell, which renders not-found. No click is recorded and no redirect happens.
- **Why it costs money:** Sellers paste these into Instagram, TikTok, and influencer posts. Every click is lost and the growth-links analytics show zero, which makes the paid Marketing tools look broken.
- **Fix:** Route /l/* to the API (see the routing finding) and add a post-deploy check that /l/<known code> returns 302.
- **$ impact:** $500-2k/mo of seller-driven traffic, plus seller retention

<a id="bt-309"></a>
### BT-309 · P0 · effort S · Link-in-bio pages (brandthread.app/bio/slug) are dead in production

- **Where:** link-in-bio · `artifacts/api-server/src/lib/growth/destinations.ts:7,artifacts/api-server/src/app.ts:188-191,artifacts/mobile/app/link-in-bio.tsx:257`
- **Problem:** The server-rendered bio page and its /go, /shop and /p redirects are mounted at the API root, which production routing does not reach. The seller's 'Share page' shares a URL that shows the app's not-found screen.
- **Why it costs money:** Link-in-bio is the number-one link a creator brand puts on Instagram and TikTok, and it currently sends 100% of that traffic nowhere.
- **Fix:** Route /bio/* to the API, and verify that /bio/<slug> returns 200 HTML after deploy.
- **$ impact:** $1k-3k/mo: bio link is the main IG/TikTok-to-store path

<a id="bt-310"></a>
### BT-310 · P0 · effort M · Affiliate commissions are paid from Brandthread's balance, not the seller's

- **Where:** server · `artifacts/api-server/src/lib/affiliate/payouts.ts:181-187,artifacts/api-server/src/lib/affiliate/commission.ts:6-14,artifacts/api-server/src/lib/affiliate/service.ts:22-30`
- **Problem:** runCreatorPayout does stripe.transfers.create({destination: creator}) from the platform balance. Nothing in lib/money (fees.ts, cartTransfers.ts, checkoutPlan.ts) reduces the seller's transfer or application fee by the commission, and no reverse transfer or account debit recovers it from the seller. Sellers can set up to 50% commission (MAX_COMMISSION_BPS 5000, default 10%). The code comments say 'the seller is never charged more than the stated percentage', but the seller is never charged at all.
- **Why it costs money:** Each affiliate order pays the creator 10-50% of the subtotal while Brandthread earns only a 5% fee. That is a net loss of 5-45% of GMV on every creator sale, and creators are a growth channel, so the loss grows with success.
- **Fix:** Fund commissions from the seller: add commission to application_fee_amount at checkout (or create a reverse transfer from the seller's connected account when the commission becomes payable) before enabling AFFILIATE_PAYOUTS_ENABLED.
- **$ impact:** At 20% of $1M GMV via creators at 10% commission: -$10k/mo net (only off while AFFILIATE_PAYOUTS_ENABLED is unset)

<a id="bt-311"></a>
### BT-311 · P1 · effort S · AASA path list omits /invite/*, /community-join, /live/* and /g/*

- **Where:** server · `artifacts/api-server/src/routes/wellKnown.ts:18-28,artifacts/mobile/app/invite/[code].tsx:2-3,artifacts/mobile/lib/communities/inviteLink.ts:25,artifacts/mobile/app/live-feed.tsx:438`
- **Problem:** DEEP_LINK_PATHS covers /u, /c, /store, /drops, /p, /tag, /place, /onboarding* and /team-invite* only. The referral link https://brandthread.app/invite/CODE, community invites (/community-join?code=), live links (/live/{id}) and giveaway links (/g/CODE) are not claimed, so iOS always opens them in Safari even after the AASA is fixed.
- **Why it costs money:** The referral invite is the main buyer-acquisition loop. When it opens in a browser, the invitee signs up on the web or drops off instead of landing in the app with the code applied.
- **Fix:** Add "/invite/*", "/community-join*", "/live/*" and "/g/*" to DEEP_LINK_PATHS, and add in-app routes for /live/[id] and /g/[code].
- **$ impact:** $1k-2k/mo: referral conversion from link tap to signed-up buyer is likely cut by 30-50% without the in-app open

<a id="bt-312"></a>
### BT-312 · P1 · effort M · No deferred deep linking: invite or creator code lost when the app isn't installed

- **Where:** invite/[code] · `artifacts/mobile/app/invite/[code].tsx:36-39,artifacts/mobile/lib/affiliateRef.ts:21-27,artifacts/mobile/package.json (no branch/appsflyer/adjust/install-referrer dependency)`
- **Problem:** Referral (/invite/CODE) and creator (?aff=CODE) codes are only captured when the link opens the app or the web SPA, and stored in AsyncStorage or localStorage per surface. A user who taps the link, goes to the App Store, and installs gets a fresh app with no code. Grep for branch/appsflyer/adjust/installReferrer/clipboard handoff found nothing.
- **Why it costs money:** Most invitees do not have the app yet, so most referrals and creator conversions go unattributed. Inviters and creators then stop sharing because they don't get credit.
- **Fix:** Add a lightweight deferred link: the web /invite page shows an Install button that copies the code (iOS pasteboard handoff with user consent) or passes it via the Play Install Referrer, and the onboarding referral field pre-fills from it. Alternatively, adopt Branch or Expo-compatible AppsFlyer.
- **$ impact:** $1k-3k/mo: 40-60% of referral and creator installs are unattributed, which suppresses loop growth

<a id="bt-313"></a>
### BT-313 · P1 · effort M · No seller-to-seller referral program (subscription credit) exists

- **Where:** n/a · `searched: grep -riE 'seller.?referral|refer a (brand|seller)|invite a brand|brand referral' artifacts/api-server/src artifacts/mobile/app artifacts/mobile/lib returned no matches`
- **Problem:** Seller subscriptions are the recurring revenue line, but nothing rewards a seller for bringing another brand (for example, a free month on both subscriptions). Seller invites only exist for team members and manufacturers.
- **Why it costs money:** Seller acquisition depends entirely on paid or organic channels. Brands talk to other brands, which makes this the cheapest seller-acquisition channel.
- **Fix:** Add a seller invite code applied at plan selection that grants a Stripe or RevenueCat promotional free month to both sellers after the referred seller's first paid invoice. It can reuse the referrals table with a kind column.
- **$ impact:** $1k-4k/mo of subscription MRR at the target scale, if 10-20% of new sellers come by referral

<a id="bt-314"></a>
### BT-314 · P1 · effort M · Product share preview image is a private /objects/ path, so cards have no photo

- **Where:** server · `artifacts/mobile/server/sharePreview.js:127-138,artifacts/api-server/src/routes/products.ts:96-101,artifacts/api-server/src/routes/public.ts:438-493`
- **Problem:** Product photos uploaded in-app are stored as '/objects/<id>' with ACL visibility 'private' (products.ts:98-101). GET /public/products/:id returns images unchanged, and sharePreview.js writes images[0] straight into og:image, which gives a relative, non-public URL. Crawlers drop it, so product cards show no photo. The same raw path breaks bio-page tiles (bioPage requires https) and email product images (render.ts requires https).
- **Why it costs money:** Product links without an image get far fewer clicks on iMessage, Instagram, Pinterest, and email. Cross-ref buyer-funnel if images also fail in-app.
- **Fix:** Make product images public-read (or serve them via a public /api/v1/public/media/:id route) and return absolute https URLs from public product endpoints, the bio page, and the email renderer.
- **$ impact:** $500-2k/mo: rich previews and email images drive a large share of clicks

<a id="bt-315"></a>
### BT-315 · P1 · effort M · Sitemap lists only 6 static pages: no products, stores, or profiles

- **Where:** server · `artifacts/mobile/scripts/build-web.js:45,166-179,artifacts/api-server/src/routes/product-seo.ts:4`
- **Problem:** sitemap.xml is written at build time from PUBLIC_ROUTES (/, privacy, terms, guidelines, seller-agreement, refund-policy). The per-store product sitemap endpoint (/api/product-seo/public/:storeSlug/sitemap) exists but is never referenced from the sitemap or robots.txt.
- **Why it costs money:** Google cannot discover any product, store, or profile page, so organic search acquisition is zero.
- **Fix:** Serve a dynamic /sitemap.xml (sitemap index) from serve.js or the API that lists active public products (/store/product/:id), seller profiles (/u/:username), and drops, with lastmod.
- **$ impact:** $500-2k/mo of organic traffic within 3-6 months of launch

<a id="bt-316"></a>
### BT-316 · P1 · effort S · Store URL shows a doubled domain (store-xxxx.brandthread.app.brandthread.app)

- **Where:** store-publish · `artifacts/mobile/services/storeService.ts:417-418,artifacts/mobile/app/store-publish.tsx:116-119,160,277`
- **Problem:** getStorefront sets settings.storeUrl = `${remote.slug}.brandthread.app`, and store-publish then renders `https://${storeUrl}.brandthread.app`, which produces https://store-ab12cd34.brandthread.app.brandthread.app.
- **Why it costs money:** It looks broken to sellers at the publish moment and the link is unusable.
- **Fix:** Store only the bare subdomain in settings.storeUrl (drop the suffix in storeService:418), or strip a trailing .brandthread.app before rendering.
- **$ impact:** Seller trust and activation; part of the subdomain issue

<a id="bt-317"></a>
### BT-317 · P1 · effort M · Subdomain 'Save' only writes AsyncStorage and marks itself verified

- **Where:** store-domain · `artifacts/mobile/app/store-domain.tsx:80-86,artifacts/mobile/services/storeService.ts:835-841`
- **Problem:** handleSaveSubdomain calls updateDomain(btDomain.id, { subdomain, verificationStatus: 'verified' }), which only mutates the local storefront in AsyncStorage. The server slug never changes, and the UI shows the subdomain as verified.
- **Why it costs money:** The seller believes they own a vanity URL that resolves nowhere, and support tickets and churn follow.
- **Fix:** Add PATCH /api/store/slug (unique, validated, maybe default to the username) and call it. Never set verificationStatus client-side.
- **$ impact:** Seller retention; part of the subdomain issue

<a id="bt-318"></a>
### BT-318 · P1 · effort L · Custom domain flow says 'verified and SSL is being issued', but no SSL or routing exists

- **Where:** store-domain · `artifacts/mobile/app/store-domain.tsx:108-117,210,artifacts/api-server/src/routes/store.ts:1023-1080`
- **Problem:** The server only checks a TXT record and sets verified=true. No certificate is provisioned, no host maps to the storefront, and the 'www → cname.brandthread.app' target shown in the UI has no corresponding service. The success alert promises SSL issuance.
- **Why it costs money:** Sellers point their real domain at a dead target and lose their existing site traffic. That is a direct churn and refund risk for a paid-tier feature.
- **Fix:** Hide custom domains behind a feature flag until a TLS-terminating proxy (for example Cloudflare for SaaS or Caddy on-demand TLS) with host-to-storefront routing exists. Change the copy to 'Verified – connection coming soon'.
- **$ impact:** Refund and churn exposure on higher tiers if marketed as a plan perk

<a id="bt-319"></a>
### BT-319 · P1 · effort S · Giveaway share link /g/CODE is dead and its landing has no image or install path

- **Where:** seller-giveaway-detail · `artifacts/api-server/src/lib/giveaways.ts:24,artifacts/api-server/src/routes/giveawayLanding.ts:31-33,46,artifacts/mobile/app/seller-giveaway-detail.tsx:60-62`
- **Problem:** Giveaways share https://brandthread.app/g/CODE, which is unreachable (routing). Even when it is reachable, the landing has no og:image or twitter:card, and its only CTA is 'brandthread://giveaway?code=', which does nothing without the app (no App Store link or web fallback). 'giveaway' is also not a guest-allowed route, so a signed-out user is sent to sign-in and loses the giveaway.
- **Why it costs money:** Giveaways exist to acquire followers and buyers virally, and this loop is broken at every step.
- **Fix:** Route /g/*, add og:image (the prize or seller image), add the giveaway route to guestRoutes with sign-in gating at the Enter action, and add an App Store link (EXPO_PUBLIC_APP_STORE_URL) and a universal link fallback.
- **$ impact:** $300-1k/mo of follower and buyer acquisition per active seller cohort

<a id="bt-320"></a>
### BT-320 · P1 · effort S · Live stream shares use custom-scheme or exp:// URLs that don't unfurl or open for non-users

- **Where:** live / buyer-live · `artifacts/mobile/app/live.tsx:319-321,artifacts/mobile/app/buyer-live.tsx:300-306`
- **Problem:** ExpoLinking.createURL('/live', ...) and createURL('/buyer-live', ...) produce brandthread://... in store builds and exp://... in Expo Go. These are not https, have no preview, and are not tappable in many apps (WhatsApp, Instagram DMs). People without the app cannot open them.
- **Why it costs money:** Live shopping depends on real-time sharing to pull viewers in. Broken share links mean smaller live audiences and fewer live sales.
- **Fix:** Share https://brandthread.app/live/{streamId} (claim it in the AASA, add app/live/[id].tsx that redirects to buyer-live, and add an OG matcher showing the host and 'LIVE now').
- **$ impact:** $500-1.5k/mo of live GMV

<a id="bt-321"></a>
### BT-321 · P1 · effort S · Live feed shares brandthread.app/live/{id}, but no route exists

- **Where:** live-feed · `artifacts/mobile/app/live-feed.tsx:438,artifacts/mobile/lib/shareLinks.ts:84-121`
- **Problem:** There is no app/live/[id].tsx, parseShareLink has no 'live' case, and the AASA does not claim /live. In the app and on the web, the link shows +not-found.
- **Why it costs money:** Every live share from the live feed is a dead link.
- **Fix:** Add app/live/[streamId].tsx that redirects to /buyer-live?streamId= (guest-allowed), plus the AASA path and an OG matcher.
- **$ impact:** Included in the live share estimate

<a id="bt-322"></a>
### BT-322 · P1 · effort S · Creator payouts are switched off: AFFILIATE_PAYOUTS_ENABLED isn't set anywhere

- **Where:** creator-program · `artifacts/api-server/src/lib/affiliate/payouts.ts:33-35,artifacts/api-server/src/routes/affiliate-creator.ts:37-48,artifacts/mobile/app/seller-creator-program.tsx:145`
- **Problem:** Payouts only run when AFFILIATE_PAYOUTS_ENABLED=true. It is not in .replit userenv or any docs, so creators accrue 'owed' commissions that are never paid, and the UI says 'Payouts are not switched on yet.'
- **Why it costs money:** Creators who aren't paid stop promoting, which kills the affiliate loop. Turning it on before the funding fix creates the loss described in the previous finding.
- **Fix:** Fix the funding first, then set the flag and document it in docs/launch. Until then, hide creator recruitment, or label it clearly as 'commissions paid starting <date>'.
- **$ impact:** Creator loop dormant; $500-2k/mo of creator-driven GMV forgone

<a id="bt-323"></a>
### BT-323 · P1 · effort S · Creator Connect onboarding return URL points at /api-server/..., which 404s

- **Where:** creator-program · `artifacts/api-server/src/routes/affiliate-creator.ts:267-272,artifacts/mobile/server/serve.js:190-193`
- **Problem:** refresh_url and return_url are https://brandthread.app/api-server/seller/connect/onboard/{refresh,return}. The API is mounted only at /api and /api/v1, and serve.js explicitly 404s /api-*. Seller Connect uses /api/seller/connect/onboard (connect.ts:71). A creator who finishes Stripe onboarding lands on a JSON 404 page.
- **Why it costs money:** Creators abandon payout setup and so never get paid or keep promoting.
- **Fix:** Use `${getWebOrigin()}/api/seller/connect/onboard` (same as connect.ts), or a creator-specific return route that deep-links back to /creator-program.
- **$ impact:** $200-800/mo; blocks every creator payout account

<a id="bt-324"></a>
### BT-324 · P1 · effort S · Creator link targets /u/{brand}?aff=, so cold traffic sees a sign-up wall

- **Where:** creator-program · `artifacts/api-server/src/routes/affiliate-creator.ts:30-35,artifacts/mobile/app/u/[username].tsx:433-438`
- **Problem:** Creator share links land on the signed-out profile landing (no products, Sign in/Join). Products aren't visible until the visitor creates an account, and there is no product-specific creator link (the shareLink only takes a brand).
- **Why it costs money:** Influencer traffic is the coldest and highest-volume traffic. A sign-up wall before any product converts poorly.
- **Fix:** Send creator links to the guest-browsable seller profile or a product, and let creators generate product-level links (/store/product/{id}?aff=CODE).
- **$ impact:** $300-1k/mo of creator GMV

<a id="bt-325"></a>
### BT-325 · P1 · effort S · Seller Meta CAPI events are recorded under the BUYER's id, not the seller

- **Where:** server · `artifacts/api-server/src/routes/meta-ads.ts:53-55,802-833,artifacts/mobile/lib/marketingPixels.ts:199-215`
- **Problem:** POST /meta-ads/conversion-events uses sellerId(req) = the caller's clerkUserId. The caller is the buyer (buyer-product-detail and buyer-checkout call trackAndRelayConversionEvent), so the row is stored with the buyer as sellerId and loadConnectedAccount(buyer) finds no pixel. The product's seller never receives ViewContent or Purchase events. The route also requireAuth's, so guest web visitors' events get a 401.
- **Why it costs money:** Sellers running Meta ads through Brandthread get no conversion signal, Meta cannot optimize for purchases, and ROAS looks like zero. Sellers stop spending and churn from the ads feature.
- **Fix:** Resolve sellerId from productId (products.ownerId) or the order. Allow unauthenticated calls with rate limiting, and include hashed em/external_id when consented.
- **$ impact:** $500-2k/mo of seller ad-driven GMV, plus retention of sellers who run ads

<a id="bt-326"></a>
### BT-326 · P1 · effort S · Meta ads always land on the seller profile, even for product ads

- **Where:** meta-ads-setup · `artifacts/mobile/app/meta-ads-setup.tsx:172-181,219-223`
- **Problem:** destinationUrl = storeUrl = /u/{username} for every promoteKind, with a code comment claiming 'Brandthread has no dedicated public product page route', which is untrue (/store/product/{id} exists). No UTM parameters are appended. Ad clicks hit the signed-out profile landing with no products.
- **Why it costs money:** Sellers pay Meta for clicks that land on a sign-up wall, so ROAS is near zero and sellers churn from the paid feature.
- **Fix:** For promoteKind 'product', use buildProductUrl(promoteRefId) (after fixing the product route). Append utm_source=facebook&utm_medium=paid&utm_campaign=<campaign id>.
- **$ impact:** $500-2k/mo of seller ad GMV

<a id="bt-327"></a>
### BT-327 · P1 · effort S · Email marketing: product tiles link only to the storefront and are unlinked if it's unpublished

- **Where:** email-campaign-compose · `artifacts/api-server/src/lib/emailMarketing/render.ts:47-56,artifacts/api-server/src/lib/emailMarketing/sender.ts:77`
- **Problem:** Every product card's href is the store home (/api/store/site/slug), and only when the storefront is published. Otherwise the cards have no link at all. Links carry no utm_source=email or campaign id, and product images must be https (but uploads are /objects/ paths), so they render as grey boxes.
- **Why it costs money:** Email is the best repeat-purchase channel, and here it can't link to a product or be attributed.
- **Fix:** Link each card to buildProductUrl(id) with utm_source=brandthread_email&utm_campaign=<campaignId>, and resolve images to public https.
- **$ impact:** $500-1.5k/mo of repeat GMV

<a id="bt-328"></a>
### BT-328 · P1 · effort M · Web storefront URL is under /api/store/site/... and not linked from any in-app share

- **Where:** share-store · `artifacts/api-server/src/routes/store.ts:773-799,artifacts/mobile/app/share-store.tsx:22,artifacts/mobile/app/store-preview.tsx:22`
- **Problem:** The only web page where a non-app buyer can browse a full store and check out is /api/store/site/:slug. Share Store, Launch, and the profile all share /store/{username} (an app route) instead, so web buyers never reach the working web checkout from a shared link.
- **Why it costs money:** Web visitors (Instagram in-app browser, desktop) can't buy from the link sellers share.
- **Fix:** Make /store/{username} on web resolve to the published storefront (serve.js proxy, or redirect in sharePreview when a published storefront exists), and give storefronts a clean public path.
- **$ impact:** $500-2k/mo of web GMV (IG/TikTok in-app browsers ignore universal links)

<a id="bt-329"></a>
### BT-329 · P2 · effort S · Android App Links intent filter claims the whole domain with no path filter

- **Where:** n/a · `artifacts/mobile/app.json:250-260`
- **Problem:** The Android intentFilter has autoVerify on host brandthread.app and www with no pathPrefix/pathPattern. Once verified, every brandthread.app URL opens the app, including /bio/*, /l/* short links, /account-deletion, /privacy and /api/store/site/* storefronts. The app has no routes for these and shows +not-found.
- **Why it costs money:** Android buyers who tap a seller's link-in-bio, short link, or web storefront get a not-found screen in the app instead of the page.
- **Fix:** Replace the bare host entries with pathPrefix entries that mirror DEEP_LINK_PATHS (/u/, /c/, /store/, /drops/, /p/, /tag/, /place/, /invite/, /team-invite, /community-join, /onboarding).
- **$ impact:** $300-800/mo: Android share of bio, short-link, and storefront traffic dead-ends

<a id="bt-330"></a>
### BT-330 · P2 · effort S · Seller Marketing tab promotes buyer Thread Cash referrals to sellers

- **Where:** (tabs)/marketing · `artifacts/mobile/app/(tabs)/marketing.tsx:266-285,artifacts/api-server/src/lib/referrals/rewards.ts:29-40`
- **Problem:** Sellers see 'Invite and earn – Give $10, get $10 Thread Cash' and land on the buyer referral screen. The rewards code does not check account type, so sellers earn Thread Cash for invites. The owner's model says referral rewards are for buyers only.
- **Why it costs money:** Platform-funded Thread Cash goes to sellers, who can recruit their own customers through it, at $10 per invite. Meanwhile there is no seller-acquisition referral at all.
- **Fix:** Replace the seller card with a seller-to-seller referral (next finding), and gate inviter rewards in applyReferralCode/qualify to buyer accounts.
- **$ impact:** $200-1k/mo of unintended Thread Cash spend; cross-ref thread-cash-referrals-abuse

<a id="bt-331"></a>
### BT-331 · P2 · effort S · Invite and community links render the generic homepage card in iMessage

- **Where:** server · `artifacts/mobile/server/sharePreview.js:44-153`
- **Problem:** The share-preview MATCHERS have no entry for /invite/:code, /community-join, /live/*, /g/*, or /bio/*. A referral link renders 'Brandthread | Discover what's next' instead of '<Name> invited you – get $10 to spend'.
- **Why it costs money:** A personalized, money-forward unfurl roughly doubles link click-through. The generic card wastes every invite sent.
- **Fix:** Add an /invite/:code matcher that calls GET /api/v1/referrals/invite/:code (extend it to return the inviter's display name and avatar) and renders '<Name> sent you $10 on Brandthread' with a branded OG image.
- **$ impact:** $300-1k/mo: higher invite tap-through

<a id="bt-332"></a>
### BT-332 · P2 · effort S · Product preview lacks og:type product, price tags, and JSON-LD Product schema

- **Where:** server · `artifacts/mobile/server/sharePreview.js:232-246,artifacts/mobile/scripts/build-web.js:84-123`
- **Problem:** Every preview is og:type 'website' with no product:price:amount/currency, availability, or schema.org Product/Offer JSON-LD. Only the homepage has Organization/WebSite JSON-LD. WEB_DEPLOYMENT.md says the build generates JSON-LD, but that is only true for the static routes.
- **Why it costs money:** There are no Google Shopping free listings, Pinterest rich pins, or price-in-card on Facebook and iMessage, which are free acquisition channels for product search.
- **Fix:** In the /store/product matcher, emit og:type=product, product:price:amount/currency, and a <script type=application/ld+json> Product with an Offer (price, availability, seller name, image).
- **$ impact:** $300-1.5k/mo of free organic shopping traffic

<a id="bt-333"></a>
### BT-333 · P2 · effort S · robots.txt disallows /api/, which blocks the only real web storefront from crawlers

- **Where:** server · `artifacts/mobile/scripts/build-web.js:183,artifacts/api-server/src/routes/store.ts:773-799,artifacts/api-server/src/lib/growth/destinations.ts:14`
- **Problem:** The published storefront that can actually check out on web lives at /api/store/site/:slug, and short links, bio Shop buttons, and emails point there. robots.txt has 'Disallow: /api/', so Google never indexes any seller storefront.
- **Why it costs money:** Sellers paying for Brandthread get no SEO for their storefront, which weakens the 'website builder' value of the subscription.
- **Fix:** Serve storefronts at a public non-/api path (for example /s/:slug, proxied to the API) and allow it in robots, or add 'Allow: /api/store/site/' before the Disallow.
- **$ impact:** $300-1k/mo of storefront organic traffic, plus seller retention

<a id="bt-334"></a>
### BT-334 · P2 · effort S · Published storefront page has no OG, Twitter, canonical, or JSON-LD tags

- **Where:** server · `artifacts/api-server/src/routes/store.ts:445-462`
- **Problem:** buildPreviewHtml only emits <title> and meta description from seo.metaTitle/metaDescription. There is no og:image, og:title, canonical, or Product/Store JSON-LD. The 'social image' the seller uploads in store-seo.tsx (socialImageUri) is never synced to the server (storeService.ts:454-460 omits it).
- **Why it costs money:** Storefront links shared on Instagram or iMessage unfurl as bare URLs, and the seller's social-image setting does nothing.
- **Fix:** Sync socialImageUri in saveStorefront and add og:title/description/image/url, a twitter:card, a canonical, and Store/ItemList JSON-LD to the storefront head.
- **$ impact:** $200-800/mo

<a id="bt-335"></a>
### BT-335 · P2 · effort S · Server landings use custom-scheme-only CTAs with no App Store fallback

- **Where:** server · `artifacts/api-server/src/routes/profileLanding.ts:70,artifacts/api-server/src/routes/giveawayLanding.ts:46`
- **Problem:** The 'Open in Brandthread' buttons are brandthread://u/... and brandthread://giveaway..., and nothing links to the App Store or Play Store. Grep for apps.apple.com finds only landing-page.js, which is gated on EXPO_PUBLIC_APP_STORE_URL. There is also no apple-itunes-app Smart App Banner meta in +html.tsx or build-web.js.
- **Why it costs money:** Web visitors without the app have no path to install, so web-to-app conversion is lost.
- **Fix:** Add <meta name="apple-itunes-app" content="app-id=..., app-argument=<url>"> to the SPA shell and server landings, and an App Store button using the store URL env var.
- **$ impact:** $300-1k/mo of web-to-app installs

<a id="bt-336"></a>
### BT-336 · P2 · effort M · Affiliate attribution requires sign-in, so guest web checkouts never credit creators

- **Where:** server · `artifacts/mobile/components/AffiliateRefCapture.tsx:36-49,artifacts/api-server/src/routes/affiliate-creator.ts:8-10,artifacts/api-server/src/routes/guest-checkout.ts:317-319`
- **Problem:** The ?aff code is attached to an account only via POST /affiliate/attach (signed in). Guest checkout (web storefront, SPA guest checkout) records UTM and tracked-link attribution but never the affiliate code, so creators get no commission on guest orders.
- **Why it costs money:** Creators see clicks without commissions and stop promoting.
- **Fix:** Pass the pending aff code in the guest checkout body and record an affiliate attribution keyed by checkout session or email, then commission it in the webhook the same way as signed-in orders.
- **$ impact:** $200-800/mo

<a id="bt-337"></a>
### BT-337 · P2 · effort M · Pixel and CAPI tracking never fires on iOS/Android

- **Where:** buyer-product-detail / buyer-checkout · `artifacts/mobile/lib/marketingPixels.ts:121-133,168,204,artifacts/mobile/app/_layout.tsx:1178-1181,artifacts/mobile/app.json:46-48`
- **Problem:** consentGranted is only set by setMarketingPixelConsent, which _layout calls only when Platform.OS === 'web'. On native, trackAndRelayConversionEvent returns false immediately, so no CAPI relay happens for in-app purchases, which is where most GMV is. NSPrivacyTracking is false and there is no ATT prompt. That is correct for privacy, but it means no attribution path exists for native.
- **Why it costs money:** Neither Brandthread nor sellers can measure or optimize paid acquisition for the app.
- **Fix:** Send server-side, non-tracking CAPI events (no IDFA, first-party only, disclosed in the privacy policy) from the order webhook for sellers with a connected pixel, keyed by productId's seller, independent of the client.
- **$ impact:** $300-1.5k/mo of ad efficiency

<a id="bt-338"></a>
### BT-338 · P2 · effort M · Meta Ads integration is env-gated and needs Meta App Review (ads_management)

- **Where:** meta-ads-connect · `artifacts/api-server/src/routes/meta-ads.ts:60,129-131,185`
- **Problem:** OAuth requires META_APP_ID, META_REDIRECT_URI and META_OAUTH_STATE_SECRET, none of which are in .replit. Ads management on other businesses' ad accounts requires Advanced Access through Meta App Review and Business Verification, which can take weeks.
- **Why it costs money:** If this is marketed at launch, sellers hit a non-working connect flow.
- **Fix:** Start Meta Business Verification and App Review now, or hide the Meta Ads entry behind a feature flag until it is approved.
- **$ impact:** Feature unavailable at launch; seller trust risk

<a id="bt-339"></a>
### BT-339 · P2 · effort M · Tracked-link and UTM attribution only works for web storefront guest checkout

- **Where:** server · `artifacts/api-server/src/lib/growth/attribution.ts:14-50,artifacts/api-server/src/routes/guest-checkout.ts:317-319,artifacts/api-server/src/routes/store.ts:656`
- **Problem:** recordCheckoutAttribution is only called by guest-checkout, using window.__btAttribution from the server storefront page. Short links whose destination is a product (/store/product/:id?utm..&bt_link) open the SPA or app, which never reads or forwards UTM or link codes into native or SPA checkout.
- **Why it costs money:** The growth-links revenue column reads $0 for most links, so sellers can't see which campaigns sell and churn from Marketing tools.
- **Fix:** Capture utm_* and the link-code param in the SPA and app (like AffiliateRefCapture), persist for 7 days, and send them with buyer-checkout and checkout-intent so the webhook writes checkout_attributions.
- **$ impact:** Seller retention for paid tiers; indirect

<a id="bt-340"></a>
### BT-340 · P2 · effort M · No install or signup source attribution: users have no acquisition-source field

- **Where:** onboarding · `searched: grep -riE 'signup_source|signupSource|acquisition|install_source|first_touch' lib/db/src/schema artifacts/api-server/src/routes/auth.ts returned nothing,artifacts/mobile/server/landing.js:14`
- **Problem:** UTM parameters are recognized on the landing page (MARKETING_PARAMS) but discarded. Onboarding does not record utm, referrer, invite, or creator source on the user, and there is no SKAdNetwork, AdServices, or Play Install Referrer handling.
- **Why it costs money:** With no idea which channel produced paying sellers or repeat buyers, launch marketing spend can't be allocated toward the $50k target.
- **Fix:** Persist first-touch utm, referrer, and code in storage on first open and on web, then send them with /auth/onboarding/complete into a users.acquisition jsonb column. Add Apple AdServices token capture for Search Ads.
- **$ impact:** Indirect; misallocated acquisition spend

<a id="bt-341"></a>
### BT-341 · P2 · effort S · Analytics has no share, invite, or referral events, and funnel events are never fired

- **Where:** n/a · `artifacts/mobile/lib/analytics/events.ts:8-23`
- **Problem:** ANALYTICS_EVENTS has no share, invite_sent, referral_applied, or deep_link_opened events. add_to_cart, checkout_started, follow, onboarding_completed, seller_onboarding_completed and product_published are defined but never tracked (grep for track( only finds app_opened, post_viewed, product_viewed, signup_started and signup_completed).
- **Why it costs money:** Viral coefficient and funnel conversion can't be measured, so broken loops like the ones in this file go unnoticed.
- **Fix:** Add share(kind, surface), invite_link_opened, referral_applied, and deep_link_opened(kind) events, and call the existing funnel events at their sites.
- **$ impact:** Indirect; enables loop tuning

<a id="bt-342"></a>
### BT-342 · P2 · effort S · Buyer shares (profile, post, collection) carry no referral code

- **Where:** ThreadShareSheet / share-profile / buyer-collection · `artifacts/mobile/lib/shareLinks.ts:32-57,artifacts/mobile/components/ThreadShareSheet.tsx:88-92,artifacts/mobile/server/landing.js:14`
- **Problem:** Referral credit only flows through the dedicated /invite/CODE link. Every other share a buyer sends (posts, collections, profile QR) has no ?ref=CODE, and 'ref' is treated as an ignored marketing parameter.
- **Why it costs money:** Organic shares are far more frequent than deliberate invites. Each one is a missed referral attribution and a reason the inviter isn't rewarded.
- **Fix:** Append ?ref=<inviteCode> to the build*Url helpers for signed-in buyers. Capture ref in a component like AffiliateRefCapture and pre-fill the onboarding referralCode.
- **$ impact:** $300-1k/mo of additional attributed referrals

<a id="bt-343"></a>
### BT-343 · P2 · effort S · Contacts-based find-friends is off by default and has no 'invite non-members' path

- **Where:** find-friends-contacts · `artifacts/mobile/lib/contactSyncFlag.ts:6-8,artifacts/mobile/app/find-friends-contacts.tsx:1-12`
- **Problem:** The screen requires EXPO_PUBLIC_CONTACT_SYNC_ENABLED and CONTACT_SYNC_ENABLED, both default off. Even when on, it only matches existing members to follow. There is no SMS invite with the referral link for contacts who aren't members.
- **Why it costs money:** The highest-converting invite channel (SMS to contacts) isn't used.
- **Fix:** Add an 'Invite' row for unmatched contacts that opens sms: with the invite link. This is privacy-safe because it uses the device composer and nothing is uploaded.
- **$ impact:** $200-800/mo of referral volume

<a id="bt-344"></a>
### BT-344 · P2 · effort S · Emails, bio pages, and storefronts have no 'Powered by Brandthread' seller-acquisition link

- **Where:** server · `artifacts/api-server/src/lib/emailMarketing/render.ts:61-80,artifacts/api-server/src/lib/growth/bioPage.ts:116`
- **Problem:** Only the bio page footer has 'Made with Brandthread', and it is unlinked to any signup or UTM. Marketing emails and storefront pages carry no Brandthread attribution, so seller-generated traffic never advertises Brandthread to other brands.
- **Why it costs money:** The Shopify/Linktree-style 'powered by' loop is free seller acquisition, and it is missing.
- **Fix:** Add a small 'Sell with Brandthread' footer link to emails, storefronts, and the bio page, pointing to https://brandthread.app/?utm_source=powered_by&utm_medium=<surface>&ref=<sellerCode>.
- **$ impact:** $200-1k/mo of seller subscription MRR

<a id="bt-345"></a>
### BT-345 · P2 · effort S · Product and store SEO editors save fields that no page renders

- **Where:** product-seo / store-seo · `artifacts/api-server/src/routes/product-seo.ts:9-11,artifacts/mobile/app/product-seo.tsx:21,132,artifacts/mobile/app/store-seo.tsx:151`
- **Problem:** The product-seo route admits that no per-product page exists, so product SEO titles and handles are never rendered. The editor previews 'brandthread.app › products › handle' and the store editor previews 'brandthread.app/{storeUrl}', and neither URL exists.
- **Why it costs money:** Sellers spend effort on, and are sold on, SEO that has no effect. That is a churn and trust risk for a paid feature.
- **Fix:** Use the resolved product SEO in the /store/product share-preview matcher (title and description) and in the canonical, and change the preview URL to the real /store/product/{id}.
- **$ impact:** Seller retention; $200-500/mo

<a id="bt-346"></a>
### BT-346 · P3 · effort S · Storefront slug can be the seller's Clerk user id in public URLs and emails

- **Where:** server · `artifacts/api-server/src/routes/seller-settings-route.ts:77-79,artifacts/api-server/src/lib/emailMarketing/sender.ts:77`
- **Problem:** If the seller saves policies before the storefront exists, the upsert inserts slug = owner_id (user_xxx). The public storefront URL, short-link redirects, and email 'shop' links then expose /api/store/site/user_2abc....
- **Why it costs money:** It produces ugly, untrustworthy links in buyer-facing emails and ads and leaks an internal id.
- **Fix:** Use the same store-<hex> generator (or the username) in the policies upsert.
- **$ impact:** <$100/mo, trust and hygiene

<a id="bt-347"></a>
### BT-347 · P3 · effort M · Seller-provided Meta/TikTok pixels only load on the /api/store/site storefront

- **Where:** store-pixels · `artifacts/api-server/src/routes/store.ts:266-279,artifacts/api-server/src/routes/growth.ts:455-470`
- **Problem:** store_pixels are injected only into the server-rendered storefront. The pages where buyers actually land from shares and ads (SPA /u/, /store/product/, the in-app PDP) never load the seller's pixel.
- **Why it costs money:** Sellers' retargeting audiences and conversion tracking miss most traffic, so their ads underperform and they spend less.
- **Fix:** Inject the owning seller's pixel on SPA product and profile routes (web, consent-gated), and send server CAPI on orders for sellers with pixels.
- **$ impact:** $100-500/mo

<a id="bt-348"></a>
### BT-348 · P3 · effort S · Buyer QR code encodes the bare homepage when the user has no username, and never the invite

- **Where:** buyer-qr-code · `artifacts/mobile/app/buyer-qr-code.tsx:33-37`
- **Problem:** The QR falls back to 'https://brandthread.app' and never includes the buyer's invite code, so scanning in person gives no referral.
- **Why it costs money:** In-person word of mouth isn't attributed or rewarded.
- **Fix:** Encode https://brandthread.app/invite/<code> (or /u/<username>?ref=<code>).
- **$ impact:** <$100/mo

<a id="bt-349"></a>
### BT-349 · P3 · effort S · Invite share sends the link twice on iOS and relies on server text on Android

- **Where:** buyer-invite · `artifacts/mobile/app/buyer-invite.tsx:120,artifacts/api-server/src/routes/referrals.ts:122`
- **Problem:** The server shareText already ends with 'tap: <link>', and the client also passes url: invite.link. On iOS, Messages and WhatsApp receive both the text with the link and the url attachment, so the link appears twice or as two bubbles. The demo shareText (buyer-invite.tsx:54) has no link at all.
- **Why it costs money:** The invite message looks spammy, which lowers acceptance.
- **Fix:** Pass url only on iOS with a message that omits the link, or message only (with the link) on Android, as invite-manufacturer.tsx:107 does.
- **$ impact:** <$200/mo

<a id="bt-350"></a>
### BT-350 · P3 · effort S · Web export is single-page: /privacy etc. are served with canonical '/' and homepage meta

- **Where:** server · `artifacts/mobile/app.json:264,artifacts/mobile/scripts/build-web.js:125-160`
- **Problem:** web.output is 'single', so only index.html is exported and addCanonicalMetadata's per-route metadata never applies. Every SPA path that isn't a share-preview match (including /privacy, /terms, /invite/X, /onboarding) is served with canonical https://brandthread.app/, homepage title, robots index,follow, and Organization JSON-LD.
- **Why it costs money:** Sitemap pages are canonicalized to the homepage (duplicate content), and invite pages index as the homepage.
- **Fix:** In serve.js, rewrite the canonical, og:url and title per path, or switch to output 'static' for the legal routes.
- **$ impact:** <$200/mo SEO

<a id="bt-351"></a>
### BT-351 · P3 · effort S · Dead brandthread.app links still in the app (/changelog, /chat, /help)

- **Where:** general-settings / design-canvas / help · `artifacts/mobile/app/general-settings.tsx:87,artifacts/mobile/app/design-canvas.tsx:5575-5576,artifacts/mobile/app/help.tsx:222`
- **Problem:** brandthread.app/changelog and /chat have no page (docs/review-readiness/prod-hygiene.md:102,105 flagged /chat on the Help screen as fixed, but design-canvas still opens it). /help is unverified. All of them fall to the SPA not-found screen.
- **Why it costs money:** Broken links in the app are a reviewer red flag and look unfinished to paying sellers.
- **Fix:** Point Live Chat in design-canvas to the support form route, and drop or replace changelog. Add /help as a real page or point it at in-app help.
- **$ impact:** <$100/mo; review-risk only

<a id="bt-352"></a>
### BT-352 · P3 · effort S · API-side /u/:username profileLanding is dead code that diverges from the SPA

- **Where:** server · `artifacts/api-server/src/routes/profileLanding.ts:10-70,artifacts/api-server/src/app.ts:182`
- **Problem:** The API renders its own signed-out /u/:username landing with a custom-scheme CTA, but in production /u/* goes to the SPA (with OG injected by serve.js). Two implementations of the same URL can drift, and this one has no og:image.
- **Why it costs money:** Maintenance confusion; if routing is changed to send root paths to the API, this would shadow the SPA profile page and its guest browsing.
- **Fix:** When fixing the root routing, exclude /u/* (keep it on the SPA), or delete profileLanding.
- **$ impact:** Negligible directly; prevents a regression

<a id="bt-353"></a>
### BT-353 · P3 · effort S · Docs claim subdomains open in a web view and product previews work; code disagrees

- **Where:** n/a · `artifacts/mobile/docs/launch/README.md:137-141,155-157,artifacts/api-server/src/routes/wellKnown.ts:9-10`
- **Problem:** README §7 says '{store}.brandthread.app links open in-app via a web view today' (nothing serves them) and §8 says product, profile, and drop share links 'now render a real preview' (the product link target is the seller screen and the image is a private path). wellKnown.ts references docs/launch/README.md at the repo root, which doesn't exist; the doc lives at artifacts/mobile/docs/launch/README.md.
- **Why it costs money:** False 'done' status means these gaps ship at launch.
- **Fix:** Correct the docs and add these items to docs/launch/dev-only-tasks.md with owners.
- **$ impact:** Indirect

<a id="bt-354"></a>
### BT-354 · P3 · effort S · Invite-only mode ignores member referral codes, which stalls the referral loop if enabled

- **Where:** access-code · `docs/launch/invite-only.md:26,artifacts/api-server/src/lib/access/inviteOnly.ts:40-49`
- **Problem:** If inviteOnlySignup is turned on for launch, an invitee holding a friend's /invite/CODE is still asked for an admin access code ('Member referral codes never unlock access').
- **Why it costs money:** Turning on scarcity mode would block the organic referral loop exactly when it should compound.
- **Fix:** Let a valid member referral code also satisfy the access gate (optionally limited to N per member).
- **$ impact:** Only matters if the flag is enabled; then it blocks all referral signups

<a id="bt-355"></a>
### BT-355 · P3 · effort S · Community invite links have no OG preview and no AASA path

- **Where:** community-join · `artifacts/mobile/lib/communities/inviteLink.ts:25,artifacts/mobile/server/sharePreview.js:44-153,artifacts/api-server/src/routes/wellKnown.ts:18-28`
- **Problem:** https://brandthread.app/community-join?code=... opens in the browser on iOS and unfurls as the generic homepage card.
- **Why it costs money:** Community growth (brand fan groups) brings repeat buyers, and these invites convert poorly.
- **Fix:** Add '/community-join*' to DEEP_LINK_PATHS and a matcher rendering the community name and cover image.
- **$ impact:** <$300/mo

<a id="bt-356"></a>
### BT-356 · P3 · effort S · brandthread-woven is a design-system artifact, not a web storefront

- **Where:** n/a · `artifacts/brandthread-woven/.replit-artifact/artifact.toml:1-22`
- **Problem:** brandthread-woven is kind='design-system' with no production service. Web buying depends only on the Expo web SPA and the API-rendered /api/store/site pages, both of which have the gaps listed above.
- **Why it costs money:** There is no fallback web storefront to rely on at launch.
- **Fix:** No new artifact is needed. Prioritize fixing the SPA product, profile, and store guest flows and the storefront path.
- **$ impact:** Informational

## App Store review & launch blockers

41 findings: 9 P0 · 13 P1 · 12 P2 · 7 P3

<a id="bt-357"></a>
### BT-357 · P0 · effort S · DM voice/video calls are fully simulated in production (fake 'connected' call)

- **Where:** buyer-conversation, seller-conversation · `artifacts/mobile/lib/calls/CallSessionContext.tsx:12-26,artifacts/mobile/lib/calls/previewCallProvider.ts:1-24,artifacts/mobile/app/buyer-conversation.tsx:2236-2258,artifacts/mobile/app/seller-conversation.tsx:1641-1654`
- **Problem:** CallSessionContext hard-wires `createPreviewCallProvider()` for every build. The phone/video buttons in every buyer and seller DM are not gated, 'ring' for 2.2s, then 'auto-connect' with no audio, video or signaling. The fake peer even 'turns their camera off' after 4s. REVIEW_NOTES.md:36 points reviewers straight at this feature.
- **Why it costs money:** A reviewer who taps Call sees a fake connected call with no media. That is a 2.1/2.3.1 rejection for a non-functional, misleading feature, and the whole launch slips.
- **Fix:** Hide both call buttons in production unless a real Agora provider is wired (`IS_PROD_NATIVE && !agoraCallProvider` → hide), and remove 'Calls' from REVIEW_NOTES.md until it works.
- **$ impact:** blocks all revenue (rejection delays launch; each week of slip is about $12k at target)

<a id="bt-358"></a>
### BT-358 · P0 · effort M · No native iOS build has ever been configured: `eas init` never run, no projectId

- **Where:** n/a · `artifacts/mobile/app.json:1-30 (no expo.extra.eas.projectId / owner),artifacts/mobile/app.config.js:30-35,artifacts/mobile/lib/contextualPushPermission.ts:27,docs/launch/testflight-checklist.md:27`
- **Problem:** app.json has no `extra.eas.projectId` or `owner`, so app.config.js never sets `updates.url` (OTA is off) and `Notifications.getExpoPushTokenAsync()` is called with no projectId (lib/contextualPushPermission.ts:27). That points to no EAS iOS build ever having been produced from this repo. REVIEW_READINESS.md:68-69 confirms nothing was verified on a device.
- **Why it costs money:** With 22 days left and no beta, the first native build will surface signing, extension, pod and new-architecture failures at the last moment. Push tokens will not register either, so sellers never hear about orders.
- **Fix:** This week, run `eas init`, commit the projectId, run an EAS production iOS build, and install it via internal TestFlight (internal testers skip review, so this is not a 'beta').
- **$ impact:** blocks all revenue

<a id="bt-359"></a>
### BT-359 · P0 · effort S · Live Activity widget extension not declared for EAS credentials

- **Where:** n/a · `artifacts/mobile/app.json:438,artifacts/mobile/plugins/with-upload-live-activity.js:1-60`
- **Problem:** The plugin adds an app-extension target `com.brandthread.mobile.UploadLiveActivity` with an App Group. app.json has no `extra.eas.build.experimental.ios.appExtensions` entry, so EAS will not create a provisioning profile for the extension and the App Group is never registered.
- **Why it costs money:** The first store build is likely to fail at code signing, and it would only surface days before submission.
- **Fix:** Add the appExtensions block (targetName, bundleIdentifier, entitlements with the App Group), or drop the plugin from the 1.0 build if Live Activities are not essential.
- **$ impact:** blocks all revenue if build fails

<a id="bt-360"></a>
### BT-360 · P0 · effort S · 'Featured on Discover' digital promotion sold via Stripe Checkout on native iOS

- **Where:** featured-slot · `artifacts/mobile/app/featured-slot.tsx:1-10,125-136,artifacts/mobile/app/boost.tsx:1069`
- **Problem:** Unlike Boost and Create-ad, the Featured slot purchase has no RevenueCat/IAP branch. It always opens Stripe Checkout in `WebBrowser.openAuthSessionAsync`, and it is reachable from the Boost screen.
- **Why it costs money:** Paying for in-app visibility is a digital good, so guideline 3.1.1 requires IAP and a reviewer on the seller account will reject. (Cross-ref subscription-iap.)
- **Fix:** On native, hide the Featured entry, or route it through RevenueCat consumables like boost.tsx:755.
- **$ impact:** blocks all revenue (rejection)

<a id="bt-361"></a>
### BT-361 · P0 · effort S · Reviewer notes template admits Boost is a non-IAP digital purchase

- **Where:** n/a · `docs/launch/app-store-metadata.md:105-110,docs/launch/testflight-checklist.md:76`
- **Problem:** The 'Review notes' block meant to be pasted into App Store Connect says Boost/ad promotion is 'currently Stripe Checkout… a digital, in-app-consumed feature… please flag if this blocks'. It conflicts with REVIEW_NOTES.md, the newer file.
- **Why it costs money:** Pasting it all but guarantees a 3.1.1 rejection, and it signals to Apple that the team knew.
- **Fix:** Delete that paragraph and the TestFlight note. Keep a single source (REVIEW_NOTES.md).
- **$ impact:** blocks all revenue (rejection)

<a id="bt-362"></a>
### BT-362 · P0 · effort S · Legal docs still carry placeholder entity/address and IS_DRAFT=true; doc claims PASS

- **Where:** terms, privacy, seller-agreement · `artifacts/mobile/content/legal.ts:17-20,36,38-41,artifacts/mobile/content/legal/terms.md:7-8,108-112,artifacts/mobile/content/legal/privacy.md:7-8,docs/launch/app-store-readiness.md:32`
- **Problem:** LEGAL_CONTACT.operator is '[LEGAL ENTITY NAME]' and the address is '[REGISTERED POSTAL ADDRESS]', with IS_DRAFT = true. Terms and Privacy name 'Brandthread, Inc.', but the business is Dev's LLC. The governing-law, venue and liability-cap sections are only [LAWYER REVIEW] notes, which are stripped, so the shipped Terms have an empty 'disputes and governing law' section. app-store-readiness.md row 14 claims 'PASS'.
- **Why it costs money:** Contracts that name the wrong legal entity weaken enforcement of the 5% fee, seller subscriptions and chargeback terms. They also won't match the App Store seller name or the Stripe account holder, which can trigger 5.1.1 privacy-policy and Stripe KYC questions.
- **Fix:** Replace 'Brandthread, Inc.' with the LLC's legal name and address, fill in governing law and the liability cap, set IS_DRAFT=false, and get counsel sign-off before submission.
- **$ impact:** blocks launch (legal/merchant entity mismatch)

<a id="bt-363"></a>
### BT-363 · P0 · effort S · OAuth-only users (Apple/Google) can only delete via emailed code that depends on Resend + Apple relay

- **Where:** delete-account · `artifacts/api-server/src/lib/accountDeletion.ts:326-328,381-410,artifacts/mobile/app/delete-account.tsx:88-111`
- **Problem:** Accounts without a password must enter a 6-digit code emailed through Resend. Without RESEND_API_KEY/MAIL_FROM the server returns MAIL_NOT_CONFIGURED. For 'Hide My Email' SIWA users the mail reaches them only if the sending domain is registered with Apple's Private Email Relay, and that step appears nowhere in docs (grep 'privaterelay' finds only a test).
- **Why it costs money:** A reviewer who signs up with Apple and tries to delete never gets the code, so in-app deletion appears broken. That is a 5.1.1(v) rejection.
- **Fix:** Register the mail-from domain in Apple Developer → Sign in with Apple for Email Communication, and add the step to dev-only-tasks.md. Also let SIWA users re-authenticate by re-running SIWA instead of email.
- **$ impact:** blocks launch (rejection)

<a id="bt-364"></a>
### BT-364 · P0 · effort S · iPad support on with untested layouts; checklist depends on TestFlight that won't happen

- **Where:** all · `artifacts/mobile/app.json:6,26,docs/app-store/ipad-release-checklist.md:1-40,docs/launch/app-store-readiness.md:41,REVIEW_READINESS.md:37`
- **Problem:** `supportsTablet: true`, and iPad allows all 4 orientations plus Split View. Every sign-off box in the iPad checklist is unchecked, and 35 files read `Dimensions.get` at module scope, so layouts go stale on rotate or resize. The checklist itself says to test 'with the TestFlight build', but there's no beta plan. Store iPad screenshots are stretched phone web renders.
- **Why it costs money:** Apple reviews on iPad. Broken iPad layouts are a common 2.1/4.0 rejection, and iPad support can't be removed after release.
- **Fix:** For 1.0, set `supportsTablet: false` (the app then runs in iPhone compatibility mode on iPad and still gets reviewed there), and add proper iPad support in 1.1 after testing.
- **$ impact:** rejection risk; blocks launch

<a id="bt-365"></a>
### BT-365 · P0 · effort S · eas.json submit config still placeholders

- **Where:** n/a · `artifacts/mobile/eas.json:73-79`
- **Problem:** `appleId`, `ascAppId` and `appleTeamId` are all REPLACE_WITH_*, and `verify:submit-config` fails right now.
- **Why it costs money:** `eas submit` can't upload the build.
- **Fix:** Fill them in once the App Store Connect record exists, and commit.
- **$ impact:** blocks launch until done

<a id="bt-366"></a>
### BT-366 · P1 · effort S · Store Analytics screen always errors; seller dashboard links to it

- **Where:** analytics-store · `artifacts/mobile/services/analyticsService.ts:139-143,artifacts/mobile/app/analytics-store.tsx:70,94-97,artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:943-944`
- **Problem:** `getStoreAnalytics()` unconditionally throws 'Store analytics are not available yet'. The screen shows 'Couldn't load store analytics' with a Retry button that never works. The dashboard's Traffic-sources 'See all' and source rows open it. `getMarketingAnalytics` throws the same way (analytics-marketing.tsx:112).
- **Why it costs money:** A reviewer on the demo seller account hits a permanent error screen, which counts as a 2.1 bug. Sellers also lose trust in the paid tool.
- **Fix:** Point 'See all' to an existing working analytics screen, or render a real empty state. Remove the unreachable analytics-marketing/store routes.
- **$ impact:** ~$1-3k/mo (seller churn and rejection risk)

<a id="bt-367"></a>
### BT-367 · P1 · effort M · Apple Sign-In token is never revoked on account deletion

- **Where:** delete-account (server) · `artifacts/api-server/src/routes/auth.ts:340-410,artifacts/api-server/src/jobs/accountPurge.ts:56-62,REVIEW_READINESS.md:27`
- **Problem:** Grepping for appleid.apple.com/auth/revoke finds nothing. Deletion only schedules a purge 30 days out, then calls `clerkClient.users.deleteUser`. No code calls Apple's REST revoke endpoint, and whether Clerk revokes it is unverified. REVIEW_READINESS row 2 lists this as still open.
- **Why it costs money:** Apple's 5.1.1(v) guidance requires revoking SIWA tokens on deletion. Reviewers test SIWA plus deletion together, so this is a rejection risk.
- **Fix:** Confirm in Clerk docs/support that deleteUser revokes Apple tokens. If it doesn't, call Apple's /auth/revoke with the stored refresh token when deletion is scheduled.
- **$ impact:** rejection risk → launch slip

<a id="bt-368"></a>
### BT-368 · P1 · effort S · Demo reviewer accounts can't delete themselves (seeded open orders block deletion)

- **Where:** delete-account · `artifacts/api-server/src/scripts/reviewDemo/plan.ts:183-184,artifacts/api-server/src/lib/accountDeletion.ts:56-70,166-176,REVIEW_NOTES.md:66-69`
- **Problem:** The seed gives the demo buyer a paid 'processing' order and a 'shipped' order, and the demo seller owns them. getDeletionBlockers returns `buyer_orders_awaiting_shipment` and `seller_open_orders`, so DELETE /api/auth/account returns 409 'Settle the items below'. REVIEW_NOTES still tells reviewers deletion works from Settings.
- **Why it costs money:** Apple reviewers routinely test deletion on the provided account. A blocked deletion reads as 'deletion not available', which is a 5.1.1(v) rejection.
- **Fix:** Mark seeded demo orders as delivered or cancelled, or exempt review accounts from blockers. Better still, tell reviewers in notes to create a fresh account to test deletion.
- **$ impact:** rejection risk

<a id="bt-369"></a>
### BT-369 · P1 · effort S · Moderators are never alerted to new reports; '24h' SLA promised to Apple and users

- **Where:** server · `artifacts/api-server/src/routes/reports.ts:155-177,artifacts/api-server/src/routes/moderation.ts:37-39,98,REVIEW_NOTES.md:61-62,artifacts/mobile/content/legal/terms.md:77`
- **Problem:** POST /api/reports only inserts a row. Grepping for notify/email/push/Slack finds no moderator alert. The SLA exists only as an 'overdue' count in the admin queue that someone must open. Terms and review notes promise action within 24 hours.
- **Why it costs money:** Under guideline 1.2, Apple can pull the app if objectionable content reported during review sits unactioned. Unhandled scam reports also drive chargebacks.
- **Fix:** On report insert, send an email or push to every moderator (or a safety@ mailbox or Slack webhook). Add an hourly job that escalates reports older than 12h.
- **$ impact:** rejection/takedown risk

<a id="bt-370"></a>
### BT-370 · P1 · effort S · Image/video moderation silently disabled unless Replit OpenAI integration env is present

- **Where:** server · `artifacts/api-server/src/lib/mediaModeration.ts:107-111,REVIEW_NOTES.md:64`
- **Problem:** `mediaModerationEnabled()` returns false unless AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY are set. Images and video frames then get verdict 'skipped' with no alert. Review notes claim automatic screening.
- **Why it costs money:** Nudity or violence in posts, products and stories goes unfiltered on a 13+ commerce app. That is a 1.2 takedown risk.
- **Fix:** Treat moderation as required in production: fail readiness when it's disabled in NODE_ENV=production, or log at error level. Set the env in production.
- **$ impact:** takedown risk

<a id="bt-371"></a>
### BT-371 · P1 · effort S · API server crashes at boot without Replit-specific AI_INTEGRATIONS_OPENAI_BASE_URL

- **Where:** server · `lib/integrations-openai-ai-server/src/text/client.ts:9-20,artifacts/api-server/src/routes/brandthread-agent.ts:16,artifacts/api-server/src/routes/ai.ts,artifacts/api-server/src/routes/support-chat.ts,artifacts/api-server/src/lib/aiUsage.ts,artifacts/api-server/src/lib/env.ts:46`
- **Problem:** The OpenAI client module throws at import if AI_INTEGRATIONS_OPENAI_BASE_URL or AI_INTEGRATIONS_OPENAI_API_KEY is missing, and four modules import it statically. env.ts lists the key as 'optional'. REVIEW_READINESS.md:51 says 'or OPENAI_API_KEY', which isn't enough.
- **Why it costs money:** If production is hosted anywhere but a Replit deployment with the integration, the whole API fails to start, and the reviewer sees a dead backend.
- **Fix:** Make the import lazy (as mediaModeration does) or accept OPENAI_API_KEY with a default base URL, and move the vars to REQUIRED in env.ts.
- **$ impact:** blocks all revenue if hit

<a id="bt-372"></a>
### BT-372 · P1 · effort S · User DMs to AI 'Brandthread Agent' sent to OpenAI with no explicit consent

- **Where:** buyer-conversation (agent) · `artifacts/api-server/src/routes/brandthread-agent.ts:1-40,REVIEW_NOTES.md:38-41`
- **Problem:** Every user is auto-given an AI agent conversation by the onboarding welcome hook, and their messages and history go to OpenAI (`gpt-5.4-mini`). Grepping for consent/opt-in finds no prompt; only the privacy policy mentions 'AI providers'. The same applies to AI studio tools.
- **Why it costs money:** Guideline 5.1.2(i) (2025 update) requires clearly disclosing third-party AI sharing and getting explicit permission. Without it, expect a rejection.
- **Fix:** Before the first agent message or first AI tool use, show a one-time consent sheet ('Your messages are sent to OpenAI to generate replies') and store the acceptance.
- **$ impact:** rejection risk

<a id="bt-373"></a>
### BT-373 · P1 · effort S · Privacy labels say search history not collected; server logs every query with userId

- **Where:** n/a · `artifacts/api-server/src/routes/public.ts:922,lib/db/src/schema/index.ts:2239-2249,docs/app-store/privacy-labels.md:52`
- **Problem:** `db.insert(searchLog).values({ userId: viewerId, query, normalized })` stores each signed-in search linked to the account. privacy-labels.md says search queries 'are not stored on the server', and NSPrivacyCollectedDataTypeSearchHistory is missing from app.json. search_log is also never purged on deletion.
- **Why it costs money:** Inaccurate privacy labels are grounds for rejection or removal under 5.1.2 and an FTC exposure.
- **Fix:** Either drop userId from search_log, or declare Search History (linked, App Functionality) in the manifest, labels and verifier, and purge it on deletion.
- **$ impact:** rejection risk

<a id="bt-374"></a>
### BT-374 · P1 · effort S · Support URL undefined; brandthread.app/help is behind the sign-in wall

- **Where:** help · `artifacts/mobile/app/_layout.tsx:659,949,artifacts/mobile/lib/guestRoutes.ts:15-36,artifacts/mobile/app/help.tsx:222,docs/app-store/release-flow.md:222`
- **Problem:** PUBLIC_SCREENS covers only privacy, terms, community-guidelines, seller-agreement and refund-policy. 'help' is neither public nor a guest route, so a signed-out visitor to https://brandthread.app/help is redirected to /splash or /sign-in. The in-app 'Contact' button opens that URL in the external browser, where the user isn't signed in. No Support URL is chosen in any doc.
- **Why it costs money:** App Store Connect requires a Support URL that shows contact info. A login wall there is a 1.5 rejection, and buyers with order problems can't reach support, which turns into chargebacks.
- **Fix:** Add 'help' (or a static /support page with the email) to PUBLIC_SCREENS and use it as the Support URL. Point help.tsx:222 to mailto or the in-app form.
- **$ impact:** rejection risk + chargebacks

<a id="bt-375"></a>
### BT-375 · P1 · effort S · Sentry crash reporting off by default; only crash signal with no beta

- **Where:** n/a · `artifacts/mobile/lib/monitoringConfig.ts:33-41,docs/launch/dev-only-tasks.md:87-89`
- **Problem:** Sentry is a no-op unless EXPO_PUBLIC_SENTRY_DSN is set, and the docs call it 'optional'. Server SENTRY_DSN is also optional (env.ts:53).
- **Why it costs money:** With no TestFlight cohort, launch-day crashes in checkout or onboarding would be invisible, and every crash is a lost sale or seller.
- **Fix:** Make the DSN mandatory for the production EAS env (fail the verify script if it's missing) and set alerting.
- **$ impact:** ~$1-5k/mo of undetected checkout/onboarding failures

<a id="bt-376"></a>
### BT-376 · P1 · effort S · Agora not configured = Go Live broken, yet review notes tell reviewer to Go Live

- **Where:** seller-live · `artifacts/api-server/src/lib/env.ts:36-37,artifacts/api-server/src/routes/call.ts:109,REVIEW_NOTES.md:30-33`
- **Problem:** AGORA_APP_ID/AGORA_APP_CERTIFICATE are 'optional' env vars, and REVIEW_NOTES directs the reviewer to 'Go live with the seller account'.
- **Why it costs money:** If they're unset in production, the advertised feature fails during review (2.1).
- **Fix:** Add Agora to required production env, or remove live from the review notes and hide Go Live when it's unavailable.
- **$ impact:** rejection risk

<a id="bt-377"></a>
### BT-377 · P1 · effort S · Clerk new-device verification may block reviewer password sign-in

- **Where:** sign-in · `REVIEW_NOTES.md:11-19,artifacts/mobile/app/sign-in.tsx:278-310`
- **Problem:** Review notes promise the demo accounts 'need no email or SMS code'. Clerk production instances can require an email code when a password sign-in comes from a new device ('Client Trust'), and the reviewer can't read the demo mailbox. Nothing in the repo disables or verifies this.
- **Why it costs money:** If the reviewer can't sign in, the result is a 2.1 'unable to sign in' rejection.
- **Fix:** In the Clerk production dashboard, disable new-device verification, or use a demo email inbox the team can monitor. Test a sign-in from a fresh device.
- **$ impact:** rejection risk

<a id="bt-378"></a>
### BT-378 · P1 · effort S · expo-updates enabled but no update URL; OTA hotfix path for launch week absent

- **Where:** n/a · `artifacts/mobile/app.json:13-17,artifacts/mobile/app.config.js:30-35`
- **Problem:** `updates.enabled` is true, but `updates.url` is only derived from the missing projectId, so the first store binary can't receive OTA fixes even after projectId is added later (the URL is baked in at build time).
- **Why it costs money:** With no beta, OTA is the only same-day fix path for a launch-week JS crash in checkout. Without it, every fix waits 1-3 days in review.
- **Fix:** Run `eas init` before the first store build so the binary carries the URL, and verify with `pnpm run update:production` on the production channel.
- **$ impact:** days of downtime on any launch bug

<a id="bt-379"></a>
### BT-379 · P2 · effort S · Deletion screen doesn't tell subscribers to cancel App Store subscription

- **Where:** delete-account · `artifacts/mobile/app/delete-account.tsx:160-170,270-345`
- **Problem:** The screen never mentions subscriptions (grep 'subscription' finds no matches), even though sellers pay an auto-renewing RevenueCat/StoreKit plan. Apple keeps billing after account deletion.
- **Why it costs money:** Apple's deletion guidance asks apps with auto-renewing subscriptions to explain that billing continues and how to cancel. Deleted sellers who keep being charged file refund requests and chargebacks.
- **Fix:** For sellers with an active entitlement, add a notice with a 'Manage subscription' link (`Linking.openURL('https://apps.apple.com/account/subscriptions')`).
- **$ impact:** ~$200-500/mo in refunds/complaints

<a id="bt-380"></a>
### BT-380 · P2 · effort M · Account purge leaves community messages, live comments, Q&A, freelancer and AI data

- **Where:** server · `artifacts/api-server/src/lib/accountDeletion.ts:221-305`
- **Problem:** purgeAccount deletes DMs, posts and comments, but never touches community_messages, live_comments, product_questions, story_question_answers, giveaway_entries, freelancers/freelancer_jobs, design_studio_*, ai_generated_media, manufacturer_messages or search_log. Uploaded media objects in storage are never removed either. The deletion screen promises that 'posts, comments and messages will be permanently deleted' (delete-account.tsx:343).
- **Why it costs money:** Promising deletion and keeping the data breaks 5.1.1(v) and GDPR/CCPA. It means regulatory exposure and a possible rejection if probed.
- **Fix:** Add DELETE/anonymize statements for these tables plus an object-storage cleanup job, and add a test that lists every table with a user_id column.
- **$ impact:** regulatory exposure; low direct $

<a id="bt-381"></a>
### BT-381 · P2 · effort S · No moderator account provisioning step in launch docs

- **Where:** admin-reports · `artifacts/api-server/src/middlewares/requireAuth.ts:24-40,docs/launch/dev-only-tasks.md:1-100`
- **Problem:** requireModerator checks users.role in the DB. No dev-only task covers promoting Dev's account to moderator/admin in production, and invite-only.md also assumes moderator access.
- **Why it costs money:** Without a moderator nobody can resolve reports, and the 1.2 obligation fails on day 1.
- **Fix:** Add a step: set `users.role='admin'` for the owner account in production and confirm /admin-reports loads.
- **$ impact:** rejection/takedown risk

<a id="bt-382"></a>
### BT-382 · P2 · effort S · Invite-only mode would lock reviewers out; no code in review notes

- **Where:** access-code · `docs/launch/invite-only.md:6-26,artifacts/mobile/app/_layout.tsx:956-959,REVIEW_NOTES.md:9-24`
- **Problem:** If Dev turns on `inviteOnlySignup`, any new account (SIWA or Google, which reviewers often create) is routed to /access-code with a waitlist. REVIEW_NOTES has no invite code.
- **Why it costs money:** A reviewer stuck at an invite wall gets a 2.1 rejection, and invite-only also caps sign-ups.
- **Fix:** Keep the flag off for launch, or put a multi-use reviewer code in the notes.
- **$ impact:** rejection risk if enabled

<a id="bt-383"></a>
### BT-383 · P2 · effort S · Stale app-store-readiness.md: Boost FAIL now partially fixed, filter 'missing', 17+ rating

- **Where:** n/a · `docs/launch/app-store-readiness.md:23,28,32,docs/launch/app-store-metadata.md:66`
- **Problem:** Row 5 says there's no automated content filter, but contentModerator.ts exists. Row 10 says Boost uses Stripe, but there's now an IAP path behind a flag. Row 14 claims the legal text is placeholder-free, which is false. The metadata doc recommends '17+', a tier Apple replaced with 13+/16+/18+.
- **Why it costs money:** The team can make go/no-go decisions on wrong data.
- **Fix:** Rewrite readiness as one current checklist. Answer the new age-rating questionnaire (UGC, messaging, live video and AI likely mean 16+ or 18+), and reconcile it with the 13+ in-app age gate.
- **$ impact:** indirect

<a id="bt-384"></a>
### BT-384 · P2 · effort M · Age rating vs in-app 13+ gate mismatch

- **Where:** onboarding · `artifacts/api-server/src/routes/age.ts:16,artifacts/api-server/src/routes/auth.ts:654,docs/launch/app-store-metadata.md:66`
- **Problem:** The app admits 13-17 year-olds (only under-13 is blocked, and under-18 can't sell). The planned store rating is 17+/18+. If it's rated 18+, minors still use DMs, live and stranger messaging with no extra protections.
- **Why it costs money:** Apple rejects ratings that don't match content, and child-safety failures are the fastest takedown path.
- **Fix:** Pick 16+ or 18+ honestly in the new questionnaire. If minors are allowed, restrict adult-to-minor DMs and default minors to private.
- **$ impact:** takedown risk

<a id="bt-385"></a>
### BT-385 · P2 · effort S · Thread Cash pays users for 7 minutes of app time — guideline 3.2.2(x) risk

- **Where:** thread-cash · `artifacts/api-server/src/routes/thread-cash.ts:240-250,artifacts/mobile/components/thread-cash/ThreadCashActiveTimeTracker.tsx:24`
- **Problem:** A daily monetary credit for 420s of foreground time is compensation for 'using the app'. Guideline 3.2.2(x) forbids requiring users to take actions such as watching or engaging in order to receive monetary compensation. The current review notes don't explain the reward.
- **Why it costs money:** A rejection or forced removal of the buyer-retention mechanic Dev is paying for.
- **Fix:** Explain in review notes that it's a loyalty credit redeemable only for physical goods, and avoid the wording 'earn by using the app'. Have a fallback (daily check-in or purchase-based credit) ready behind a flag.
- **$ impact:** rejection risk; retention loop at stake

<a id="bt-386"></a>
### BT-386 · P2 · effort S · Story composer 'More tools' button just says 'coming soon'

- **Where:** buyer-story-create · `artifacts/mobile/app/buyer-story-create.tsx:1677-1683`
- **Problem:** The `...` button opens Alert 'Additional tools are coming soon.'
- **Why it costs money:** A placeholder in a core creation flow is a 2.1 risk.
- **Fix:** Remove the button.
- **$ impact:** rejection-risk polish

<a id="bt-387"></a>
### BT-387 · P2 · effort S · Seller 'Customer privacy' setting opens a 'Not available yet' page

- **Where:** customer-privacy · `artifacts/mobile/services/settingsCatalog.ts:225,artifacts/mobile/app/customer-privacy.tsx:14-24,artifacts/mobile/app/customer-events.tsx:13-23`
- **Problem:** The settings catalog lists 'Customer privacy' for sellers, and the screen just says 'Not available yet'. customer-events is the same.
- **Why it costs money:** Dead-end settings look unfinished to the reviewer and to sellers paying for a plan.
- **Fix:** Remove the catalog row and route until the feature is built.
- **$ impact:** rejection-risk polish

<a id="bt-388"></a>
### BT-388 · P2 · effort S · Instagram Stories share uses bundle-style appId, not a Facebook App ID

- **Where:** share sheets · `artifacts/mobile/lib/shareCard.ts:108`
- **Problem:** `appId: 'com.brandthread.app'`. Instagram Stories sharing requires a registered Facebook App ID, and this string doesn't even match the bundle id.
- **Why it costs money:** Sharing to IG Stories, the main free acquisition loop for fashion sellers, fails silently. (Cross-ref growth-loops.)
- **Fix:** Register a Meta app and use its numeric App ID.
- **$ impact:** ~$1-2k/mo of lost referral traffic

<a id="bt-389"></a>
### BT-389 · P2 · effort M · Product listings (seller UGC) not run through text/image moderation

- **Where:** products · `artifacts/api-server/src/routes/products.ts (no contentModerator/mediaModeration import)`
- **Problem:** Grepping for moderation imports shows posts, comments, reviews, communities, live and profiles are screened, but products.ts is not. Product titles, descriptions and photos are public UGC.
- **Why it costs money:** Prohibited or explicit listings stay up until reported, which risks 1.2 and Stripe's restricted-business rules.
- **Fix:** Run screenMedia/moderateText on product create/update and hold flagged listings for review.
- **$ impact:** Stripe/App Store risk

<a id="bt-390"></a>
### BT-390 · P2 · effort M · No startup/perf budget for 357 routes / 162k-line app with eager native routes

- **Where:** n/a · `artifacts/mobile/app.config.js:9-16,27,artifacts/mobile/app/_layout.tsx:1-1804`
- **Problem:** Async routes are enabled only for the web export. Native bundles all ~357 screens (design-canvas.tsx alone is 6.1k lines), plus Skia, Agora and Stripe. No measured cold-start time on a real device exists in docs, and images are never resized server-side (hardening-report.md:261-269, still open).
- **Why it costs money:** Slow cold start and heavy full-res images on mid-range iPhones hurt first-session conversion, and 2.4 watchdog kills at launch are rejections.
- **Fix:** Measure cold start on an iPhone 12-class device with the first build. Add a sharp resize pipeline on upload.
- **$ impact:** ~$1-3k/mo conversion

<a id="bt-391"></a>
### BT-391 · P3 · effort S · Privacy labels doc says birthday never sent; DOB is POSTed to /api/auth/age

- **Where:** onboarding · `artifacts/api-server/src/routes/age.ts:27-33,docs/app-store/privacy-labels.md:55`
- **Problem:** Onboarding sends dateOfBirth to the server, which reduces it to an age band and stores `users.ageBand`. The labels doc says the birthday 'is never sent to Brandthread'.
- **Why it costs money:** A small label inaccuracy and a minor review risk.
- **Fix:** Correct the doc. The age band is derived data, but say it's sent and immediately discarded.
- **$ impact:** negligible

<a id="bt-392"></a>
### BT-392 · P3 · effort S · Taxes & duties screen shows two 'Not available yet' cards

- **Where:** taxes-duties · `artifacts/mobile/app/taxes-duties.tsx:180-210`
- **Problem:** Tax-inclusive pricing and DDP duties render as 'Not available yet' cards.
- **Why it costs money:** These are honest, but they look incomplete to the reviewer, and international sellers can't offer DDP.
- **Fix:** Collapse them into a single info line ('Prices are tax-exclusive; international orders ship DAP').
- **$ impact:** small

<a id="bt-393"></a>
### BT-393 · P3 · effort S · General settings 'Change log' links to nonexistent brandthread.app/changelog

- **Where:** general-settings · `artifacts/mobile/app/general-settings.tsx:87,REVIEW_READINESS.md:47`
- **Problem:** The row opens https://brandthread.app/changelog, which has no page and redirects to sign-in on web.
- **Why it costs money:** A broken link is a 2.1 polish issue.
- **Fix:** Remove the row.
- **$ impact:** negligible

<a id="bt-394"></a>
### BT-394 · P3 · effort S · Server never enforces Terms acceptance before UGC

- **Where:** server · `artifacts/api-server/src/routes/auth.ts:432-453,artifacts/mobile/app/onboarding.tsx:669-696`
- **Problem:** Terms consent is client-side only (a checkbox in onboarding). Nothing on the server (posts, comments, communities, onboarding/complete) checks `termsAcceptedAt`, so an older client or an OAuth path that skips the checkbox can post UGC without agreeing.
- **Why it costs money:** Guideline 1.2 needs EULA agreement before UGC. This is a low but real risk, and it also weakens enforcement of fees.
- **Fix:** Reject POST /auth/onboarding/complete (and UGC routes) when termsVersion is null.
- **$ impact:** small

<a id="bt-395"></a>
### BT-395 · P3 · effort S · Product Q&A, freelancer profiles/reviews are public UGC but not reportable

- **Where:** product detail, freelancer-profile · `artifacts/api-server/src/lib/reportTargets.ts:17-20`
- **Problem:** REPORT_TARGET_TYPES omits product_question, freelancer and freelancer_review, yet these are public user text.
- **Why it costs money:** A reviewer looking for a 'report' option on Q&A won't find one (1.2).
- **Fix:** Add the target types and a Report action to those surfaces.
- **$ impact:** small

<a id="bt-396"></a>
### BT-396 · P3 · effort S · Contacts permission string promises 'never uploaded or stored' but opt-in stores hashes

- **Where:** find-friends-contacts · `artifacts/mobile/app.json:426-429,docs/app-store/privacy-labels.md:26`
- **Problem:** The NSContactsUsageDescription says the contact list 'is never uploaded or stored'. Hashes of contacts are uploaded to /api/social/contacts/match, and the user's own hashes are stored on opt-in.
- **Why it costs money:** Misleading purpose strings are a 5.1.1(ii) rejection risk if the feature flag is on during review.
- **Fix:** Reword to 'Contacts are converted to scrambled codes on your phone; only those codes are sent to find matches and are not kept.'
- **$ impact:** small

<a id="bt-397"></a>
### BT-397 · P3 · effort S · Physical-goods checkout untestable by reviewer (live Stripe keys, no test path)

- **Where:** buyer-checkout · `REVIEW_NOTES.md:43-50`
- **Problem:** Reviewers are told test cards are rejected and that they can 'open the checkout… without paying'. Apple sometimes asks for a complete purchase flow to verify that the IAP-vs-3.1.3 split is correct.
- **Why it costs money:** A possible 2.1 'could not complete purchase' follow-up delays approval.
- **Fix:** Seed a 100%-off discount code or a $0.50 product for the reviewer, and say so in the notes.
- **$ impact:** small delay risk

## Seller tools, tier gating & retention

48 findings: 1 P0 · 20 P1 · 23 P2 · 4 P3

<a id="bt-398"></a>
### BT-398 · P0 · effort S · Starter sellers' Home dashboard always fails: it calls Growth-only manufacturer API

- **Where:** (tabs)/index (SellerHomeCommerceDashboard) · `artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:387-397,909-916, artifacts/api-server/src/routes/manufacturers.ts:77,1357`
- **Problem:** loadSecondaryData runs orders, inventory, quote requests, sample orders and GET /api/manufacturers/threads in one Promise.all. GET /manufacturers/threads requires requirePlan('growth'), so on Starter it returns 403 and the whole Promise.all rejects. Every Starter seller gets 'Some dashboard data couldn't load' permanently, and loses recent orders, the 'orders to ship', low stock and returns counts, and top products.
- **Why it costs money:** Starter is the entry tier most new sellers pick. The first screen they see after every open looks broken and hides orders to ship, which leads to late shipments, delivery-deadline auto-refunds and churn in the trial.
- **Fix:** Use Promise.allSettled for the hub calls (or skip the manufacturer calls when plan < growth) so a 403 on one optional tile never wipes out the order and inventory tiles.
- **$ impact:** ~$2-5k/mo: if 30-50% of ~400 sellers are on Starter at $29 and even 15% churn in the trial over a broken home screen, plus refunds from missed shipments

<a id="bt-399"></a>
### BT-399 · P1 · effort S · Package presets API is never mounted, so saved box sizes silently fail

- **Where:** fulfill-order · `artifacts/api-server/src/routes/index.ts:153, artifacts/mobile/app/fulfill-order.tsx:131,209, artifacts/mobile/services/orderService.ts:409-424`
- **Problem:** packagePresetsRouter is imported at index.ts:153 but no router.use('/package-presets', ...) exists, so every /api/package-presets call returns 404. fulfill-order swallows the list error (.catch(() => [])) and creating a preset fails. Only the integration test mounts the router itself.
- **Why it costs money:** Sellers have to type package dimensions on every label. Repeat shipping friction is a top reason small sellers leave marketplaces, and wrong typed weights cause carrier adjustments.
- **Fix:** Add router.use('/package-presets', packagePresetsRouter) next to /shipping-labels (the router already applies requireAuth and teamContext itself).
- **$ impact:** ~$500-1k/mo in reduced fulfillment churn and fewer mis-weighted labels

<a id="bt-400"></a>
### BT-400 · P1 · effort M · Bulk 'Print labels' buys the cheapest label for a hard-coded 1 lb box, falling back to the buyer's address as sender

- **Where:** fulfill-batch · `artifacts/mobile/app/fulfill-batch.tsx:71-81`
- **Problem:** handlePrintLabels quotes every order at weight 1, 10x8x4 and buys the cheapest rate with no confirmation step and no total cost shown. fromAddress falls back to order.customer.shippingAddress, so a seller with no from-address buys labels that ship from the buyer to the buyer. Only the first label is shared (line 92); the others must be opened one by one.
- **Why it costs money:** Under-declared weights cause carrier adjustments billed to Brandthread's Shippo account. Wrong-origin labels are wasted spend plus a refund. Bulk shipping is the feature that keeps volume sellers, and right now it is risky.
- **Fix:** Require a from-address and a chosen package preset (or each product's weight from parcel-suggestion) before buying. Show a confirm sheet with the total cost. Merge the label PDFs into one file to print.
- **$ impact:** ~$300-1.5k/mo in carrier adjustments and wasted labels at a few thousand labels/mo

<a id="bt-401"></a>
### BT-401 · P1 · effort M · Shippo carrier adjustments are not handled, so the platform absorbs re-weigh charges

- **Where:** server · `artifacts/api-server/src/lib/shippo.ts:1-20, artifacts/api-server/src/routes/webhooks-shippo.ts:63-80`
- **Problem:** All labels are bought through Brandthread's single Shippo account (Replit connector 'shippo', not a seller account). The label price is taken from order funds at purchase, but there is no handling of carrier adjustments or invoices: the webhook handles tracking only and no-ops on other events. Carrier surcharges for wrong weight or size land on Brandthread.
- **Why it costs money:** Re-weigh adjustments are a well-known cost leak on platform-owned label accounts. Combined with the 1 lb default in batch fulfillment, every heavy package costs Brandthread money.
- **Fix:** Ingest Shippo invoices/adjustments (or poll the transactions API) and recover the adjustment from the seller's balance through the existing recoverLabelCost path, with an in-app notice.
- **$ impact:** ~$200-1k/mo assuming 3-10% of labels get a $3-8 adjustment

<a id="bt-402"></a>
### BT-402 · P1 · effort S · Sellers get no notification when a buyer leaves a review

- **Where:** server · `artifacts/api-server/src/routes/reviews.ts:191-270`
- **Problem:** POST /api/reviews inserts the review and returns. There is no publishNotification or email (reviews.ts never imports notifications-feed). Replies at :336 don't notify the buyer either. The notification-type list has no new_review type.
- **Why it costs money:** Bad reviews go unanswered and good ones go unshared. Fast replies to reviews protect conversion, and a 'You got a 5-star review' push is one of the strongest reasons sellers re-open the app.
- **Fix:** After the insert, call publishNotification({userId: sellerId, category:'reviews', type:'review_received', targetType:'review'}). Add the matching buyer notification on seller reply.
- **$ impact:** ~$500-1k/mo through better seller engagement and review-driven conversion

<a id="bt-403"></a>
### BT-403 · P1 · effort S · Failed payouts are silent: payout.failed is not handled

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:357-372,1821-1860`
- **Problem:** The Stripe webhook switch handles payout.paid (payout_sent push plus email) but has no case for payout.failed or payout.canceled. A grep for payout.failed / payout_failed finds nothing.
- **Why it costs money:** A seller whose bank rejects a payout believes they were paid until they check. 'Where is my money' is the top churn and support-cost trigger in marketplaces, and it blocks the next payout.
- **Fix:** Handle payout.failed: notify the seller (push and email) with failure_code, link to payout-setup, and log it on the payout row.
- **$ impact:** ~$300-800/mo in support cost and churn among affected sellers

<a id="bt-404"></a>
### BT-404 · P1 · effort S · No new-order email to sellers; order alerts are push or in-app only

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1297-1310, artifacts/api-server/src/lib/brandthreadEmail.ts:293-434`
- **Problem:** On a paid order, sellers get only publishNotification (in-app plus push). brandthreadEmail has buyer order confirmation, shipping, return and payout emails, but no seller 'You have a new order' email.
- **Why it costs money:** Sellers with push off, a reinstalled app or a backgrounded token miss orders. Missed orders hit the delivery-deadline auto-refund (lost GMV and commission) and are the main 'this app doesn't work' churn reason.
- **Fix:** Add sendSellerNewOrderEmail(order) next to sendOrderConfirmationForOrder, respecting notification prefs (new_orders), with a digest option for high-volume sellers.
- **$ impact:** ~$1-2k/mo: about 1-2% of GMV auto-refunded for missed orders at ~$500k GMV is $5-10k GMV, plus commission and churn

<a id="bt-405"></a>
### BT-405 · P1 · effort M · No weekly performance summary for sellers

- **Where:** server · `artifacts/api-server/src/index.ts:7-34, artifacts/api-server/src/jobs/`
- **Problem:** The jobs folder has abandoned cart, trial reminder, dispute, live reminders and similar jobs, but nothing that sends sellers a weekly recap (sales, views, top product, orders to ship, payouts). A grep for weekly/digest/summary in jobs and lib turns up only payout-schedule weekly anchors.
- **Why it costs money:** A weekly 'you made $X with Brandthread' email is the cheapest way to justify a subscription and catch quiet sellers before they cancel. Without it, sellers with slow weeks just churn.
- **Fix:** Add jobs/sellerWeeklySummary.ts (Monday 9am local) that reuses lib/sellerSnapshot.ts and analytics home numbers. Send through brandthreadEmail plus one push, with an extra 'zero sales: try these 3 things' version.
- **$ impact:** ~$1-3k/mo: a 1-3 point cut in monthly seller churn on ~$25k subscription MRR

<a id="bt-406"></a>
### BT-406 · P1 · effort M · No churn defenses: no cancel survey, pause plan, downgrade offer or win-back

- **Where:** subscription · `artifacts/mobile/app/subscription.tsx:173,212-218,478-480`
- **Problem:** 'Manage or cancel subscription' opens the Stripe portal or the App Store URL directly. There is no reason prompt, no 'downgrade to Starter instead', no 'pause for a month' (useful with vacation mode) and no win-back job. A grep for cancel survey, pause_collection or winback finds nothing; automation.tsx even advertises win-backs as 'coming'.
- **Why it costs money:** Save flows usually keep 10-20% of would-be cancellers. With no data on why sellers leave, the product can't fix it.
- **Fix:** Before opening the portal or App Store link, show a one-screen reason picker with a downgrade or pause offer, and log the reason server-side. For Stripe subscribers, offer pause_collection.
- **$ impact:** ~$1-2.5k/mo if 10-20% of ~$10k/mo of gross cancellations are saved

<a id="bt-407"></a>
### BT-407 · P1 · effort S · More > Customers opens a dead 'Not configurable' screen; the real customer list is unreachable

- **Where:** (tabs)/more -> customer-accounts · `artifacts/mobile/app/(tabs)/more.tsx:72, artifacts/mobile/app/customer-accounts.tsx:9-31, artifacts/mobile/app/customers.tsx`
- **Problem:** The Operations menu item 'Customers - Browse your customer list' routes to /customer-accounts, a placeholder that says 'Not configurable from the app'. The working customers.tsx (and customer-orders) has no inbound navigation except a back-fallback.
- **Why it costs money:** A customer list (repeat buyers, top spenders) is a core reason to keep paying for a seller tool, and right now it looks missing.
- **Fix:** Change the More route to '/customers'. Delete or hide customer-accounts, customer-events and customer-privacy (all 'not available' placeholders).
- **$ impact:** ~$200-500/mo in perceived value and retention

<a id="bt-408"></a>
### BT-408 · P1 · effort S · Mobile App Builder is a fake Pro feature with a dead CTA

- **Where:** mobile-app-builder · `artifacts/mobile/app/mobile-app-builder.tsx:9-40, artifacts/mobile/app/_layout.tsx:1684`
- **Problem:** The screen promises a 'drag-and-drop' branded iOS/Android app, native checkout and one-tap App Store publishing, with a 'Pro' badge. The CTA TouchableOpacity has no onPress and there is no backend. No inbound links exist, but it is registered as a route and deep-linkable.
- **Why it costs money:** Advertising a feature that doesn't exist is an App Store 2.1/2.3 rejection risk and a false-advertising problem if it is ever surfaced as a Pro perk.
- **Fix:** Delete the screen and its Stack.Screen entry (or replace it with nothing). Don't market it in plans.
- **$ impact:** Blocks launch if a reviewer reaches it; otherwise $0

<a id="bt-409"></a>
### BT-409 · P1 · effort S · Seller marketing emails share the auth MAIL_FROM sender, so one spammy seller can block OTP and password-reset email

- **Where:** server · `artifacts/api-server/src/lib/mailer.ts:164-182, artifacts/api-server/src/lib/emailMarketing/provider.ts:1-30`
- **Problem:** sendRawEmail sends seller campaigns from `${fromName} <${mailFromAddress()}>`, the same address and domain as auth, OTP, password reset, order and payout emails. Complaint and bounce reputation from any seller's campaign lands on the transactional sender.
- **Why it costs money:** If the domain gets throttled or blocklisted, sign-up verification and password resets fail for every user, which hits sign-up conversion across the whole platform.
- **Fix:** Send marketing from a separate subdomain (for example news.brandthread.app, MARKETING_MAIL_FROM env) on its own Resend domain or IP pool, and keep MAIL_FROM for transactional mail only.
- **$ impact:** Tail risk: a blocklist event could stall sign-ups for days (tens of % of a month's new sellers)

<a id="bt-410"></a>
### BT-410 · P1 · effort S · Email marketing is not tier-gated, and the 1,000/day/seller cap means Starter can cost about as much as it pays

- **Where:** email-campaigns · `artifacts/api-server/src/routes/index.ts:346, artifacts/api-server/src/lib/emailMarketing/sender.ts:18-26`
- **Problem:** /marketing/email has no requirePlan. Every seller, including an unpaid 'starter' fallback, can send up to EMAIL_DAILY_SEND_CAP (default 1000) emails a day. That is about 30k a month, roughly $25-30 of Resend volume, the same as the $29 Starter price.
- **Why it costs money:** This is unbounded per-seller variable cost, and the strongest marketing upgrade lever is given away free.
- **Fix:** Add per-plan monthly caps (for example Starter 500, Growth 10k, Pro 50k) in sender.ts via getVerifiedPlanAccess, and send PLAN_LIMIT_REACHED to the upsell modal.
- **$ impact:** ~$500-2k/mo between capped Resend cost and upgrade pull

<a id="bt-411"></a>
### BT-411 · P1 · effort S · Email audience can only grow from a web-store form; there is no opt-in in app checkout or follow

- **Where:** email-audience · `artifacts/api-server/src/lib/emailMarketing/audience.ts:1-10, artifacts/api-server/src/routes/email-marketing-public.ts:1-8,70, artifacts/api-server/src/routes/store.ts:451`
- **Problem:** The audience docs say recipients come only from email_subscribers and that checkout has no opt-in box. subscribeEmail is called only from the public web store form (/api/public/stores/:slug/subscribe). In-app buyers, the main channel, can never join a seller's list.
- **Why it costs money:** The email marketing feature (compose, results, settings, audience) sends to near-empty lists, so it can't drive repeat sales or justify a paid tier.
- **Fix:** Add a 'Get emails from {store}' consent checkbox at checkout and on Follow that calls subscribeEmail with source 'checkout' or 'follow' (unchecked by default).
- **$ impact:** ~$1-3k/mo GMV-driven commission from repeat-purchase campaigns, plus upgrade value

<a id="bt-412"></a>
### BT-412 · P1 · effort S · Boosts are Pro-only while ad campaigns, featured slots and Meta ads are open to all

- **Where:** boost, featured-slot, design-campaign · `artifacts/api-server/src/routes/index.ts:385-390, artifacts/api-server/src/routes/iap-promotions.ts:98-99, artifacts/mobile/lib/sellerPlans.ts:58`
- **Problem:** /boosts and boost IAP verify use requirePlan('pro'), so Starter and Growth sellers can't pay to boost. /ad-campaigns, /featured-slots and /meta-ads have no plan gate, and plans.tsx markets 'Boost and promotion management' as Pro-only. The rules are inconsistent and block one paid product.
- **Why it costs money:** Boosts are pay-per-use ad revenue. Most sellers (Starter/Growth) are the ones who most need reach and can't buy it, so a high-margin line is left unsold.
- **Fix:** Let every paying tier buy boosts (remove requirePlan('pro') from /boosts). Make Pro's perk a discount or bonus reach on boosts, and line up plans.tsx copy with the server rules.
- **$ impact:** ~$1-4k/mo if 10-20% of 300 non-Pro sellers spend ~$30-60/mo on boosts

<a id="bt-413"></a>
### BT-413 · P1 · effort S · Live selling is Pro-only ($199), so the live feed will be empty at launch

- **Where:** seller-go-live · `artifacts/api-server/src/routes/live.ts:48,89,350,399, artifacts/api-server/src/routes/live-commerce.ts:29,33,175`
- **Problem:** Starting, ending, tagging products, pinning and scheduling lives all need requirePlan('pro'). At launch few sellers will be on $199, so buyers will mostly see an empty Live surface.
- **Why it costs money:** Live shopping converts very well, but only with supply. Limiting it to the smallest tier makes the buyer-side feature look dead and loses live GMV and commission.
- **Fix:** Move live hosting to Growth with a monthly minutes cap (for example 4h on Growth, unlimited on Pro), metered from live session durations, to control Agora cost.
- **$ impact:** ~$1-3k/mo in commission on extra live GMV, plus upgrades from Starter to Growth

<a id="bt-414"></a>
### BT-414 · P1 · effort S · Go Live and Boost show a generic error on PLAN_REQUIRED instead of an upgrade prompt

- **Where:** seller-go-live, boost · `artifacts/mobile/app/seller-go-live.tsx:163-164, artifacts/mobile/app/boost.tsx:742-745`
- **Problem:** When the server returns 403 PLAN_REQUIRED, seller-go-live shows Alert 'Could not start live' and boost shows Alert 'Error'. Neither uses getEntitlementRejection or PlanUpsellModal (used only in team, manufacturer, tech-pack and analytics-customers/cohorts). There is no client pre-check, so sellers fill in the whole form before hitting the wall.
- **Why it costs money:** The moment a seller wants a paid feature is the best moment to upsell, and right now it reads as a bug.
- **Fix:** Check useSubscriptionPlan on entry and show a locked state, and on 403 use getEntitlementRejection to open PlanUpsellModal with requiredPlan set.
- **$ impact:** ~$500-2k/mo in upgrades at the moment of intent

<a id="bt-415"></a>
### BT-415 · P1 · effort S · Giveaway rules template lacks the Apple disclaimer required by App Store 5.3

- **Where:** seller-giveaway-create · `artifacts/api-server/src/lib/giveaways.ts:63-80,215`
- **Problem:** The rules template says 'not sponsored, endorsed or administered by Brandthread', but it never says Apple is not a sponsor or involved. Guideline 5.3.3 requires that for in-app sweepstakes. The seller can also edit the rules freely and remove disclaimers.
- **Why it costs money:** This is a likely rejection reason when a reviewer opens a giveaway, and the launch goes straight to the App Store with no beta.
- **Fix:** Append a fixed, non-editable footer server-side ('Apple is not a sponsor of, and is not involved in, this giveaway...') to every giveaway's rules at render time.
- **$ impact:** Can block launch (rejection delays all revenue)

<a id="bt-416"></a>
### BT-416 · P1 · effort S · Live checkout makes buyers type their full address and phone during the stream

- **Where:** buyer-live · `artifacts/mobile/app/buyer-live.tsx:92-98,386-422`
- **Problem:** Buying in a live works (createSession and verifySession with liveStreamId), but street, city, region, postal code and phone start empty and must be typed while watching. Saved buyer addresses (buyer-addresses) and saved payment methods aren't prefilled.
- **Why it costs money:** Live purchases are impulse buys, and every extra field loses buyers, which cuts the GMV that makes Pro/live worth paying for.
- **Fix:** Prefill from the default saved address (api.buyer.addresses) and the user's phone, and collapse the form into 'Ship to {address} · Change'.
- **$ impact:** ~$500-1.5k/mo in commission if it lifts live checkout conversion 20-40%

<a id="bt-417"></a>
### BT-417 · P1 · effort S · The seller drops list is unreachable; sellers can create a drop but not find it again

- **Where:** seller-drops · `artifacts/mobile/app/seller-drops.tsx:1-3,52, artifacts/mobile/components/SellerCreateFAB.tsx:44`
- **Problem:** The create FAB opens /seller-drop-create, but the list screen /seller-drops has no inbound link anywhere (only its _layout registration). Sellers can't get back to edit, monitor or close drops, and the drop wallet (held preorder funds) is hard to reach.
- **Why it costs money:** Drops and preorders are a strong sales mechanic. Sellers who can't manage them abandon the feature or file support tickets about held money.
- **Fix:** Add 'Drops' to the Store section in More and a 'Your drops' row in the Products tab.
- **$ impact:** ~$300-1k/mo in drop GMV commission and fewer support tickets

<a id="bt-418"></a>
### BT-418 · P1 · effort M · Most seller growth tools have no server tier gate (drops, giveaways, discounts, email, push, store domain)

- **Where:** server · `artifacts/api-server/src/routes/index.ts:233,298-299,329,346,384-399`
- **Problem:** Server gates exist only for AI design (growth), Manufacturer Hub (growth), advanced and customer analytics (pro), live hosting (pro) and boosts (pro), plus product (25) and team-seat limits. Drops and preorders, giveaways, discounts, sales, email marketing, push broadcasts, featured slots, ad campaigns, gift cards, store domain, Shopify, growth links and pixels are open to all, including unpaid 'starter'.
- **Why it costs money:** Growth's only real value is AI and the manufacturer hub. Brands that don't design with AI have no reason to move up from $29, which caps average revenue per seller.
- **Fix:** Suggested tiers. Starter: storefront, 25 products, discounts, sales, 1 push/week, 500 emails. Growth: unlimited products, drops/preorders, giveaways, email 10k, push 3/week, custom domain, Shopify sync, live 4h. Pro: live unlimited, advanced analytics, team unlimited, boost discount. Enforce with requirePlan or getVerifiedPlanAccess.
- **$ impact:** ~$2-6k/mo if 10-15% of Starter sellers move to Growth (+$50 each)

<a id="bt-419"></a>
### BT-419 · P2 · effort S · No packing slips or pick list in batch fulfillment; slips are one order at a time

- **Where:** fulfill-batch · `artifacts/mobile/app/fulfill-batch.tsx:60-110, artifacts/mobile/lib/packingSlip.ts:18, artifacts/mobile/app/fulfill-order.tsx:342-347`
- **Problem:** Packing slips exist only inside fulfill-order, one order per PDF. fulfill-batch offers only 'Print labels' and 'Mark shipped': there are no batch slips and no combined pick list.
- **Why it costs money:** Sellers with 20+ orders a day (the ones paying for Growth/Pro) need batch slips and pick lists. Without them, operations-heavy sellers go to Shopify instead.
- **Fix:** Add 'Print packing slips' to fulfill-batch, reusing buildPackingSlipHtml over the selected orders in one PDF, plus a pick-list page that totals quantity per SKU.
- **$ impact:** ~$300-800/mo in retained higher-volume sellers

<a id="bt-420"></a>
### BT-420 · P2 · effort M · Vacation mode keeps billing the full plan, which pushes sellers to cancel

- **Where:** vacation-mode · `artifacts/api-server/src/routes/vacation.ts:1-74, artifacts/api-server/src/lib/sellerAvailability.ts:13`
- **Problem:** Vacation mode correctly blocks checkout (buyer.ts:442,669, guest-checkout.ts:169, cartCheckout), but it is not tied to billing. A seller pausing for a month still pays $29-$199.
- **Why it costs money:** Seasonal and drop-based brands cancel instead of pausing, and many don't come back.
- **Fix:** When vacation is turned on for 2 weeks or more, offer a low-cost 'paused' plan (or Stripe pause_collection) that keeps the store and data, and auto-resume when vacation ends.
- **$ impact:** ~$300-800/mo in sellers kept instead of cancelled

<a id="bt-421"></a>
### BT-421 · P2 · effort S · Six analytics screens are orphaned or stubbed (sales, products, customers, marketing, production, profit)

- **Where:** analytics-sales, analytics-products, analytics-customers, analytics-marketing, analytics-production, analytics-profit · `artifacts/mobile/components/analytics/AnalyticsReportsList.tsx:11-19, artifacts/mobile/app/_layout.tsx:1487-1494, artifacts/mobile/services/analyticsService.ts:144-149`
- **Problem:** Of the 14 analytics-* screens, only product-stats, content, audience, goals, export, advanced and cohorts are linked from the Reports list, plus analytics-store from Home. A static search finds no inbound links to analytics-sales, analytics-products, analytics-customers, analytics-marketing, analytics-production or analytics-profit. Four of those call stubs that throw. The linked screens use real APIs; preview fixtures are only active in dev builds (lib/devPreview.ts).
- **Why it costs money:** These are maintenance and review cost with no seller value. A deep link or App Review crawl lands on 'not available yet' screens (guideline 2.1 risk).
- **Fix:** Remove the four stubbed screens from _layout (keep the files if needed). Either link analytics-sales and analytics-customers from Reports (they call real endpoints) or delete them.
- **$ impact:** Indirect: reduces App Review rejection risk and dev time

<a id="bt-422"></a>
### BT-422 · P2 · effort S · Automation screen is a 'coming soon' placeholder; restock alerts and win-backs don't exist

- **Where:** automation · `artifacts/mobile/app/automation.tsx:15-27`
- **Problem:** The only content is EmptyState 'Automations are coming - Soon you'll set restock alerts, win-backs and more.' There is no backend. It is registered as a route with no inbound links.
- **Why it costs money:** Restock alerts (waitlist exists server-side) and win-back emails are the automations that actually raise repeat revenue. The placeholder adds review risk without value.
- **Fix:** Remove the route for launch. After launch, build 2 real automations on existing parts: abandoned cart (job exists) and win-back (email marketing sender), and make them the Growth-tier hook.
- **$ impact:** Removal: $0 and lower review risk; building automations later: ~$1k+/mo as an upgrade driver

<a id="bt-423"></a>
### BT-423 · P2 · effort S · Custom domains can be claimed by anyone before verification (unique constraint enables squatting)

- **Where:** server · `artifacts/api-server/src/routes/store.ts:1024-1037, lib/db/src/schema/index.ts:2004`
- **Problem:** POST /api/store/domains inserts any domain string with no format validation, and storefront_custom_domains.domain is UNIQUE. The first seller to type 'nike.com' or a rival brand's domain blocks the real owner from ever adding it.
- **Why it costs money:** Brand-squatting disputes cost support time and hurt the brands Brandthread most wants to sign.
- **Fix:** Validate the hostname format. Allow multiple unverified claims (a partial unique index only WHERE verified), and expire unverified claims after 7 days.
- **$ impact:** ~$100-300/mo in support and lost brand signups

<a id="bt-424"></a>
### BT-424 · P2 · effort S · Email campaign content isn't moderated (push broadcasts and giveaways are)

- **Where:** email-campaign-compose · `artifacts/api-server/src/routes/email-marketing.ts:205-340, artifacts/api-server/src/lib/sellerPushBroadcast.ts:25, artifacts/api-server/src/lib/giveaways.ts:241`
- **Problem:** Seller push broadcasts and giveaways run evaluateContent, but the email campaign create, update and send paths never call it (grep evaluateContent / moderat in email-marketing finds nothing). Phishing links and scam copy go out from Brandthread's domain.
- **Why it costs money:** This is the fastest way to get the shared sending domain flagged (see the MAIL_FROM finding) and it carries legal liability.
- **Fix:** Run evaluateContent on subject, preheader and text blocks at send time and reject or hold on 'reject'. Allowlist link domains or rewrite links through a click tracker.
- **$ impact:** Tail-risk protection for deliverability; ~$0 direct

<a id="bt-425"></a>
### BT-425 · P2 · effort S · Marketing tab leads with Klaviyo, which only reads counts and syncs nothing

- **Where:** (tabs)/marketing · `artifacts/mobile/app/(tabs)/marketing.tsx:91-93,145-170, artifacts/api-server/src/routes/integrations.ts:31-108`
- **Problem:** The top stat chips show Klaviyo email and SMS subscriber counts (0 for everyone not on Klaviyo), and the main CTA is 'Connect Klaviyo'. The Klaviyo integration only checks the key and refreshes subscriber counts. It never pushes Brandthread customers, orders or events to Klaviyo. The native, working email marketing is buried further down.
- **Why it costs money:** Prime space goes to a no-op integration while the real retention tools (email campaigns, push broadcast) are hidden, so sellers don't find what they pay for.
- **Fix:** Replace the chips with native numbers (email subscribers, push-reachable followers) and lead with 'Send an email' and 'Send a push'. Move Klaviyo under Integrations, or make it real by syncing profiles and orders.
- **$ impact:** ~$300-800/mo from more use of the retention tools

<a id="bt-426"></a>
### BT-426 · P2 · effort S · Klaviyo private API keys are stored in plaintext; any team role can change them

- **Where:** integrations/klaviyo · `lib/db/src/schema/index.ts:831, artifacts/api-server/src/routes/integrations.ts:31-50,110`
- **Problem:** klaviyo_integrations.api_key is plain text (Shopify tokens use SHOPIFY_TOKEN_ENCRYPTION_KEY and Meta uses metaCrypto). The router has requireAuth but no requireRole or requirePermission, so a 'viewer' team member can connect or delete the key.
- **Why it costs money:** A DB leak exposes sellers' whole Klaviyo customer lists, which is a breach-notification event.
- **Fix:** Encrypt with the metaCrypto/shopifyCrypto pattern and add requirePermission('marketing') to the mutating routes.
- **$ impact:** Tail-risk; ~$0 direct

<a id="bt-427"></a>
### BT-427 · P2 · effort S · Campaigns empty state says 'Create a Meta ad' but opens Brandthread's internal ad campaigns

- **Where:** (tabs)/marketing · `artifacts/mobile/app/(tabs)/marketing.tsx:183-191, artifacts/mobile/app/design-campaign.tsx:322,597, artifacts/api-server/src/routes/ad-campaigns.ts:1-22`
- **Problem:** The empty state reads 'Create a Meta ad to put your products in front of new buyers', but the button opens design-campaign, which creates and pays for internal /api/ad-campaigns (Stripe Checkout), not Meta. Real Meta ads live separately under Studio > Meta Ads (meta-ads-manage) and depend on META_APP_ID and Meta App Review.
- **Why it costs money:** Sellers think they are buying Facebook/Instagram ads and get in-app placements, which brings refund requests and chargebacks on ad spend.
- **Fix:** Change the copy to 'Promote on Brandthread' for ad-campaigns, and route 'Meta ad' wording only to meta-ads-connect.
- **$ impact:** ~$100-500/mo in avoided ad-spend refunds

<a id="bt-428"></a>
### BT-428 · P2 · effort S · Plans page says Growth has no team, but the server grants Growth 3 seats

- **Where:** plans · `artifacts/mobile/lib/sellerPlans.ts:43,55, artifacts/api-server/src/lib/planCatalogue.ts:24-27`
- **Problem:** SELLER_PLANS lists 'Team operations' under Growth notIncluded and 'Team roles' as a Pro feature. PLAN_CATALOGUE gives Growth teamSeats: 3 (Pro unlimited, Starter 0).
- **Why it costs money:** Either Growth sellers who want a team upgrade to Pro for nothing (a trust issue later), or they never learn Growth already covers them. Mismatched plan pages also draw App Review and consumer-law scrutiny.
- **Fix:** Pick one rule and generate plan bullets from the server's /seller/subscription/perks, including team seats and the product limit.
- **$ impact:** ~$200-600/mo in correctly sold upgrades

<a id="bt-429"></a>
### BT-429 · P2 · effort S · Starter's 25-product cap isn't in the plan features

- **Where:** plans · `artifacts/mobile/lib/sellerPlans.ts:22-29, artifacts/api-server/src/lib/planCatalogue.ts:16-21`
- **Problem:** The server caps Starter at products: 25 (enforced in products.ts, product-bulk.ts and product-import.ts), but the Starter features list only says 'Storefront, products, checkout, and orders'. Only a code comment in plans.tsx mentions 25.
- **Why it costs money:** Sellers hit a surprise wall mid-import, which feels like a bait-and-switch and causes churn or refunds instead of an upgrade.
- **Fix:** Add 'Up to 25 products' to Starter and 'Unlimited products' to Growth/Pro, and show 'X/25 products' in the Products tab with an upgrade CTA at 20.
- **$ impact:** ~$300-800/mo in upgrades instead of churn at the cap

<a id="bt-430"></a>
### BT-430 · P2 · effort S · Push broadcasts are not tier-differentiated (1 per 24h for everyone)

- **Where:** seller-push-broadcast · `artifacts/api-server/src/lib/sellerPushBroadcast.ts:28-31, artifacts/api-server/src/routes/index.ts:298`
- **Problem:** Push broadcasts are well built (atomic 1-per-24h limit, moderation, audience filtering, mute and quiet hours), but they are the same for all tiers, including an unpaid starter.
- **Why it costs money:** Direct push to followers is one of the strongest sales tools and isn't used as an upgrade lever, and 7 blasts a week from every seller risks buyer push fatigue and opt-outs.
- **Fix:** Make it plan-based, for example Starter 1/week, Growth 3/week, Pro 1/day, using getVerifiedPlanAccess in the claim step.
- **$ impact:** ~$300-1k/mo in upgrades, and protects buyer push opt-in rates

<a id="bt-431"></a>
### BT-431 · P2 · effort M · Live streaming has no usage cap or metering (Agora minutes cost is open-ended)

- **Where:** server · `artifacts/api-server/src/routes/live.ts:62,89-110,264-310`
- **Problem:** Host tokens last 2h and can be reminted, and viewers join without a viewer or minutes cap. There is no per-seller monthly live-minutes accounting, and cloud recording (AGORA_RECORDING_*) adds storage and processing cost.
- **Why it costs money:** Agora bills per viewer-minute. A popular Pro seller (or a runaway session) can cost more than the $199 plan.
- **Fix:** Record session minutes times peak viewers, enforce per-plan monthly host minutes, auto-end sessions with no host heartbeat, and alert ops above a cost threshold.
- **$ impact:** Caps tail cost; a single 3h, 1k-viewer stream is ~$180-700 in Agora minutes

<a id="bt-432"></a>
### BT-432 · P2 · effort S · More > Integrations skips the hub and opens Klaviyo; the Shopify connection isn't listed

- **Where:** (tabs)/more, integrations/index · `artifacts/mobile/app/(tabs)/more.tsx:99, artifacts/mobile/app/integrations/index.tsx:28-32`
- **Problem:** The Integrations menu item goes straight to /integrations/klaviyo. The hub (integrations/index) is unreachable and lists only Klaviyo and Stripe, not Shopify (the real order-forwarding and import integration at integrations/shopify-fulfillment).
- **Why it costs money:** Shopify migrants are the highest-value sellers. If they can't find the Shopify connection, they don't move their catalog or fulfillment over.
- **Fix:** Route More > Integrations to /integrations and add Shopify (status from api.shopify.status) to INTEGRATION_DEFS.
- **$ impact:** ~$300-800/mo in activated Shopify-migrant sellers

<a id="bt-433"></a>
### BT-433 · P2 · effort M · Shopify integration is a one-time import with no inventory sync, so dual-channel sellers oversell

- **Where:** shopify-import · `artifacts/api-server/src/routes/webhooks-shopify.ts:63-85, artifacts/api-server/src/lib/shopify/productImport.ts:88-122`
- **Problem:** Shopify webhooks handle only app/uninstalled, fulfillments/create|update and orders/cancelled. There is no inventory_levels/update or products/update handling, so stock imported once drifts as soon as the seller sells on Shopify.
- **Why it costs money:** Oversells trigger sold-out auto-refunds and bad buyer experiences, and the sellers most likely to pay for Growth/Pro (already on Shopify) are hit hardest.
- **Fix:** Subscribe to inventory_levels/update and products/update for linked variants and update productVariants.stock through stockReservation's change pipeline.
- **$ impact:** ~$300-1k/mo in avoided refunds and kept dual-channel sellers

<a id="bt-434"></a>
### BT-434 · P2 · effort S · Home 'messages to answer' counts only manufacturer threads, not buyer DMs

- **Where:** (tabs)/index · `artifacts/mobile/lib/sellerDashboardStats.ts:30, artifacts/mobile/components/SellerDashboardActionNeeded.tsx:22`
- **Problem:** The 'N messages to answer - Buyers and manufacturers waiting on you' tile is built from manufacturer thread unreadCount only, but taps open /seller-inbox (buyer DMs). Unanswered buyer DMs never show, and on Starter the count is broken by the same 403.
- **Why it costs money:** Buyer pre-purchase questions go unanswered, which costs conversions and makes sellers think the app doesn't drive sales.
- **Fix:** Add buyer conversation unread counts (the conversations unread endpoint used by the More tab badge) to toAnswer.
- **$ impact:** ~$200-600/mo in commission from answered pre-sale DMs

<a id="bt-435"></a>
### BT-435 · P2 · effort M · Orders list has no pagination, and Home reloads every order on each focus

- **Where:** (tabs)/orders, (tabs)/index · `artifacts/api-server/src/routes/orders.ts:81-135, artifacts/mobile/components/SellerHomeCommerceDashboard.tsx:388,408-409`
- **Problem:** GET /api/orders returns every order for the seller (multi-join, group by, no limit or cursor). The dashboard calls it on every load just to count orders and show 5 recent ones.
- **Why it costs money:** Successful sellers (thousands of orders) get slow dashboards, so the best customers have the worst experience, and DB cost grows with GMV.
- **Fix:** Add cursor pagination (limit 50) plus a summary endpoint (counts by status, 5 recent) for the dashboard. Reuse lib/pagination.ts.
- **$ impact:** ~$100-500/mo in DB load and top-seller retention

<a id="bt-436"></a>
### BT-436 · P2 · effort S · Order numbers come from count(*) with no lock or unique index, so duplicates are possible

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:951-955, artifacts/api-server/src/routes/orders.ts:217-221, lib/db/src/schema/index.ts:453`
- **Problem:** Both order paths compute BT-{count+1} from SELECT count(*) inside a transaction with no row lock or advisory lock, and orders.order_number has no (owner_id, order_number) unique index. Two concurrent checkouts (a drop launch, or a live) get the same order number, and purged or deleted orders make numbers repeat.
- **Why it costs money:** Duplicate 'Order #BT-00042' rows cause fulfillment mistakes (double-shipping or missed shipments) during exactly the high-volume moments sellers care about.
- **Fix:** Use a per-owner counter row updated with UPDATE ... RETURNING (or pg_advisory_xact_lock(owner)) and add a unique index on (owner_id, order_number).
- **$ impact:** ~$100-400/mo in mis-fulfillment costs during drops/lives

<a id="bt-437"></a>
### BT-437 · P2 · effort S · No review-request prompt after delivery, so sellers struggle to get reviews

- **Where:** server · `artifacts/api-server/src/lib/delivery/notifications.ts:57, artifacts/api-server/src/routes/orders.ts:571`
- **Problem:** On delivery the buyer gets 'Your order was delivered!' with no 'Rate your order' CTA, and no follow-up job asks for a review a few days later. A grep for review_request, 'leave a review' and 'rate your' finds nothing.
- **Why it costs money:** New brands live or die by social proof. Few reviews means lower conversion for sellers, who then see no ROI from their subscription.
- **Fix:** Add a 'How was {product}?' notification and email 3 days after delivery, deep-linked to the review form (POST /api/reviews already validates delivered orders).
- **$ impact:** ~$500-1.5k/mo through higher conversion on reviewed products

<a id="bt-438"></a>
### BT-438 · P2 · effort S · Seller verification can create unlimited paid Stripe Identity sessions

- **Where:** seller-verification · `artifacts/api-server/src/routes/seller-verification.ts:48-140,152`
- **Problem:** POST /seller/verification/start has no attempt limit, cooldown, seller-role or plan check. After a /cancel or an expired session it creates a fresh document-plus-selfie VerificationSession every time. Any signed-in user, including buyers, can call it.
- **Why it costs money:** Stripe Identity charges per verification (about $1.50+ with selfie). A loop or abuse script burns money, and the verified badge is a natural paid-tier perk that is given away.
- **Fix:** Limit to 3 sessions per user per 30 days, require a seller account, and consider making the 'Verified' badge Growth+ (with Starter verification only for payouts risk).
- **$ impact:** Caps abuse; ~$50-300/mo normal, unbounded under abuse

<a id="bt-439"></a>
### BT-439 · P2 · effort S · Shippo depends on a Replit connector with no env check or health signal

- **Where:** server · `artifacts/api-server/src/lib/shippo.ts:1-20, artifacts/api-server/src/lib/env.ts:34-46`
- **Problem:** Label buying uses @replit/connectors-sdk proxy('shippo'). Nothing in env.ts or startup checks that the connector is linked, and only SHIPPO_WEBHOOK_SECRET is listed. Off Replit, or if the connector is unlinked, every rates and label call fails at runtime with 'Shipping provider request failed'.
- **Why it costs money:** If labels fail on launch day, every seller has to ship manually, and fulfillment is the first thing sellers judge.
- **Fix:** Add a startup or health check that calls a cheap Shippo endpoint (GET /carrier_accounts) and reports it in /healthz and the seller launch checklist.
- **$ impact:** Protects launch-day fulfillment; outage cost is ~1-2 days of seller trust

<a id="bt-440"></a>
### BT-440 · P2 · effort S · Featured slots can only be found from inside the Pro-only Boost screen

- **Where:** featured-slot · `artifacts/mobile/app/boost.tsx:1069, artifacts/api-server/src/routes/featured-slots.ts:155-265, artifacts/api-server/src/routes/index.ts:385-387`
- **Problem:** Featured Discover slots (paid, scarce, admin-approved) can be bought on every tier server-side, but the only entry point is a button in boost.tsx, whose data calls are Pro-gated. Non-Pro sellers effectively never find this paid product.
- **Why it costs money:** Featured placement is a high-margin, fixed-price inventory sale that goes unsold.
- **Fix:** Add 'Get featured on Discover' to the Marketing tab and More > Growth for all paying tiers.
- **$ impact:** ~$500-2k/mo if a few slots/week sell at $50-200

<a id="bt-441"></a>
### BT-441 · P2 · effort S · Buyer loyalty points run alongside Thread Cash: a second, overlapping reward cost

- **Where:** loyalty · `artifacts/api-server/src/routes/loyalty.ts:1-15,379-440, artifacts/mobile/app/buyer-settings-menu.tsx:97`
- **Problem:** A separate loyalty system (1 pt per $1, 500 per referral, 100 at signup, 100 pts = $1 off via loyaltyToken at checkout) is live and linked from buyer settings, on top of Thread Cash credits. The business model names only Thread Cash.
- **Why it costs money:** Two reward currencies mean double subsidy exposure and an unclear question of who funds the $1-off (Brandthread or the seller's price). Cross-ref thread-cash-referrals-abuse.
- **Fix:** Turn off loyalty earn and redeem for launch (hide the Rewards menu row) and keep Thread Cash as the single reward currency.
- **$ impact:** ~1% of GMV in unplanned discounts (~$500-5k/mo) if loyalty redemptions are platform-funded

<a id="bt-442"></a>
### BT-442 · P3 · effort S · Product bundles are overbuilt and dead: never shown to buyers or priced at checkout

- **Where:** product-bundles · `artifacts/api-server/src/routes/bundles.ts:1-20, artifacts/mobile/app/product-bundles.tsx, artifacts/mobile/app/product-bundle-edit.tsx:99-160`
- **Problem:** Sellers can create and edit bundles with a bundlePriceCents, but /api/bundles/public is never called by the buyer app, and checkout and cart code never reads bundles (grep for bundle in lib/money, buyer.ts and cart-db finds nothing). The list screen has no inbound link, and the half-done audit logged 404s for /product-bundles.
- **Why it costs money:** This is a maintenance surface that could mislead sellers into thinking a bundle discount is live.
- **Fix:** Remove the bundles screens from navigation for launch. Later, implement buyer display plus checkout pricing, or fold bundles into discount codes ('buy X+Y get $Z off').
- **$ impact:** $0 direct; lowers dev cost and confusion

<a id="bt-443"></a>
### BT-443 · P3 · effort S · Email open and click tracking is silently off unless RESEND_WEBHOOK_SECRET is set (not in env checks)

- **Where:** email-campaign-results · `artifacts/api-server/src/lib/emailMarketing/provider.ts:41-45, artifacts/api-server/src/routes/email-marketing.ts:53-69,225, artifacts/api-server/src/lib/env.ts:34-46`
- **Problem:** Delivered, opened and clicked stats need RESEND_WEBHOOK_SECRET. It isn't in OPTIONAL_VARS, so a missing value never even logs a startup warning, and campaign results show no engagement.
- **Why it costs money:** Sellers who see no opens or clicks decide email doesn't work and stop using it (or blame the product).
- **Fix:** Add RESEND_WEBHOOK_SECRET and EMAIL_TOKEN_SECRET to OPTIONAL_VARS, and add both to docs/launch env lists.
- **$ impact:** <$200/mo; perceived value of the email tool

<a id="bt-444"></a>
### BT-444 · P3 · effort S · finance.tsx and shipping-label are duplicates or orphans next to the payouts and fulfill-order flows

- **Where:** finance, shipping-label · `artifacts/mobile/app/finance.tsx, artifacts/mobile/app/shipping-label.tsx:1-32, artifacts/mobile/app/(tabs)/more.tsx:89-95`
- **Problem:** finance.tsx (376 lines, role-locked balance view) has no inbound navigation. More > Money links /payouts. shipping-label.tsx is now only a redirect to fulfill-order with no inbound links. Both stay registered as routes.
- **Why it costs money:** Duplicate money screens risk showing numbers that disagree, which is a support and trust cost.
- **Fix:** Delete finance.tsx (keep payouts and statements) and drop the shipping-label route once no deep links depend on it.
- **$ impact:** $0 direct; less maintenance

<a id="bt-445"></a>
### BT-445 · P3 · effort S · More tab shows 'FREE' plan badge although there is no free plan

- **Where:** (tabs)/more · `artifacts/mobile/app/(tabs)/more.tsx:139,221`
- **Problem:** planLabel falls back to 'FREE' whenever plan isn't pro or growth, including Starter ($29) and while loading. A paying Starter seller sees 'FREE' next to Subscription.
- **Why it costs money:** Paying sellers think they are on a free plan (support tickets, 'why was I charged' disputes), and unpaid sellers think free is a real tier.
- **Fix:** Map starter to 'STARTER', show nothing while loading, and show 'NO PLAN' with a CTA when status is none.
- **$ impact:** ~$50-200/mo in avoided billing disputes

## Web, manufacturer portal, admin, analytics & infra

56 findings: 6 P0 · 24 P1 · 16 P2 · 10 P3

<a id="bt-446"></a>
### BT-446 · P0 · effort M · Freelancer can self-complete a job and get paid instantly: no hirer approval

- **Where:** freelancer-jobs · `artifacts/api-server/src/routes/freelancer-jobs.ts:573-600,artifacts/api-server/src/routes/freelancer-jobs.ts:700-715,artifacts/mobile/app/freelancer-profile.tsx:378`
- **Problem:** PATCH /freelancer-jobs/:id/complete is freelancer-only. It moves in_progress to completed and immediately transfers freelancerPayoutCents. The hirer cannot approve, request revisions or dispute. The UI promises 'Payment is held by Brandthread and released when the job is done.'
- **Why it costs money:** A bad-faith freelancer can accept, start and complete within minutes and withdraw. The hirer then charges back against the platform's own charge (separate charges and transfers), and Brandthread loses the full price plus the dispute fee.
- **Fix:** Add a 'delivered' state. Complete from the hirer, or auto-release N days after delivery with no dispute. Only then create the transfer. Add a hirer 'open dispute' action that freezes the release.
- **$ impact:** Fraud exposure equal to 100% of freelancer GMV per bad actor. One $5k job lost is the take on $100k of jobs.

<a id="bt-447"></a>
### BT-447 · P0 · effort M · Admin revenue excludes subscriptions/IAP MRR, sample/bulk fees, freelancer fees, AI credits

- **Where:** admin (portal) · `artifacts/api-server/src/routes/admin/commerce.ts:171-210,artifacts/manufacturer-portal/src/admin/pages/revenue.tsx:43,artifacts/api-server/src/routes/admin/insights.ts:15-45`
- **Problem:** /admin/revenue sums only orders.platformFeeCents and boost budgets. The UI says 'Subscription revenue is billed and reported in Stripe', but iOS/Android subscriptions are in RevenueCat, not Stripe. sampleOrders.platformFeeCents, freelancerJobs.platformFeeCents, AI-credit packs, gift cards and featured slots are missing.
- **Why it costs money:** The owner can't see progress toward $50k/mo or which lines work. Subscription MRR, the main revenue line, is invisible in the admin.
- **Fix:** Add GET /admin/mrr (Stripe subscriptions plus native entitlements from RevenueCat webhook rows: active, trialing, converted, churned, MRR by tier) and add B2B and freelancer fee lines to /admin/revenue.
- **$ impact:** Required to manage toward $50k/mo. Can't measure trial-to-paid or MRR.

<a id="bt-448"></a>
### BT-448 · P0 · effort M · No Thread Cash budget/liability dashboard or kill switch in admin

- **Where:** admin (portal) · `artifacts/manufacturer-portal/src/admin/AdminApp.tsx:24-34,artifacts/api-server/src/routes/admin/index.ts:31-36,artifacts/api-server/src/lib/threadCash/rules.ts`
- **Problem:** The admin nav has Overview, Users, Orders, Revenue, AI spend, Moderation, Promotions, Featured, Announcements, Invites and Audit. Nothing shows Thread Cash issued, outstanding liability, redeemed or expired, or daily-reward spend, and there is no admin control to pause rewards (no admin route under thread-cash).
- **Why it costs money:** Thread Cash is a direct cash cost. An abuse ring or a viral spike can burn thousands per day unnoticed, with no way to stop it short of a deploy.
- **Fix:** Add GET /admin/thread-cash (issued, redeemed, outstanding, top earners, per-day) and a feature-flag-backed pause switch for daily rewards and checkout credit (feature-flags.ts exists).
- **$ impact:** Caps uncontrolled cost. A runaway abuse day at $1-2k is plausible without it.

<a id="bt-449"></a>
### BT-449 · P0 · effort S · PostHog analytics exists but is OFF: no key configured anywhere

- **Where:** n/a · `artifacts/mobile/lib/analytics/index.ts:11-13,artifacts/api-server/src/lib/analytics.ts:1-14,docs/reliability/observability.md:8-20,.replit:27-37,artifacts/mobile/eas.json:30-31`
- **Problem:** Both clients no-op without EXPO_PUBLIC_POSTHOG_KEY / POSTHOG_API_KEY. Neither is set in .replit userenv or eas.json build env.
- **Why it costs money:** Launch day would have no funnel data (signup, onboarding, trial, purchase), so there is no way to see where the $50k target is leaking.
- **Fix:** Create a PostHog project and set EXPO_PUBLIC_POSTHOG_KEY in the EAS production profile and web deployment, and POSTHOG_API_KEY on the API, before Oct 31.
- **$ impact:** Blocks measuring revenue. Required to optimise any funnel.

<a id="bt-450"></a>
### BT-450 · P0 · effort M · Analytics event catalogue has no subscription, trial, paywall or seller-activation events

- **Where:** n/a · `artifacts/mobile/lib/analytics/events.ts:8-23,artifacts/api-server/src/lib/analytics.ts:16-18`
- **Problem:** The allow-list covers app_opened, signup, onboarding, product_viewed, add_to_cart, checkout_started, social events, seller_onboarding_completed and product_published. There is no paywall_viewed, plan_selected, trial_started, trial_converted, subscription_cancelled, payout_setup_completed, store_published, first_sale, thread_cash_earned/redeemed, referral_sent/redeemed or sample_order_paid. The server only emits purchase_completed.
- **Why it costs money:** Trial-to-paid, the core seller-revenue metric, and the Thread Cash ROI can't be measured, so prices and the trial can't be tuned.
- **Fix:** Add these events. Emit the subscription ones server-side from the Stripe and RevenueCat webhooks (authoritative, survives app deletion) via captureServerEvent, keyed by Clerk id.
- **$ impact:** Trial-to-paid visibility. A 5-point conversion lift on 500 trials is about 25 sellers, roughly $750 MRR.

<a id="bt-451"></a>
### BT-451 · P0 · effort S · Autoscale deployment plus 25 in-process setInterval jobs: duplicate money jobs or none at idle

- **Where:** server · `.replit:5,artifacts/api-server/src/index.ts:75-100,artifacts/api-server/src/jobs/moneySweep.ts:30,artifacts/api-server/src/jobs/affiliatePayouts.ts:29,docs/scale/SCALE_PLAN.md:129`
- **Problem:** deploymentTarget = 'autoscale'. Every instance starts all jobs (money sweep, affiliate payouts, Thread Cash expiry, trial reminders, abandoned cart, email campaigns) with no leader lock and no BullMQ (Phase 4 not implemented). Autoscale also scales idle instances down, so timers don't run with no traffic. SCALE_PLAN §8: 'Do not raise Autoscale max instances above 1'.
- **Why it costs money:** Two instances can mean duplicate trial-reminder or abandoned-cart emails and double payout attempts (idempotency keys mitigate some). Zero instances means missed trial reminders, so involuntary trial loss, and late payouts.
- **Fix:** Pin max instances to 1 for launch, or move jobs to a Replit Reserved VM or scheduled deployment. Add a Postgres advisory-lock leader election (pg_try_advisory_lock) around each job run as a cheap, additive guard.
- **$ impact:** Protects trial conversion emails and payout correctness. A missed trial reminder costs MRR.

<a id="bt-452"></a>
### BT-452 · P1 · effort S · Brandthread pays Stripe processing on sample/bulk cards, eating ~60% of the 5% take

- **Where:** sample-detail · `artifacts/api-server/src/routes/sample-orders.ts:337-340,artifacts/api-server/src/lib/money/fees.ts:7-21,docs/payments/money-flow.md:386`
- **Problem:** Retail destination charges add a processing estimate to application_fee_amount (destinationApplicationFeeCents), but sample/bulk Checkout passes only platformFeeCents. Stripe's 2.9%+30c (plus 1.5% on international cards) is charged to the platform. money-flow.md:386 admits this is 'paid by Brandthread and not tracked in the ledger'.
- **Why it costs money:** On a $10,000 bulk card Brandthread keeps $500 and pays about $290 to $440 in Stripe fees. Net take falls to roughly 1-2% of B2B GMV, and the ledger overstates profit.
- **Fix:** Use destinationApplicationFeeCents({merchandiseCents: priceCents, preTaxTotalCents: priceCents}) for sample orders (persist processingFeeEstimateCents), or add a seller-side 'card processing' line. Additive change to the order-card insert.
- **$ impact:** About $2.9k/mo recovered per $100k of B2B card GMV.

<a id="bt-453"></a>
### BT-453 · P1 · effort S · Bulk orders paid from drop wallet: transfer sends 100% to manufacturer, zero B2B take

- **Where:** production-detail · `artifacts/api-server/src/routes/sample-orders.ts:845-849,artifacts/api-server/src/lib/money/escrow.ts:842-862,docs/payments/money-flow.md:386`
- **Problem:** pay-from-wallet calls stripe.transfers.create with amount: order.priceCents even though the row carries platformFeeCents. The ledger posts the full amount to manufacturer_paid. The doc marks this an 'Owner decision', still open.
- **Why it costs money:** Bulk production is the largest B2B ticket ($5k-$50k). Funding it from preorder money (the path the drop flow pushes) skips the manufacturer-side 5% that the card path collects. Two payment routes for the same order earn different amounts.
- **Fix:** Decide the policy. If the fee should apply, transfer priceCents - platformFeeCents and post the fee to a platform_revenue ledger leg in recordBulkPaidFromHeld. Show the net on the manufacturer's order card.
- **$ impact:** 5% of wallet-funded bulk GMV. $60k/mo of bulk via wallets is about $3k/mo.

<a id="bt-454"></a>
### BT-454 · P1 · effort M · Bulk order cards up to $500k are card-only; no ACH/wire, so big orders leave the platform

- **Where:** sample-detail · `artifacts/api-server/src/routes/sample-orders.ts:319-321,lib/manufacturer-flow/src/orders.ts:206-209`
- **Problem:** Checkout uses payment_method_types: ['card'] for every sample/bulk card, and validateCardInput allows cards up to US$500,000. No us_bank_account (ACH) and no bank-transfer option.
- **Why it costs money:** Sellers will not pay a 3% card fee on a $20k production run. They will ask the factory for wire details, and the deal (and the 5%) leaves. Brandthread also pays the card fee itself (see above).
- **Fix:** Add 'us_bank_account' (ACH Direct Debit, 0.8% capped at $5) and customer_balance bank transfers to the Checkout session for bulk cards above a threshold (e.g. $1,000). Keep card for samples.
- **$ impact:** Keeps large bulk tickets on platform. Each retained $20k order is $1k gross. Likely $2k-$5k/mo at target scale.

<a id="bt-455"></a>
### BT-455 · P1 · effort S · B2B fee charged to manufacturer while portal advertises 'Free for manufacturers'

- **Where:** manufacturer-onboard · `artifacts/mobile/app/manufacturer-onboard.tsx:51,artifacts/manufacturer-portal/src/pages/landing.tsx:54,artifacts/manufacturer-portal/src/pages/join.tsx:78,artifacts/manufacturer-portal/src/components/orders/send-card-dialog.tsx:138`
- **Problem:** Signup copy says 'Free for manufacturers' and 'List your factory — free', but every paid card has 5% deducted from the manufacturer's payout. The only disclosure is 'Brandthread's platform fee ... deducted before payout' in the send-card dialog, with no rate shown.
- **Why it costs money:** A surprise deduction pushes factories to ask sellers to pay them directly, and is a consumer-protection and chargeback risk. Every off-platform order is a 100% loss of the take.
- **Fix:** State '5% platform fee on paid orders, no listing fee' on the landing, join and send-card screens. Show 'You receive $X' in the send-card dialog. Record acceptance of manufacturer terms at registration (recordLegalAcceptance).
- **$ impact:** Protects the whole B2B take. Trust and disintermediation risk on all B2B GMV.

<a id="bt-456"></a>
### BT-456 · P1 · effort S · No manufacturer terms/agreement accepted at signup (fee, non-circumvention)

- **Where:** server · `artifacts/api-server/src/routes/manufacturers.ts:1203-1225,artifacts/manufacturer-portal/src/pages/onboarding.tsx:112-122`
- **Problem:** POST /manufacturers/register inserts the manufacturer as active with no legal acceptance record. The portal onboarding has no terms checkbox. lib/legalAcceptance.ts exists but is not used for manufacturers.
- **Why it costs money:** Without a signed fee and non-circumvention clause, Brandthread has no recourse when factories take introduced sellers off-platform, and no contractual basis for the 5% deduction.
- **Fix:** Add a manufacturer agreement version, require acceptance in onboarding, and call recordLegalAcceptance in register and register-via-invite. Include a 12-month non-circumvention clause for sellers introduced through the directory.
- **$ impact:** Contract basis for all B2B revenue.

<a id="bt-457"></a>
### BT-457 · P1 · effort S · Manufacturer website shown publicly and to sellers: easy route around the take

- **Where:** manufacturer-profile · `artifacts/api-server/src/routes/manufacturer-public.ts:35,artifacts/api-server/src/routes/manufacturers.ts:456,artifacts/api-server/src/routes/seller-hub.ts:56`
- **Problem:** publicManufacturerFields, /partners/:id and seller-hub /manufacturers all return manufacturers.website. Factory sites list email, WhatsApp and WeChat.
- **Why it costs money:** A seller can find a factory on Brandthread and contact it directly before any paid card, so the platform does the discovery work and earns nothing.
- **Fix:** Hide website from the directory and partner payloads until the seller has paid at least one order card with that manufacturer (or move it behind the Growth plan). Show a 'Verified on Brandthread' badge in its place.
- **$ impact:** Disintermediation on directory-originated deals. Plausibly 20-40% of B2B GMV at risk.

<a id="bt-458"></a>
### BT-458 · P1 · effort M · Manufacturer chat has no contact-info or off-platform-payment filter

- **Where:** manufacturer-messages · `artifacts/api-server/src/routes/manufacturers.ts:1412-1505,artifacts/api-server/src/routes/manufacturers.ts:1554-1670,artifacts/api-server/src/lib/contentModerator.ts:117-118`
- **Problem:** Seller-to-manufacturer and manufacturer-to-seller messages are stored with no moderateMessage call (only routes/conversations.ts imports it). Even the existing off-platform payment regex covers only Zelle/CashApp/Venmo phrasing. Emails, phone numbers, WeChat/WhatsApp IDs, PayPal and wire/IBAN pass through.
- **Why it costs money:** B2B is where off-platform payment is most tempting (large tickets, card fees). One 'send me your email, I'll invoice you' message moves the whole relationship off-platform.
- **Fix:** Run a contact/payment-steering detector on manufacturer messages (email, phone, IBAN/SWIFT, WeChat/WhatsApp, PayPal/Wise). Soft-mask before the first paid order and show both sides an 'Orders paid outside Brandthread aren't protected' notice.
- **$ impact:** Protects B2B take. Each leaked repeat-customer relationship loses all future orders.

<a id="bt-459"></a>
### BT-459 · P1 · effort M · Freelancer-job and sample-order chargebacks never claw back the payout

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:433-455,artifacts/api-server/src/routes/webhooks.ts:2134-2180,artifacts/api-server/src/lib/disputes/store.ts:13-19`
- **Problem:** charge.dispute.* for manufacturer cards only records a payment_reversed event and sets the order to payment_review. No transfers.createReversal, and no debit from the manufacturer. Freelancer job charges are not matched by lib/disputes/store (orders table only), so they are ignored.
- **Why it costs money:** On destination and platform charges, Stripe debits Brandthread's balance for the dispute plus a $15 fee while the manufacturer or freelancer keeps the money. Every lost B2B chargeback is a direct loss.
- **Fix:** For lost disputes, call stripe.transfers.createReversal on the order's transfer (or debit the connected account) and post a ledger leg. Add freelancer-job lookup to the dispute handler. Surface it in the admin disputes list.
- **$ impact:** Each B2B chargeback costs price plus $15. A few per month at $1k-$10k each is $2k-$10k/mo of exposure.

<a id="bt-460"></a>
### BT-460 · P1 · effort M · No refund/cancel path for paid sample or bulk orders

- **Where:** sample-detail · `artifacts/api-server/src/routes/manufacturer-flow.ts:1-13,artifacts/api-server/src/routes/manufacturer-flow.ts:311-330,artifacts/api-server/src/routes/admin/commerce.ts:108-132`
- **Problem:** Cancel only handles unpaid cards. Once a sample or bulk card is paid there is no API to refund (full or partial) or reverse the transfer, and admin refunds are read-only.
- **Why it costs money:** When a factory misses a deadline or ships defects, the seller's only recourse is a chargeback, which Brandthread eats (see dispute finding). Sellers learn not to pay through the platform.
- **Fix:** Add POST /sample-orders/:id/refund (manufacturer-initiated or admin) using refunds.create with reverse_transfer: true and refund_application_fee as a policy flag, plus a 'Brandthread Production Protection' promise in the UI.
- **$ impact:** Turns chargebacks into controlled refunds, saving $15 per dispute plus the full amount, and builds trust that keeps B2B GMV on-platform.

<a id="bt-461"></a>
### BT-461 · P1 · effort M · Quote acceptance doesn't create a payable order card: deals re-keyed in chat

- **Where:** quote-detail · `artifacts/api-server/src/routes/seller-hub.ts:170-230,artifacts/api-server/src/routes/manufacturers.ts:518-560`
- **Problem:** Manufacturers quote quotedPriceCents on a quote request and the seller can accept. Nothing turns an accepted quote into a sampleOrders card. Someone must re-price it manually in a thread, so the agreed price and the payment are disconnected.
- **Why it costs money:** Every extra manual step between 'yes' and 'pay' is a point where the parties exchange details and pay off-platform.
- **Fix:** When a seller accepts a quote, auto-create a pending_payment sampleOrders card (via the same insert as manufacturer-flow order-cards) in the linked thread with a one-tap 'Pay securely' CTA.
- **$ impact:** Raises quote-to-paid conversion. Each extra 10% conversion on $100k/mo of quotes is about $500/mo of take.

<a id="bt-462"></a>
### BT-462 · P1 · effort M · RFQs and quote requests send no notification or email to manufacturers

- **Where:** rfq-post · `artifacts/api-server/src/routes/seller-hub.ts:92-150,artifacts/api-server/src/routes/seller-hub.ts:285-352,artifacts/api-server/src/lib/brandthreadEmail.ts:462`
- **Problem:** POST /seller-hub/rfqs and /quote-requests insert rows but call neither publishNotification nor any email. The only manufacturer email that exists is the signup email. Manufacturers work in the web portal with no push token, so publishNotification (in-app plus push only) doesn't reach them either.
- **Why it costs money:** Factories don't see requests, so sellers get no quotes and conclude the directory is dead. No quotes means no order cards and no take, and the Growth plan that gates the hub looks worthless (churn).
- **Fix:** Add transactional emails to manufacturers (contactEmail) for new quote request/RFQ, new message, and order paid, with a digest throttle. Add a web-push or email fallback in publishNotification for users with no device.
- **$ impact:** Underpins all B2B GMV and Growth-plan retention. Likely the biggest B2B conversion lever.

<a id="bt-463"></a>
### BT-463 · P1 · effort S · Seller-hub lists private (invite-only) manufacturers to every user, including their website

- **Where:** rfq-post · `artifacts/api-server/src/routes/seller-hub.ts:40-63,artifacts/api-server/src/routes/manufacturers.ts:927-933,artifacts/mobile/app/manufacturer-onboard.tsx:46`
- **Problem:** GET /seller-hub/manufacturers filters only status='active', so manufacturers created through a seller's private invite (isPublicDirectory: false) are listed to all users with their website. The onboarding screen promises 'Your invite is private: only the seller who invited you will see your profile.' RFQ targeting (seller-hub.ts:317) also accepts them.
- **Why it costs money:** Competitors can poach a seller's private factory. That breaks a stated privacy promise and discourages sellers from bringing their own supplier onto the platform, which is the cheapest B2B GMV to acquire.
- **Fix:** Add eq(manufacturers.isPublicDirectory, true) OR an existing relationship with the caller to both the list and the RFQ targeting query.
- **$ impact:** Protects invite-sourced B2B GMV and trust. Also a privacy-claim risk.

<a id="bt-464"></a>
### BT-464 · P1 · effort M · Manufacturer self-signup goes live instantly: no vetting before taking card payments

- **Where:** server · `artifacts/api-server/src/routes/manufacturers.ts:1217-1222`
- **Problem:** POST /manufacturers/register inserts isPublicDirectory: true, status: 'active' ('no manual approval step'). After Stripe Express onboarding the account can price cards and take seller payments immediately.
- **Why it costs money:** Fake 'factories' can collect sample payments and disappear. On destination charges the dispute lands on Brandthread (see dispute finding), and fake listings make the real directory look untrustworthy.
- **Fix:** Keep signup instant but hide new manufacturers from the public directory until an admin approves (status 'pending_review'), or cap the first N card payments and use a delayed payout schedule for new accounts (Stripe payout delay settings).
- **$ impact:** Fraud prevention. One fake factory running 20 x $200 samples is a $4k loss plus fees.

<a id="bt-465"></a>
### BT-465 · P1 · effort M · Manufacturer directory is real DB data but empty at launch (demo fixtures web-preview only)

- **Where:** manufacturer-hub · `artifacts/mobile/lib/previewManufacturers.ts:1-30,artifacts/mobile/services/manufacturerService.ts:149-151,artifacts/api-server/scripts/seedReviewAccounts.ts`
- **Problem:** The directory reads live manufacturers rows. The PREVIEW_MANUFACTURERS fixture only appears with isPreviewDemoMode() (dev-web preview). No seed or migration inserts manufacturers, so production launches with zero factories unless they are recruited by hand.
- **Why it costs money:** The Growth plan's headline 'find manufacturers' feature shows an empty hub to paying sellers on day one, causing refund requests and churn, and there is no B2B GMV until supply exists.
- **Fix:** Recruit and onboard 30-50 real factories through the portal before Oct 31. Add an empty-state CTA ('Invite your factory') that routes to invite-manufacturer, so sellers bring their own supply.
- **$ impact:** The Growth tier's value depends on it. The churn risk is the Growth MRR.

<a id="bt-466"></a>
### BT-466 · P1 · effort S · Landing page has no pricing: 'Start selling' with no plan prices or trial terms

- **Where:** n/a · `artifacts/mobile/scripts/landing-page.js:266-268`
- **Problem:** The Sell section only says 'Selling plans and premium seller tools are available as subscriptions.' It shows no tier names, prices, 5-day trial or 5% commission, and there is no /pricing route (build-web.js PUBLIC_ROUTES has none).
- **Why it costs money:** Sellers comparing Shopify, Depop or Big Cartel bounce when pricing is hidden, which hurts web conversion where Brandthread keeps 100% of subscription revenue.
- **Fix:** Once prices are set, add a /pricing section and page generated from the same plan catalogue (planCatalogue.ts / sellerPlansDisplay.ts), with trial terms and the 5% fee, and add it to PUBLIC_ROUTES and the sitemap.
- **$ impact:** Web seller conversion. +10 web sellers/mo at $30 avoids $45-$90/mo of Apple cut and adds MRR.

<a id="bt-467"></a>
### BT-467 · P1 · effort M · No web-only price advantage or 'subscribe on web' steering for sellers

- **Where:** plans · `artifacts/mobile/app/plans.tsx:379-387,artifacts/mobile/lib/sellerPlansDisplay.ts:21-27`
- **Problem:** The web plans page shows plan.priceLabel, the same list price as in-app. Nothing on the landing page or in the app's web flow positions web as the place to subscribe, and there is no web-exclusive offer such as an annual plan or a longer trial.
- **Why it costs money:** Every seller who subscribes through iOS IAP costs 15-30%. Under the US external-link entitlement and 3.1.3(b) multiplatform, web subscriptions are allowed and keep 100%.
- **Fix:** Offer a web-only annual plan or discount, add a 'Subscribe on the web' link in the US iOS build (with the subscription-iap agent's entitlement work), and A/B the landing CTA.
- **$ impact:** Shifting 50% of subscription MRR to web at $30k MRR saves about $2.25k-$4.5k/mo of Apple fees.

<a id="bt-468"></a>
### BT-468 · P1 · effort M · Admin refunds and disputes are read-only: no refund, evidence or payout-hold action

- **Where:** admin (portal) · `artifacts/api-server/src/routes/admin/commerce.ts:108-169,docs/admin-dashboard.md:47-48`
- **Problem:** GET /admin/refunds and /admin/disputes only list rows. docs/admin-dashboard.md says 'nothing moves money: refunds and disputes are read-only views'. Ops must use the Stripe dashboard, which bypasses the ledger handlers for some flows.
- **Why it costs money:** Slow dispute response loses chargebacks (each costs the amount plus $15). Dashboard refunds can desync seller payouts and Thread Cash, and support time per case is high.
- **Fix:** Add audited admin actions: POST /admin/orders/:id/refund (calling lib/money/refunds), dispute evidence submit (reusing lib/disputes/upload), and seller payout hold/release via Stripe payout schedule.
- **$ impact:** Disputes won and ops hours. At 0.5% dispute rate on $1M GMV, winning 30% more saves about $1.5k/mo.

<a id="bt-469"></a>
### BT-469 · P1 · effort S · Admin 'platform fees' is gross: ignores Stripe fees Brandthread pays and Thread Cash subsidy

- **Where:** admin (portal) · `artifacts/api-server/src/routes/admin/commerce.ts:178-197,artifacts/api-server/src/routes/admin/commerce.ts:91`
- **Problem:** Revenue = sum(platformFeeCents) - refunded fees. It does not subtract Thread Cash spent (orders.threadCashAppliedCents is shown only on order detail), daily Thread Cash rewards, Stripe dispute fees, or Stripe fees absorbed on B2B and freelancer charges.
- **Why it costs money:** Thread Cash is paid from Brandthread's pocket. Showing gross fees can hide a negative contribution margin until the bank balance shows it.
- **Fix:** Add a 'net take' card: fees - Thread Cash redeemed - rewards issued (from the threadCash ledger) - absorbed Stripe fees - dispute fees, using the money ledger accounts.
- **$ impact:** Prevents unseen margin loss. Thread Cash could be 20-50% of fees.

<a id="bt-470"></a>
### BT-470 · P1 · effort M · No fraud/risk review queue in admin, though order risk scores are computed

- **Where:** admin (portal) · `artifacts/api-server/src/lib/risk/orderRisk.ts:75,artifacts/api-server/src/routes/orders.ts,artifacts/api-server/src/routes/admin/commerce.ts:45-70`
- **Problem:** Radar outcomes and riskLevel/riskScore are stored on orders and shown to sellers (orders.ts), but /admin/orders has no risk filter and no review queue. There is no admin view of elevated-risk sellers, new-seller payout velocity, or Thread Cash farming.
- **Why it costs money:** Fraudulent sellers or buyers are only found after chargebacks, and Brandthread is liable on negative balances of Express accounts.
- **Fix:** Add ?risk=elevated|highest to /admin/orders and a 'Risk' page listing high-risk orders, new sellers with fast GMV, and Thread Cash anomalies, with a suspend/hold action.
- **$ impact:** Fraud loss prevention. Likely $1k-$5k/mo at scale.

<a id="bt-471"></a>
### BT-471 · P1 · effort M · No seller payout review/hold tooling: payouts flow automatically to new accounts

- **Where:** admin (portal) · `artifacts/api-server/src/lib/payoutSafety.ts,artifacts/api-server/src/routes/admin/users.ts:138-175`
- **Problem:** Admin can suspend a user but cannot view or hold a connected account's payouts or set a delayed payout schedule for new or high-risk sellers. Express accounts' negative balances are the platform's liability.
- **Why it costs money:** A seller who ships nothing and gets paid out before chargebacks leaves Brandthread holding the loss.
- **Fix:** Add admin endpoints to set stripe.accounts.update(payout_schedule.delay_days / manual) for a seller and manufacturer, and show pending/available balance on the admin user page.
- **$ impact:** Limits seller-fraud losses.

<a id="bt-472"></a>
### BT-472 · P1 · effort M · WebSocket live/community rooms are in-process Maps: break with more than 1 instance

- **Where:** server · `artifacts/api-server/src/ws/liveHub.ts:23-29,docs/scale/SCALE_PLAN.md:14`
- **Problem:** Live and community chat state lives in process memory. With autoscale above 1 instance, viewers on different instances don't see each other's messages, tips or live-commerce events.
- **Why it costs money:** Live shopping (tips, live-commerce checkout) silently degrades under the very traffic spikes that generate revenue.
- **Fix:** Keep 1 instance for launch, or implement the Redis pub/sub adapter (REDIS_URL plumbing exists in lib/redis.ts).
- **$ impact:** Live-commerce GMV during peaks.

<a id="bt-473"></a>
### BT-473 · P1 · effort M · Video bytes still stream through Express from object storage (no CDN/Mux)

- **Where:** server · `artifacts/api-server/src/routes/post-video.ts:630,artifacts/api-server/src/routes/post-video.ts:720,artifacts/api-server/src/lib/cdnUrl.ts:1-12,docs/scale/SCALE_PLAN.md:94-107`
- **Problem:** GET /api/posts/media/* pipes file.createReadStream through the API. The CDN (CDN_BASE_URL) is optional and unset by default. Mux/R2 Phase 5 is not implemented (no MUX_/VIDEO_PROVIDER references).
- **Why it costs money:** Feed video egress plus API CPU is the main cost line (SCALE_PLAN estimates video dominates the bill), and saturated API cores slow checkout for everyone.
- **Fix:** Before launch, set CDN_BASE_URL (Cloudflare in front of GCS) so media bypasses Express. Plan Mux or R2 when the video bill passes about $5k/mo.
- **$ impact:** Infra cost at 10k DAU: about $1.5k/mo saved with CDN versus proxying, and protects checkout latency.

<a id="bt-474"></a>
### BT-474 · P1 · effort S · DB pool, statement timeout and pooler unset by default; rate limiter writes DB on every request

- **Where:** server · `lib/db/src/poolConfig.ts:16-20,docs/scale/DATABASE.md:5-14,docs/scale/SCALE_PLAN.md:12,docs/scale/SCALE_PLAN.md:130`
- **Problem:** DB_POOL_MAX, DB_STATEMENT_TIMEOUT_MS and DATABASE_READ_URL are opt-in. The rate limiter stores counters in Postgres unless REDIS_URL is set, and fails closed (503) when the DB is slow, so a DB slowdown becomes a full outage including checkout.
- **Why it costs money:** A launch-day spike can take checkout and subscription purchase down. Every minute of outage at $50k/mo is about $1.2 of GMV take, and it costs App Store rating damage.
- **Fix:** For launch set DB_STATEMENT_TIMEOUT_MS=15000, DB_POOL_MAX sized to the plan, a pooled (Neon -pooler) DATABASE_URL, and REDIS_URL (Upstash fixed plan) so rate limits leave Postgres.
- **$ impact:** Outage avoidance during launch spike.

<a id="bt-475"></a>
### BT-475 · P1 · effort S · Single Replit deployment hosts API, web app and portal: one failure domain for all revenue

- **Where:** server · `.replit:1-10,artifacts/api-server/.replit-artifact/artifact.toml:19-31,artifacts/mobile/.replit-artifact/artifact.toml:15-24`
- **Problem:** API, Expo web (brandthread.app), manufacturer portal and app-tour are path-routed services in one Replit deployment. A bad deploy or platform incident takes buyer checkout, web subscriptions, B2B payments and webhooks down together. There is no documented uptime monitor (SCALE_PLAN Phase 8 lists Better Stack as todo).
- **Why it costs money:** Stripe webhooks retry, but RevenueCat, Shippo and Clerk events and live checkouts during an outage are lost revenue, and no one is paged.
- **Fix:** Before launch, add an uptime monitor on /api/healthz/ready and /status with phone alerts, and a rollback runbook. Longer term, split the API from static web as in SCALE_PLAN §7.
- **$ impact:** Outage detection. Each hour down at $50k/mo is about $70 of take plus trust.

<a id="bt-476"></a>
### BT-476 · P2 · effort S · Freelancer escrow charge on platform: Brandthread pays processing out of its 5%

- **Where:** freelancer-profile · `artifacts/api-server/src/routes/freelancer-jobs.ts:182-183,artifacts/api-server/src/routes/freelancer-jobs.ts:202-232`
- **Problem:** The hirer pays the price to the platform account and the freelancer gets price - 5%. Stripe 2.9%+30c (plus FX and cross-border transfer fees for non-US freelancers) is borne by Brandthread.
- **Why it costs money:** The net take on freelancer GMV is about 2%. Small jobs ($20-$50) can be loss-making after the 30c fixed fee, and cross-border fees can make them negative.
- **Fix:** Add a hirer-side service fee (e.g. 3% plus $0.50, like Fiverr) shown in the hire sheet, or pass processing to the freelancer side like retail. Set a minimum job price that covers fees.
- **$ impact:** About 3% of freelancer GMV. $20k/mo of jobs is about $600/mo.

<a id="bt-477"></a>
### BT-477 · P2 · effort S · Unvalidated client successUrl/cancelUrl on freelancer Checkout

- **Where:** server · `artifacts/api-server/src/routes/freelancer-jobs.ts:110,artifacts/api-server/src/routes/freelancer-jobs.ts:217-224`
- **Problem:** POST /freelancer-jobs passes any string successUrl/cancelUrl from the request body straight into the Stripe Checkout session.
- **Why it costs money:** Brandthread-branded Checkout can redirect to an attacker domain after payment, so it can be used for phishing or fake 'payment failed, pay again here' pages. That means fraud losses and support cost.
- **Fix:** Allow-list the app scheme and the brandthread.app/API origins (lib/webOrigin.ts or brandthreadCallbackUrls.ts) before accepting a custom URL.
- **$ impact:** Fraud/support prevention. Small direct $.

<a id="bt-478"></a>
### BT-478 · P2 · effort S · Seller-hub RFQ/quote and sample-order routes bypass the Growth plan paywall

- **Where:** rfq-post · `artifacts/api-server/src/routes/index.ts:255,artifacts/api-server/src/routes/index.ts:333,artifacts/api-server/src/routes/manufacturers.ts:77`
- **Problem:** /manufacturers seller routes use requireGrowthSeller, and the mobile hub upsells Growth (manufacturer-hub.tsx:177). /seller-hub (RFQs, quote requests, manufacturer list) and /sample-orders are mounted with only teamContext, so any signed-in account, including a free buyer, can RFQ up to 10 factories.
- **Why it costs money:** The paywall that is meant to sell Growth subscriptions is bypassable by any client, and factories get spammed by non-paying accounts.
- **Fix:** Decide intentionally. Either gate /seller-hub/rfqs and /quote-requests with requirePlan('growth') (keeping /sample-orders payment open so paid GMV is never blocked), or move manufacturer sourcing to the free tier and gate only advanced features.
- **$ impact:** Growth-plan conversion integrity. Depends on unset tier prices.

<a id="bt-479"></a>
### BT-479 · P2 · effort M · 'Verified' manufacturer badge can never be granted: no endpoint sets verifiedAt

- **Where:** manufacturer-hub · `artifacts/api-server/src/routes/manufacturer-public.ts:123,artifacts/api-server/src/routes/manufacturer-public.ts:138,artifacts/api-server/src/routes/manufacturer-public.ts:192,artifacts/api-server/src/routes/admin/users.ts:108`
- **Problem:** The directory sorts by verifiedAt and offers a 'verified' filter, but no route writes manufacturers.verifiedAt (grep finds only reads). Admin /users/:id/verify verifies users, not manufacturers.
- **Why it costs money:** Sellers deciding where to spend $10k+ need trust signals. Without verification the directory can't compete with Alibaba Trade Assurance/Faire, and a paid 'Verified' listing tier for factories isn't possible.
- **Fix:** Add POST /admin/manufacturers/:id/verify (audited) plus an admin page. Consider a paid manufacturer verification or featured-placement fee as a second B2B revenue line.
- **$ impact:** Enables trust for B2B conversion. A paid verification of e.g. $99 for 50 factories is about $5k one-time.

<a id="bt-480"></a>
### BT-480 · P2 · effort S · Public manufacturer applications go to 'pending' with no review queue anywhere

- **Where:** server · `artifacts/api-server/src/routes/manufacturer-public.ts:328-381,artifacts/api-server/src/routes/admin/index.ts:31-36`
- **Problem:** POST /manufacturers/public/apply creates status 'pending', isPublicDirectory: false, and says it awaits 'an authenticated review/claim flow'. No admin route lists or approves pending manufacturers, and nothing emails the applicant.
- **Why it costs money:** Inbound factory supply leads silently die, and the directory stays thin at launch.
- **Fix:** Add GET /admin/manufacturers?status=pending plus approve/reject (audited), email the applicant a claim link, or remove the public apply form in favour of the portal's self-signup.
- **$ impact:** Supply-side growth for B2B.

<a id="bt-481"></a>
### BT-481 · P2 · effort S · Freelancers go live instantly with portfolio links and no review

- **Where:** freelancer-apply · `artifacts/api-server/src/routes/freelancers.ts:132-214,artifacts/api-server/src/routes/freelancers.ts:53`
- **Problem:** POST /freelancers/apply upserts isActive: true immediately. Public profiles expose portfolioUrls (up to 4 arbitrary links) and userId (so the hirer can open a normal DM).
- **Why it costs money:** Portfolio sites carry contact details, so jobs get negotiated and paid off-platform. Fake freelancers, combined with self-complete payouts, are a fraud vector.
- **Fix:** Hold new freelancers out of search until they are Connect-verified (stripeAccountId active) and admin-approved. Strip contact details from bios and portfolio pages via the same detector proposed for manufacturer chat.
- **$ impact:** Protects freelancer take and fraud exposure.

<a id="bt-482"></a>
### BT-482 · P2 · effort M · Separate-charges escrow for freelancers makes Brandthread merchant of record

- **Where:** server · `artifacts/api-server/src/routes/freelancer-jobs.ts:1-15,artifacts/api-server/src/routes/freelancer-jobs.ts:226-232`
- **Problem:** Freelancer funds are charged on the platform account, so Brandthread is the merchant of record for the service: its statement descriptor, dispute liability, refund obligation and possible sales-tax/1099-K reporting duties.
- **Why it costs money:** Brandthread takes on liability for chargebacks and possibly tax on 100% of the gross while keeping 5%. Funds held over 90 days can run into Stripe's separate-charges limits.
- **Fix:** Confirm with counsel and Stripe: use on_behalf_of to make the freelancer the settlement merchant, or keep escrow but add auto-release under 90 days and a hirer fee to fund the risk.
- **$ impact:** Liability equal to freelancer GMV. Dispute costs as above.

<a id="bt-483"></a>
### BT-483 · P2 · effort M · No platform take on RFQ/quote volume or manufacturer subscriptions (untapped B2B revenue)

- **Where:** n/a · `artifacts/api-server/src/routes/seller-hub.ts:285-352,artifacts/api-server/src/routes/manufacturers.ts:1203-1225`
- **Problem:** Manufacturers pay nothing to list, receive unlimited RFQs and get directory placement free. Revenue comes only from the 5% on paid cards.
- **Why it costs money:** Factories are the side with B2B purchasing budgets. Alibaba/Faire-style supplier memberships, featured placement and lead fees are standard revenue lines that don't add to seller friction.
- **Fix:** After launch, add a 'Manufacturer Pro' web subscription (Stripe on web, no Apple cut since the portal is web-only): featured directory placement, verified badge, RFQ priority. featured-slots plumbing can be reused.
- **$ impact:** 50 factories x $49/mo is about $2.5k MRR, outside Apple entirely.

<a id="bt-484"></a>
### BT-484 · P2 · effort S · Manufacturer portal is web-only: good for a no-Apple-cut B2B revenue line, but not discoverable

- **Where:** n/a · `artifacts/manufacturer-portal/.replit-artifact/artifact.toml:1-25,artifacts/mobile/app/manufacturer-onboard.tsx:1-8,artifacts/mobile/scripts/landing-page.js:253-262`
- **Problem:** Manufacturers work at brandthread.app/manufacturers/. The main landing page never mentions manufacturers or links to the portal, and the portal's landing isn't in the main sitemap.
- **Why it costs money:** Supply-side acquisition depends on manual outreach. Factories searching for 'streetwear brands looking for manufacturers' can't find it.
- **Fix:** Add a 'Manufacturers' link and section to landing-page.js, add /manufacturers/ to robots/sitemap, and use the portal landing as SEO content for the factory side.
- **$ impact:** B2B supply growth.

<a id="bt-485"></a>
### BT-485 · P2 · effort S · Web seller signup + Stripe subscription checkout exists: verify trial-with-card on web

- **Where:** plans · `artifacts/api-server/src/routes/subscription.ts:372-451,artifacts/mobile/app/plans.tsx:131-139,artifacts/mobile/app/plans.tsx:195`
- **Problem:** On web, plans.tsx uses POST /subscription/checkout (Stripe) and polls for the webhook. Landing 'Start selling' writes onboarding_pending_flow=seller and routes to /onboarding. Seller web signup through paid subscription is wired. Cross-reference the subscription-iap area for trial and card details.
- **Why it costs money:** This is the cheapest seller-revenue path (no Apple fee). Any break in it directly costs MRR.
- **Fix:** Add an end-to-end web funnel test (landing, onboarding, plans, Stripe Checkout, webhook, active) and PostHog events for each step (see analytics findings).
- **$ impact:** Protects web MRR.

<a id="bt-486"></a>
### BT-486 · P2 · effort M · No admin view for manufacturers, B2B orders, or freelancer jobs

- **Where:** admin (portal) · `artifacts/manufacturer-portal/src/admin/AdminApp.tsx:24-34,artifacts/api-server/src/routes/admin/commerce.ts:45`
- **Problem:** /admin/orders queries only the retail orders table. sample_orders (payment_review after reversals), freelancer_jobs (stuck in_progress, paid but never completed), and manufacturer accounts have no admin listing or action.
- **Why it costs money:** Money stuck in B2B and freelancer escrow and reversed manufacturer payments go unnoticed. Disputes and refund requests on these flows have no owner.
- **Fix:** Add /admin/production-orders and /admin/freelancer-jobs lists with status filters, plus actions (refund, cancel, force-release) reusing existing route logic.
- **$ impact:** Ops for B2B GMV. Prevents escrow sitting unhandled.

<a id="bt-487"></a>
### BT-487 · P2 · effort S · Several catalogued funnel events are never fired

- **Where:** n/a · `artifacts/mobile/lib/analytics/events.ts:8-23,artifacts/mobile/lib/api.ts:1167,artifacts/mobile/lib/api.ts:1293`
- **Problem:** grep shows track()/trackAfter() call sites for app_opened, signup_*, product_viewed, add_to_cart, post_viewed, checkout_started, message_sent, video_watched, follow, live_joined, product_published and onboarding. seller_onboarding_completed has no call site outside events.ts.
- **Why it costs money:** The seller-activation funnel (signup, store, first product, first sale) has a hole at the most important step.
- **Fix:** Fire seller_onboarding_completed on seller onboarding completion (api.ts:1167 path, conditioned on account type), plus store_published from the store-publish screen.
- **$ impact:** Funnel completeness.

<a id="bt-488"></a>
### BT-488 · P2 · effort S · GMV not measurable in PostHog: purchase_completed sends only an amount bucket

- **Where:** server · `artifacts/api-server/src/routes/webhooks.ts:1208,artifacts/api-server/src/lib/analytics.ts:16-18`
- **Problem:** purchase_completed carries amount_bucket, not a value, so revenue, LTV and cohort GMV can't be summed in analytics. Admin revenue is the only GMV source and has no cohort or acquisition dimension.
- **Why it costs money:** Paid acquisition and referral ROI can't be computed, so money gets spent blind on growth.
- **Fix:** Add an integer revenue_cents property (not PII) to purchase_completed and the new subscription events, or build cohort GMV views in admin from orders joined to users.createdAt.
- **$ impact:** Enables ROI on growth spend.

<a id="bt-489"></a>
### BT-489 · P2 · effort M · No install/acquisition attribution for Brandthread's own marketing

- **Where:** n/a · `artifacts/mobile/server/landing.js:13-14,artifacts/api-server/src/lib/growth/utm.ts`
- **Problem:** Landing pages accept utm_* params but nothing persists them to the signup. UTM handling exists only for sellers' own growth links. There is no MMP/SKAdNetwork attribution (no AppsFlyer, Adjust or Branch).
- **Why it costs money:** Launch ads, influencer and creator spend can't be tied to seller or buyer signups or revenue.
- **Fix:** Persist first-touch utm/referrer on web (cookie into onboarding into users.acquisitionSource) and send it as a PostHog person property. For iOS, use App Store campaign links (pt/ct) at minimum.
- **$ impact:** Paid-acquisition efficiency.

<a id="bt-490"></a>
### BT-490 · P2 · effort M · Search is the slowest path: ~24 req/s ceiling after Phase 2 fixes

- **Where:** server · `docs/scale/DATABASE.md:42-55,artifacts/api-server/src/routes/public.ts:576-590`
- **Problem:** The load test shows /public/search tops out around 24 req/s at p95 29 s on a 4-core box, bounded by Postgres CPU. The result cache (Phase 3) only works with REDIS_URL.
- **Why it costs money:** Search is the buyer's path to purchase. Slow search means lost purchases, and it spikes DB cost for every other route.
- **Fix:** Enable REDIS_URL so the responseCache middleware caches search, and consider Typesense/Meilisearch post-launch.
- **$ impact:** Buyer conversion on discovery.

<a id="bt-491"></a>
### BT-491 · P2 · effort M · Object storage has no lifecycle/cost guard for large uploads (45MB JSON bodies, 80MB clips, in-request ffmpeg)

- **Where:** server · `artifacts/api-server/src/app.ts:164-166,docs/scale/SCALE_PLAN.md:16`
- **Problem:** express.json accepts 45MB bodies globally, video clips up to 80MB are buffered in API memory, and compose-video runs ffmpeg inside the request. Only design-studio and story cleanup jobs prune storage.
- **Why it costs money:** Memory spikes crash instances, so autoscale adds more of them and cost rises. Unpruned media grows the storage bill linearly.
- **Fix:** Lower the global JSON limit (keep 45MB only on the specific photo routes), move uploads to signed direct-to-GCS URLs, and add GCS lifecycle rules for orphaned uploads and abandoned drafts.
- **$ impact:** Storage and compute cost control.

<a id="bt-492"></a>
### BT-492 · P3 · effort S · Sample & bulk card orders DO take 5% via destination charge (wired, not stubbed)

- **Where:** sample-detail · `artifacts/api-server/src/routes/sample-orders.ts:193,artifacts/api-server/src/routes/sample-orders.ts:319-341,artifacts/api-server/src/routes/manufacturer-flow.ts:209`
- **Problem:** Seller pays sample/bulk order cards through Stripe Checkout with application_fee_amount = platformFeeCents (5%) and transfer_data to the manufacturer's Connect account. This works end to end, but it is the only B2B take that exists, and the fee comes out of the manufacturer's side.
- **Why it costs money:** Confirms B2B production GMV is already monetised at 5%, so every fix below that moves more production spend onto cards adds revenue directly.
- **Fix:** Keep this. Track sampleOrders.platformFeeCents as its own revenue line (see admin findings) and pick one pricing owner for the B2B take before launch.
- **$ impact:** Baseline: about $0.05 gross per $1 of B2B GMV. $100k/mo of production GMV is about $5k/mo gross.

<a id="bt-493"></a>
### BT-493 · P3 · effort S · Legacy /me/payment stores bank/PayPal/Wise details that never pay out

- **Where:** server · `artifacts/api-server/src/routes/manufacturers.ts:1775-1838`
- **Problem:** GET/POST /manufacturers/me/payment still accepts method, bankName, paypalEmail and wiseEmail and stores last4 in manufacturer_payments. Nothing reads it for payouts (all payouts go through Stripe Connect), and it reports isSetup: true.
- **Why it costs money:** A manufacturer or client that hits this endpoint believes payouts are configured. Card payment then fails with MANUFACTURER_PAYOUTS_INCOMPLETE and the order stalls. It also suggests PayPal/Wise is an accepted channel.
- **Fix:** Mark the endpoint deprecated: return isSetup from Connect readiness, and have POST return 410 pointing to /manufacturers/connect/onboard. Additive: add a deprecation flag rather than deleting.
- **$ impact:** Small, avoids stalled orders and confusion.

<a id="bt-494"></a>
### BT-494 · P3 · effort S · Wallet/bulk transfers and cross-border manufacturer payouts are USD-only, and Brandthread absorbs FX/cross-border fees

- **Where:** production-detail · `artifacts/api-server/src/routes/sample-orders.ts:845-847,artifacts/api-server/src/routes/manufacturer-connect.ts:46-55,docs/payments/money-flow.md:312-315`
- **Problem:** Manufacturers abroad use 'recipient' Connect accounts. Transfers are in USD and Stripe charges cross-border payout fees (about 0.25-1%) plus FX on the platform side. None of this is modelled in the fee.
- **Why it costs money:** International factories are most of the supply. Unmodelled fees cut the already-thin net B2B take, and some countries are unsupported, which pushes those factories to wire.
- **Fix:** Model cross-border transfer fees in the B2B fee (pass through or price in). Publish a supported-country list in the portal, and for unsupported countries consider Stripe Global Payouts.
- **$ impact:** About 0.5-1% of international B2B GMV.

<a id="bt-495"></a>
### BT-495 · P3 · effort S · brandthread.app is the full Expo web app plus a static marketing landing: buyers CAN buy on web

- **Where:** n/a · `artifacts/mobile/server/serve.js:16-17,artifacts/mobile/server/serve.js:160-176,artifacts/mobile/server/landing.js:52-60,artifacts/mobile/components/checkout/StripePayment.web.tsx:2-42,artifacts/api-server/src/routes/guest-checkout.ts`
- **Problem:** serve.js serves the exported Expo web app at brandthread.app, plus landing.html for signed-out '/' and '/welcome'. Web checkout uses Stripe Elements (StripePayment.web.tsx), and guest checkout exists. brandthread-woven is only a design-system gallery and app-tour is a slide deck; neither is the storefront.
- **Why it costs money:** Web purchase and web seller subscription avoid Apple's 15-30% cut. The plumbing exists, so the gap is distribution (SEO, pricing page, acquisition), not capability.
- **Fix:** Treat web as the primary seller-acquisition funnel: drive paid and organic traffic to brandthread.app/welcome and onward to /onboarding and the Stripe subscription checkout.
- **$ impact:** Informational. Each web-signup seller avoids 15-30% of the subscription to Apple.

<a id="bt-496"></a>
### BT-496 · P3 · effort S · API-domain /u/:username landing only has a brandthread:// deep link (dead on desktop)

- **Where:** server · `artifacts/api-server/src/routes/profileLanding.ts:70`
- **Problem:** The server-rendered profile page's only CTA is href='brandthread://u/...'. On desktop, or on mobile without the app, it does nothing. There is no web profile/store link, App Store badge or 'Shop on web' button.
- **Why it costs money:** Shared profile links that resolve to the API host lose the visitor, both buyers and potential sellers.
- **Fix:** Add 'View on web' (https://brandthread.app/u/...) and App Store/Play links. Prefer redirecting the API /u/ route to brandthread.app/u/.
- **$ impact:** Small traffic leak.

<a id="bt-497"></a>
### BT-497 · P3 · effort S · App tour slide deck is deployed publicly at /app-tour/

- **Where:** n/a · `artifacts/app-tour/.replit-artifact/artifact.toml:15-24`
- **Problem:** app-tour has a production static build served at /app-tour/ on the same deployment. It is an internal walkthrough of onboarding screens, not a marketing page.
- **Why it costs money:** It exposes unreleased flows and duplicates the landing page with off-brand content, and it costs build time on every deploy.
- **Fix:** Remove the production section, or put it behind auth/noindex. Add Disallow: /app-tour/ to robots.
- **$ impact:** Negligible $. Hygiene.

<a id="bt-498"></a>
### BT-498 · P3 · effort M · Admin console lives inside the manufacturer portal bundle; admins are set only by SQL

- **Where:** admin (portal) · `artifacts/manufacturer-portal/src/admin/AdminApp.tsx:108-119,artifacts/api-server/src/routes/admin/guard.ts:6-12`
- **Problem:** Ops tooling ships in the manufacturer-facing app at /manufacturers/admin. Admin role grant is DB-only. There are no granular roles (support vs finance), so every support agent who needs refunds would need full admin.
- **Why it costs money:** Hiring support staff means giving them full suspend and featured powers, or doing everything yourself, which does not scale past launch volume.
- **Fix:** Add a 'support' role with read plus refund-only permissions, and consider a separate admin build/route so manufacturers never download admin code.
- **$ impact:** Ops scalability.

<a id="bt-499"></a>
### BT-499 · P3 · effort S · Mobile admin screens are limited to invites, promotions and reports

- **Where:** admin-reports · `artifacts/mobile/app/admin-invites.tsx,artifacts/mobile/app/admin-promotions.tsx,artifacts/mobile/app/admin-reports.tsx`
- **Problem:** On-the-go ops cover invite codes, boost approvals and the report queue only. Nothing for revenue, disputes due soon, or Thread Cash spikes.
- **Why it costs money:** The founder runs launch from a phone. Disputes with evidence deadlines can be missed.
- **Fix:** Add a push alert to admins for disputes needing response (disputeEvidenceReminder job exists for sellers; mirror it for admins) and a minimal admin revenue/MRR card.
- **$ impact:** Avoids missed dispute deadlines.

<a id="bt-500"></a>
### BT-500 · P3 · effort S · Web analytics fires only after cookie-banner consent, so most web funnel data will be missing

- **Where:** n/a · `artifacts/mobile/lib/analytics/gate.ts:19-23`
- **Problem:** On web, consent is true only after the visitor grants the Analytics cookie category. Native is always on. Web (the no-Apple-fee funnel) will be under-measured.
- **Why it costs money:** The most profitable funnel (web seller subscribe) has the least data.
- **Fix:** Use cookieless/anonymous server-side counting for funnel steps (subscription checkout started/completed from the API) so web conversion is visible without cookies.
- **$ impact:** Measurement quality.

<a id="bt-501"></a>
### BT-501 · P3 · effort S · Clerk and AI bills scale per user with no billing alerts documented as done

- **Where:** n/a · `docs/scale/SCALE_PLAN.md:85,docs/scale/SCALE_PLAN.md:125`
- **Problem:** SCALE_PLAN estimates Clerk at about $0.02/MAU above the free tier and says to 'set billing alerts before launch campaigns'. Nothing in docs/launch confirms alerts are set for Clerk, OpenAI, Stripe or GCS.
- **Why it costs money:** A viral buyer spike (buyers pay nothing) raises Clerk and infra cost with no revenue. 100k MAU is about $2k/mo of Clerk alone.
- **Fix:** Set vendor billing alerts and a monthly budget per vendor, and add them to docs/launch/dev-only-tasks.md.
- **$ impact:** Cost visibility. Up to about $2k/mo at 100k MAU.
