# Stripe Radar rules for Brandthread

What to paste into **Stripe Dashboard > Radar > Rules**, why each rule exists, and which parts are Dev's call.
Written for a marketplace selling physical goods and preorders, charged as Connect **destination charges**
(see `money-flow.md`). Nothing here is code: Radar is configured in the Stripe Dashboard only.

Legend: **[Free]** works on standard Radar (included with Stripe card processing). **[Teams]** needs
**Radar for Teams**, a paid add-on billed per screened transaction (check the current price on
stripe.com/radar/pricing before enabling; it changes). **[Dev]** is a decision only Dev can make.

A caveat on syntax: attribute names below are the ones Stripe documents for the rule editor as best we know
them. The rule editor autocompletes and validates attributes and shows a backtest, so if an attribute name is
rejected, pick the nearest one from the autocomplete list. Items we are unsure of are marked **(verify)**.

## 1. Connect: where Radar runs and who configures it

- Brandthread creates destination charges on the **platform** account. Radar evaluates every such charge on
  the platform account, so **the rules live in Brandthread's Stripe Dashboard and apply to every seller**.
- Sellers do not configure Radar, cannot see the rules, and cannot override them. Their own (Express)
  dashboard does not expose Radar. Do not promise sellers per-store rules.
- A blocked payment never becomes an order (the checkout simply fails for the buyer), so sellers only hear about
  payments that passed the rules. Payments sent to **review** are authorised and captured normally; the app
  flags them to the seller (see section 7) so they can hold shipment.
- Radar for Teams is billed to the platform, not to sellers.

## 2. Free Radar versus Radar for Teams

| Capability | Free Radar | Radar for Teams |
|---|---|---|
| Stripe's ML risk scoring on every charge (`risk_level`, `risk_score` on the charge outcome) | Yes | Yes |
| Stripe's default rules (block when risk is highest; 3D Secure when the card requires it) | Yes | Yes |
| Seeing `risk_level` / `seller_message` on the charge and in webhooks | Yes | Yes |
| **Custom** block / review / 3D Secure / allow rules | No **(verify which defaults can be toggled on free)** | Yes |
| Rules on `:risk_score:` (numeric threshold) | No | Yes |
| Manual review queue (the `review.opened` / `review.closed` events) | No | Yes |
| Velocity rules (counts per card / email / IP over time windows) | No | Yes |
| Allow lists / block lists (emails, IPs, cards, countries) | Lists need Teams | Yes |
| Rule backtesting against past payments | No | Yes |

So: **everything in sections 3 to 6 below is [Teams]** except the first block rule, which is the default and
already active. If Dev stays on free Radar, the app still shows the seller a flag when Stripe rates a payment
elevated/highest or a card check fails (section 7), but Stripe will not queue reviews and no custom rule can
block or challenge anything.

## 3. Block rules

Paste each as a separate rule. Order does not matter for block rules.

| # | Rule | Tier | Why |
|---|---|---|---|
| B1 | `Block if :risk_level: = 'highest'` | Free (default, keep it on) | Stripe's own model is very confident this is fraud. False-positive cost on physical goods is lower than the chargeback plus lost inventory. |
| B2 | `Block if :cvc_check: = 'fail'` | Teams | A wrong CVC on a card-not-present sale is the classic stolen-number pattern. Buyers who fat-finger it can retry. |
| B3 | `Block if :address_zip_check: = 'fail' and :address_line1_check: = 'fail'` | Teams | Both billing checks failing together is strong; either one alone is handled by review (R3). Single-check blocking hurts legitimate international buyers whose banks do not support AVS. |
| B4 | `Block if :risk_score: > 85` **(verify the attribute name)** | Teams | Catches the tail just under "highest". **[Dev]** confirm the number after the first two weeks of live data; start here and tune using backtests. |
| B5 | `Block if :total_charges_per_ip_address_hourly: > 5` **(verify)** | Teams | Card-testing scripts hit one IP many times. |

Card testing (many small charges to find live cards) is also a risk to the platform's Stripe account standing,
so do not relax B1 or B5 to reduce friction.

## 4. Review rules (Teams)

Reviews send the payment to the Radar review queue and emit `review.opened`. Brandthread then marks the order
"Review before shipping" for the seller. The platform owner (Dev or whoever Dev names) works the queue; sellers
do not see it.

