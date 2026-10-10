# Manufacturer recruiting plan (30–50 real factories before launch)

Goal: a seller who opens Manufacturer Hub on day one finds real, verified factories in the categories
Brandthread sellers make, and every seller can bring their own factory in one tap. No fake listings:
the directory only shows manufacturers that signed up themselves, accepted the Manufacturer Terms and
passed verification (email + phone + Stripe payouts, or an admin approval).

## Targets

| Category (from portal specialties) | Factories | Notes |
| --- | --- | --- |
| Cut & Sew (tees, hoodies, sweats) | 10–14 | Highest seller demand; mix of low-MOQ (50–100) and scale (500+) |
| Knitwear | 4–6 | Portugal, Vietnam, China |
| Denim | 3–5 | Low-MOQ wash houses matter most |
| Activewear / Swimwear | 4–6 | |
| Outerwear | 2–4 | |
| Leather goods / Accessories (bags, caps) | 4–6 | |
| Screen printing / Embroidery (decoration only) | 3–5 | Domestic (US) shops for fast blanks + print |

Regions: US domestic (fast samples, no cross-border payout issues), Portugal, Turkey, Vietnam, China,
India, Pakistan, Mexico. Stripe must support payouts in the country (the portal already checks this
in payout setup; cross-border factories use Stripe's recipient agreement).

Timeline: week 1 build the lead list (100–150 leads), weeks 2–3 outreach + calls, week 4 onboarding
help, launch with 30+ verified and 50 in the pipeline.

## Sources (real factories only)

1. **Seller-sourced (cheapest, highest intent):** ask every seller in the beta who already has a
   factory to invite it from Manufacturer Hub → Invite a manufacturer (private by default). The empty
   hub now shows "Invite your factory" for exactly this.
2. **Sourcing directories:** Maker's Row (US), Sqetch (EU), Fashion United, Kompass, Alibaba Gold
   Suppliers with "Customization" + verified factory audit, Faire/Etsy wholesale makers.
3. **Trade shows / lists:** Texworld, Première Vision Manufacturing, MAGIC Sourcing exhibitor lists.
4. **Referrals:** each onboarded factory names 2 partner factories (dye house, trim supplier, printer).
5. **LinkedIn / Instagram:** factory owners posting production reels; DM, then email.

Qualify before inviting: real business name and address, photos of their own floor, MOQ and lead
times they will commit to, takes card/ACH payouts through Stripe, responds within 48h.

## Outreach email (send with the import script, or by hand)

Subject: List {Company} on Brandthread

> Hi {Name},
>
> Independent fashion brands on Brandthread are looking for factories like {Company}.
>
> Brandthread is where brands send you their designs, you price samples and bulk orders as cards in
> the chat, update production as you go, and get paid to your bank through Stripe.
>
> Free to join. 5% + processing on paid orders. No listing fee.
>
> Create your profile (about 10 minutes, plus Stripe payout setup): {join link}
>
> Reply here if you'd like a 15-minute call first.
> — {Your name}, Brandthread

Follow-ups: day 3 (one line + link), day 7 (offer a call), then stop. Keep the fee line exactly as
above so it matches the portal and the Manufacturer Terms.

## Invite flow

1. Put recruited factories in a CSV with columns `company_name, contact_email, country,
   contact_name, specialty, city, website, phone, source, notes` (first three required).
2. Dry run (default, writes nothing, flags factories already on Brandthread):
   `pnpm --filter @workspace/api-server run import:manufacturers -- factories.csv`
3. Send: `pnpm --filter @workspace/api-server run import:manufacturers -- factories.csv --apply --send-emails --out links.csv`
   - Without `--seller`: each factory gets the public join link (they become a public listing once verified).
   - With `--seller <clerkId>`: private invite tokens bound to that seller (their own factories; private by default).
   - Emails use the existing Brandthread email provider. Without `RESEND_API_KEY` (or the Resend
     connector) the script prints the links instead of emailing.
4. The factory signs up in the portal, ticks "I agree to the Manufacturer Terms", fills the profile and
   photos, then sets up Stripe payouts.
5. Verification happens automatically when their email is verified, a phone is on the profile and
   Stripe payouts are ready with nothing past due. Until then the portal shows one line with what's
   missing, and the profile is not in the public directory and can't send payable cards. Admins can
   approve or reject via `POST /api/admin/manufacturer-trust/verification/:id`.
6. Track: `GET /api/admin/manufacturer-trust/verification?status=pending_verification` lists who is
   stuck and on which step; call or email them.

## Quality bar for launch

- 30+ verified factories, at least 3 per top category, at least 10 with 3+ factory photos.
- Every listing answers new requests (RFQ / quote request emails go to their contact email).
- Weekly: check `GET /api/admin/manufacturer-trust/contact-signals` for factories (or sellers)
  repeatedly sharing contact details or asking for off-platform payment.
