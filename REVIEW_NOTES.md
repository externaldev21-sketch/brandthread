# Brandthread: notes for App Review

Paste the rendered version of this file into App Store Connect (App Review
Information, Notes) and the Play Console "App access" instructions. The
`{{...}}` values are filled from environment variables when you run
`pnpm --filter @workspace/api-server run seed:review-accounts -- --render-notes`
(stdout only; never commit the rendered output).

## Sign in

Brandthread is a social marketplace. Two demo accounts are provided. Both are
fully onboarded and need no email or SMS code.

| Role | Email | Password |
| --- | --- | --- |
| Buyer | `{{REVIEW_DEMO_BUYER_EMAIL}}` | `{{REVIEW_DEMO_BUYER_PASSWORD}}` |
| Seller | `{{REVIEW_DEMO_SELLER_EMAIL}}` | `{{REVIEW_DEMO_SELLER_PASSWORD}}` |

Sign in with email and password on the first screen. Sign in with Apple and
Google are also offered; the demo accounts use email and password.

The seller is the store "Atelier Demo" (10 products with variants, posts and
reviews). The buyer has 5 past orders in different states (delivered, shipped,
processing, cancelled) and follows the seller.

## Where to find features

- **Shopping (buyer):** Home feed, then tap a product tag on a post, or
  Discover / Search. Add to cart, check out, then see it under Profile, Orders.
- **Live video:** a seller starts it from Studio, Go live (camera and microphone
  prompts appear). A buyer joins a live stream when a followed seller is live (Home feed
  and the seller's profile). No live stream is scheduled at review time; Go live with the
  seller account to see the camera flow.
- **Camera:** Studio, Create (photo, video, story) and Go live. The buyer story
  composer also uses the camera.
- **Calls:** 1:1 voice and video calls start from the call button in a
  conversation (Inbox). Calls need two devices or accounts.
- **AI features (seller):** Studio, AI Studio and Design Studio (photoshoot,
  background removal, text-to-design, mockups). They call our server, which
  calls a third-party model provider. Output is generated for the user's own
  products and is not shared unless the user posts it. AI is optional.

## Payments

Physical goods and services are paid through Stripe (Apple Guideline 3.1.3(e)).
The production backend uses live Stripe keys, so test card numbers are
rejected. You can open the checkout and payment sheet without paying. The buyer
account already has 5 past orders (delivered, shipped, processing, cancelled)
under Profile, Orders, so order detail, tracking and reviews can be reviewed
without a new purchase. No charge is made unless a real card is used.

Every digital purchase in the iOS app uses in-app purchase: seller subscription
plans, Boost, Create ad, Featured on Discover and AI credit packs. If a paid
promotion is rejected in our review or cancelled before it runs, the purchase
is returned to the seller as credit for their next promotion.

## User-generated content and moderation (Guideline 1.2)

- Every post, comment, story, profile, live stream and message has a **Report**
  action in its menu (report a problem / report content). Reports are anonymous
  to the reported person.
- **Block** a user from their profile or the conversation menu. Blocked users
  cannot see or message you, and their content disappears from your feeds.
- Users must accept the Terms and Community Guidelines (zero tolerance for
  objectionable content and abusive users) at sign-up.
- Reports go to an admin moderation queue. Our safety team reviews each report
  within **24 hours** and can dismiss, remove the content, or suspend the user.
  Suspended accounts are signed out and hidden from every surface.
- Post captions are screened automatically; flagged posts are held until a moderator reviews them.

## Account deletion (Guideline 5.1.1(v))

In the app: Profile, Settings, **Delete account** (`/delete-account`). It
deletes the account and personal data in the app, with no email request needed.


## Contact

Support: support@brandthread.app. For a review blocker, contact the same
address and we respond the same day.