| # | Rule | Why |
|---|---|---|
| R1 | `Review if :risk_level: = 'elevated'` | The standard "second look" rule. |
| R2 | `Review if :cvc_check: = 'unavailable'` is **not** recommended | Many non-US cards return unavailable; it would flood the queue. Only fails are actioned (B2). |
| R3 | `Review if :address_zip_check: = 'fail' or :address_line1_check: = 'fail'` | One failed billing check: suspicious but common for legitimate buyers with moved addresses. |
| R4 | `Review if :billing_address_country: != :shipping_address_country:` **(verify both attribute names and that you can compare them in one expression; otherwise use two rules or the :ip_country: variant)** | Shipping to a different country than the card's billing country is the standard freight-forwarder / reshipper pattern. Gifts to family abroad also trigger it, so review, not block. |
| R5 | `Review if :amount_in_usd: >= 300 and :is_new_customer: = true` **(verify `:is_new_customer:` exists; Stripe has had attributes about first-time customers/cards, otherwise approximate with the amount rule alone)** | High-value first order. The app uses the same idea for its own flag: `HIGH_VALUE_THRESHOLD_CENTS = 30000` in `lib/risk/orderRisk.ts`. **[Dev]** pick the dollar threshold. |
| R6 | `Review if :card_count_for_email_daily: > 2` **(verify)** | Several different cards tried under one email in a day. |
| R7 | `Review if :card_count_for_ip_daily: > 3` **(verify)** | Several different cards from one IP in a day. |
| R8 | `Review if :ip_country: != :card_country:` **(verify)** | Buyer appears to be in a different country than the card was issued in. Noisy for travellers and VPN users; **[Dev]** decide whether to enable or keep as information only. |
| R9 | `Review if :risk_score: > 65` **(verify)** | Numeric version of R1 if Dev wants to tune it instead of using the elevated bucket. Use R1 **or** R9, not both. |

Keep reviews rare. A queue nobody works is worse than no queue. **[Dev]** decide who works the queue and the
target time (for preorders the natural deadline is before the drop's funds would be released; see
`dropLifecycle.ts`). Approving a review in the Dashboard closes it (`review.closed`, reason `approved`).
Refunding as fraud closes it with `refunded_as_fraud`; Brandthread raises the order to "highest" in that case.

## 5. 3D Secure (request authentication)

3D Secure (3DS) shifts fraud liability to the issuer on a successful authentication, and cuts the dispute
rate. It adds friction and some drop-off.

| # | Rule | Tier | Why |
|---|---|---|---|
| S1 | `Request 3D Secure if 3D Secure is required for card` | Free (default) | Mandatory for cards that require it (for example SCA markets). Leave on. |
| S2 | `Request 3D Secure if :risk_level: = 'elevated'` | Teams | Lets the moderately risky buyer prove themselves instead of being reviewed. Good first choice if the review queue would be too large. |
| S3 | `Request 3D Secure if :amount_in_usd: >= 300` **(verify)** | Teams | Makes high-ticket orders liability-protected. **[Dev]** pick the threshold. |
| S4 | `Request 3D Secure if :billing_address_country: != :shipping_address_country:` **(verify)** | Teams | Cheaper alternative to R4 when Dev does not want a queue. |

Brandthread's checkout uses Stripe Checkout / the Payment Element, which run 3DS challenges automatically
when Radar requests them. No code change is needed.

## 6. Allow lists and their danger

- **[Teams]** allow rules exist (for example an allow rule on a specific email or IP; exact syntax **(verify)** in the rule editor), but an allow rule **overrides blocks**.
  Do not allow-list buyers or sellers for convenience; a compromised account would bypass everything.
- Allowed uses: Dev's own test email/IP, and Brandthread QA accounts (keep the list tiny and review it
  quarterly). Put allow rules **last** in the rule list so that they do not shadow the blocks.
- Do not allow-list sellers buying their own products (self-purchase is a separate problem: wash trading of
  reviews or fee avoidance), and do not allow-list by country.
- **[Dev]** confirm whether internal team accounts should be allow-listed at all. Stripe test mode is usually
  enough for QA.

## 7. What the app does with Radar (already built)

- On every paid order the webhook reads the charge's `outcome` (`risk_level`, `risk_score`, `type`), the card
  checks (`cvc_check`, `address_line1_check`, `address_postal_code_check`), the billing country, the shipping
  country, the order total and whether it is the buyer's first order.
- `lib/risk/orderRisk.ts` turns those into flags and an overall level (`normal`, `elevated`, `highest`), stored
  in `orders.risk_level`, `risk_score`, `risk_flags`, `risk_reviewed` (migration 115).
