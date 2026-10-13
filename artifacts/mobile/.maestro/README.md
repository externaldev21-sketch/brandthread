# Maestro end-to-end tests

Five flows cover the money paths (polish #246):

| Flow | What it does | Needs |
| --- | --- | --- |
| `sign-up` | Get started → I'm here to shop → account form → email code → onboarding → Start exploring | Clerk **development** instance (test address `+clerk_test`, code `424242`) |
| `buy` | Product → Add to bag → checkout → Place order (Stripe test card) | `PRODUCT_ID`: in-stock product, no required size; signed-in buyer |
| `sell` | Add product → photo → title → Save | Signed-in seller |
| `ship` | Fulfill order → tracking by hand → Mark as Shipped | `ORDER_ID_TO_SHIP`: paid, unshipped order in that seller's store |
| `refund` | Refund request → Item damaged → Submit | `ORDER_ID_TO_REFUND`: delivered order of the signed-in buyer |

Use a **test** backend and Stripe test mode. Never point these flows at
production: they create accounts, orders and listings.

## Run locally

1. Install Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
2. Install a simulator / emulator build: `eas build --profile preview --platform ios`
   (or a dev client), then drag it onto the simulator.
3. From `artifacts/mobile`:

```sh
maestro test .maestro/flows \
  -e MAESTRO_RUN_ID=$(date +%s) \
  -e PRODUCT_ID=<product id> \
  -e ORDER_ID_TO_SHIP=<order id> \
  -e ORDER_ID_TO_REFUND=<order id>
```

Run one flow: `maestro test .maestro/flows/refund.yaml -e ORDER_ID_TO_REFUND=<id>`.

## CI

`.github/workflows/maestro.yml` runs the suite on Maestro Cloud when started
by hand (Actions → **Maestro e2e** → Run workflow) with a link to a simulator
`.app` zip or an `.apk`. It does nothing until the repository has:

- Secret `MAESTRO_CLOUD_API_KEY`: sign up at https://cloud.mobile.dev, then Settings → API key.
- Variables `E2E_PRODUCT_ID`, `E2E_ORDER_ID_TO_SHIP`, `E2E_ORDER_ID_TO_REFUND` (Settings → Secrets and variables → Actions → Variables).

## Keeping flows in sync

`tests/maestro-flows.test.ts` runs with `pnpm test`. It fails when a flow uses
a `testID`, button text or deep-link screen that no longer exists in the app.
Update the flow in the same PR as the UI change.
