# Shipping-address native accessibility verification

The Appium check uses the native iOS or Android accessibility tree, not the web DOM. It verifies the back/close, edit, delete, retry, and set-default actions; the default checkbox's checked state; and address-card focus order. Release XML evidence is written under `test-results/buyer-addresses-accessibility/<platform>/<normal|retry>/`.

## Test account

The release wrapper creates or resets a disposable Clerk buyer, revokes stale sessions, and seeds two addresses in visible order. The first is the default address and the second is not. Set `NATIVE_BUYER_ADDRESS_LABELS` if their labels are not `Home,Office`.

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
platforms weekly, on mobile release tags, and when called by another release workflow. Scheduled
runs exercise the same account creation, sign-in, address seeding, one-shot recovery, and cleanup
lifecycle without creating the `mobile-release` approval job. For release-triggered runs, that gate
cannot pass until both platform jobs pass. Each configured device runner must provide an installed,
sign-in-capable release build and these environment values:

- `APPIUM_SERVER_URL` and the platform's Appium capabilities.
- `NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT`, JSON containing the disposable account's `email`
  and `password`.
- `NATIVE_BUYER_ADDRESS_LABELS`, naming exactly two addresses.
- `NATIVE_BUYER_ADDRESSES_API_BASE_URL`, the release API origin.
- `NATIVE_BUYER_ADDRESSES_CONTROL_TOKEN`, matching the API's `RELEASE_TEST_CONTROL_TOKEN`.
- `NATIVE_BUYER_ADDRESSES_CLERK_SECRET_KEY`, a Clerk backend key for the release-test instance.

The checked-in fixture utility performs prepare, one-shot failure arming, and cleanup for both
platforms. Cleanup removes seeded addresses and revokes every disposable-account session even when
a check fails. Credentials remain runner secrets and are never checked into the repository.

The release wrapper rejects any missing prerequisite instead of skipping. GitHub uploads redacted
XML trees plus a credential-free lifecycle report for each platform even when the check fails.
