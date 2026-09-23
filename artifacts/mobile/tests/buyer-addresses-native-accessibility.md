# Shipping-address native accessibility verification

The Appium check uses the native iOS or Android accessibility tree, not the web DOM. It verifies the back/close, edit, delete, retry, and set-default actions; the default checkbox's checked state; and address-card focus order. XML evidence is written under `test-results/buyer-addresses-accessibility/<platform>/`.

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