- `review.opened` adds an "under review" flag; `review.closed` sets `risk_reviewed`.
- The **seller** order screen shows a silver/black "Review before shipping" pill for elevated or highest orders;
  tapping it lists the reasons. Buyers never receive any of it (the buyer order endpoints do not select these
  columns).
- Works on free Radar too: the charge outcome and card checks are always present. Only the review events need
  Radar for Teams. Nothing is blocked by the app; it informs. Enforcement is the Stripe rules above.
- Orders created before migration 115 have no risk data and show no pill.

Webhook setup: add `review.opened` and `review.closed` to the events sent to `/api/webhooks/stripe` in
Dashboard > Developers > Webhooks (platform endpoint). Without them, reviews are not reflected in the app.

## 8. Testing with Stripe test cards

Use **test mode**; Radar evaluates test payments too. Numbers below come from Stripe's testing page. Stripe
can change them, so if one does not behave, the testing page is the authority. Any future expiry, any CVC
(except where noted), any ZIP.

| Card | Expected Radar behaviour |
|---|---|
| `4100 0000 0000 0019` | Always blocked with risk level **highest** (verifies B1). |
| `4000 0000 0000 9235` | Charge succeeds with risk level **elevated** (verifies R1/S2 and the app's "Review before shipping" pill). |
| `4000 0000 0000 4954` | Blocked / highest-risk style result (verify against the testing page before relying on it). |
| `4000 0000 0000 0101` | `cvc_check` fails (verifies B2 and the `cvc_failed` flag) **(verify)**. |
| `4000 0000 0000 0028` | `address_line1_check` fails, postal passes **(verify)**. |
| `4000 0000 0000 0036` | `address_postal_code_check` fails, line 1 passes **(verify)**. |
| `4000 0027 6000 3184` | Requires 3D Secure authentication (verifies S1/S2 flows). |

Procedure: create a test checkout with a Connect test seller, use a card above, then check (a) Dashboard >
Payments > the payment > Radar/risk section, (b) a blocked card returns a decline at checkout and no order, (c)
for an elevated card, the seller order detail shows the pill with "Stripe rated this payment elevated risk",
(d) billing country differing from shipping country (enter a Canadian billing address and a US shipping
address) shows the country-mismatch flag. Use the Radar rule **backtest** before turning on any new
[Teams] rule in live mode.

## 9. Disputes: the tie-in

Radar lowers disputes; it does not remove them. `charge.dispute.*` events are already handled
(`routes/disputes.ts`, `money-flow.md`). How they connect:

- Radar's `outcome` and the AVS/CVC results are part of the evidence trail. Orders that were 3DS-authenticated
  get issuer liability shift on fraud disputes, which is why S2/S3 pay for themselves on high-value carts.
- The seller's strongest dispute evidence for physical goods is proof of delivery: carrier, tracking number,
  delivery confirmation, and shipping address matching the billing address. Orders flagged elevated/highest are
  exactly the ones where the seller should use a tracked, signature-on-delivery service. The pill tells them
  before they ship.
- Flags (for example `country_mismatch`, `cvc_failed`) are stored on the order, so when a fraud dispute arrives
  the evidence screen can show the seller what Stripe saw at payment time.
- Stripe's Early Fraud Warnings (`radar.early_fraud_warning.created`) are a separate Stripe feature; the app does
  not use them yet. **[Dev]** decide whether to refund proactively on an EFW (it usually avoids the dispute fee);
  that would be a separate change.

## 10. Decisions that are Dev's to make

1. Stay on free Radar, or pay for Radar for Teams (needed for every custom rule, the review queue, velocity
   rules and `:risk_score:` rules). Recommendation: enable Teams before the first public preorder drop, because
   drops concentrate high-value first-time buyers.
2. The dollar threshold for "high value" (app default is $300; rules R5 and S3 should match).
3. Review (R1) versus 3D Secure (S2) for elevated risk, or both. Recommended starting point: S2 + R3 + R4, and
   R1 only if someone will work the queue daily.
4. Whether billing/shipping country mismatch (R4/S4) reviews or only challenges. Affects gift buyers.
5. Who works the review queue, and the response deadline relative to drop release.
6. Whether any allow rules exist at all (section 6).
7. Whether to act on Early Fraud Warnings.
8. Whether sellers should be told more than "Review before shipping" (currently they see flags only, no
   Stripe rule names).
