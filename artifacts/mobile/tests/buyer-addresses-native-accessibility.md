# Shipping-address native accessibility verification

The Appium check uses the native iOS or Android accessibility tree, not the web DOM. It verifies the back/close, edit, delete, retry, and set-default actions; the default checkbox's checked state; and address-card focus order. Release XML evidence is written under `test-results/buyer-addresses-accessibility/<platform>/<normal|retry>/`.

## Test account

Before the normal-state run, sign the installed Brandthread build into a disposable buyer account and seed two addresses in visible order. The first must be the default address and the second must not be default. Set `NATIVE_BUYER_ADDRESS_LABELS` if their labels are not `Home,Office`.

The set-default action changes the disposable account temporarily, then the check restores the first address as default before it exits. The delete action opens the native confirmation dialog and cancels it, so it does not remove data. Use separate disposable accounts when running platforms concurrently; sequential runs can reuse the same account.

## Commands

Run both platforms against their Appium servers:

```sh
NATIVE_BUYER_ADDRESSES_PLATFORM=ios NATIVE_BUYER_ADDRESSES_REQUIRED=1 pnpm test:buyer-addresses:native
NATIVE_BUYER_ADDRESSES_PLATFORM=android NATIVE_BUYER_ADDRESSES_REQUIRED=1 pnpm test:buyer-addresses:native
```

To verify retry, arrange for the signed-in test account's address-list request to fail, then run each platform with:

```sh
NATIVE_BUYER_ADDRESSES_PLATFORM=ios NATIVE_BUYER_ADDRESSES_EXPECT_RETRY=1 NATIVE_BUYER_ADDRESSES_REQUIRED=1 pnpm test:buyer-addresses:native
NATIVE_BUYER_ADDRESSES_PLATFORM=android NATIVE_BUYER_ADDRESSES_EXPECT_RETRY=1 NATIVE_BUYER_ADDRESSES_REQUIRED=1 pnpm test:buyer-addresses:native
```

The required mode fails instead of skipping when Appium is unavailable. Without `NATIVE_BUYER_ADDRESSES_REQUIRED=1`, local runs skip cleanly when no device server is configured.

## Release gate

`.github/workflows/mobile-shipping-address-accessibility.yml` runs the check for both native
platforms on mobile release tags and when called by another release workflow. Its mobile-release
gate cannot pass until both platform jobs pass. Each configured device runner must provide an
installed, sign-in-capable release build and these environment values:

- `APPIUM_SERVER_URL` and the platform's Appium capabilities.
- `NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT`, a non-production account identifier.
- `NATIVE_BUYER_ADDRESS_LABELS`, naming exactly two addresses.
- `NATIVE_BUYER_ADDRESSES_PREPARE_COMMAND`, which signs in the disposable buyer and resets it to
  exactly two addresses in the named order (first default).
- `NATIVE_BUYER_ADDRESSES_ARM_FAILURE_COMMAND`, which makes the next address-list request fail
  once and then recover so the Retry action can succeed.
- `NATIVE_BUYER_ADDRESSES_CLEANUP_COMMAND`, which removes the seeded addresses/session even when a
  check fails.

The release wrapper rejects any missing prerequisite instead of skipping. GitHub uploads the XML
trees for each platform and scenario even when the check fails.
