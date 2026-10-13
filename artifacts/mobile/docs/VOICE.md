# Brandthread voice

How every word in the app reads. Dev approved these rules on Oct 12 (the
"less-AI pass", items 1–20). When a rule and an older screen disagree, the
rule wins. `pnpm --filter @workspace/mobile run lint:voice` checks the
mechanical ones.

Brandthread talks like a friend who runs a clothing brand: short, specific,
no hype. Say what happened or what the button does, then stop.

## Words

- **No hype words.** Never: Unlock (except a real lock), Elevate, Seamless,
  Supercharge, Effortless(ly), Your journey, Empower.
- **No AI labels buyers can see.** No "AI-powered", "Smart …", "Magic …" on
  buyer screens. Seller tools can name a tool ("AI Design") but not brag
  about it. Where the law asks us to say a reply is automated, say
  "Automated replies" plainly.
- **Clothing words.** Drop, Fit, Restock, Sold out. Not "release", "outfit
  post", "back in stock", "unavailable" (when the item has sold out).
- **No decorative emoji or ✨ in labels.** Emoji the user picked (a
  highlight cover, a reaction) stays.
- **No exclamation points.** One exception: the seller's first sale.

## Buttons and dialogs

- **Buttons say what they do.** "Add your first fit", "Open my store".
  Never "Get started", "Let's go", "Continue" as a first button.
- **Dialog buttons are verbs on the thing.** "Delete product" / "Keep".
  Not "OK" / "Cancel" when a verb fits; not "Yes" / "No".

## Feedback

- **Toasts: three words max.** "Link copied", "Saved", "Comment deleted".
- **Errors name the problem and the fix.** "Card declined. Try another
  card." "No connection. Try again." Errors may run past three words; the
  fix is the point.
- **Notifications read like a person said them.** "Maya bought the Desires
  tee", not "New order received for product #4521".
- **Numbers say real things.** "3 people bought this today". Only show a
  number the server actually has; never round it into a vibe ("Trending!").

## Screens

- **No subtitle that explains the screen.** The title and the content do
  that. Keep a subtitle only when it carries data (a count, a date, a status).
- **Section headers are one word.** "Orders", "Payouts", "Privacy".
- **Settings rows have no explainer text** unless the setting is dangerous
  (delete account, make profile public, turn off two-factor).
- **Placeholders are real examples.** "Desires tee", "Washed black, boxy fit",
  not "Enter product name".
- **Onboarding: under 8 words a screen,** in a friend's tone. "What do you
  sell?" not "Tell us about the products your brand offers."
- **Legal and policy pages open with a plain-English summary** of what the
  page means for you, before the legal text.

## Formats

- **Money:** `$1,240` for whole amounts, `$12.50` when there are cents.
  Always the `$` sign and a thousands comma. Use `formatMoney` from
  `lib/format.ts` for display; receipts and checkout lines keep cents
  (`formatCents`) so the math visibly adds up.
- **Dates:** relative. `now`, `5m`, `2h`, `Yesterday`, `Mar 4`, then
  `Mar 4, 2025` once it's a different year. Use `fmtRelativeDay` from
  `lib/format.ts`.

## Motion

An animation only exists if it tells the user something happened (added to
cart, sent, saved). No decorative motion. The seller swipe glow is the one
"wow" effect and stays exactly as it is.
