# Seller: products, inventory & store builder

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**37 P0 · 99 P1 · 36 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Scope: 45 screens in `artifacts/mobile/app` (about 25.9k lines). Read-only audit. Line numbers were checked against the working tree on 2026-09-22.

Orphan note: `product-editor.tsx`, `website.tsx`, `mobile-app-builder.tsx` and `brand.tsx` are registered in `_layout.tsx` (lines 790, 804, 978), but nothing in app/, components/ or lib/ links to them. `product-editor` is reachable only from `navigation-isolation-probe.tsx`. Their findings are real, but the quickest fix may be to delete them. They are marked "(orphan)" below.

---

### Add / edit product: `app/add-product.tsx`

Positives: the form is one scroll with collapsible advanced sections. `KeyboardAvoidingView` (1332) wraps both the scroll and the sticky footer. The footer respects `insets.bottom` (1400). Publish is disabled while it runs (1405). The exit guard offers to save a draft (431-447).

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Perf | Picked photos are never uploaded. Local `file://`/`ph://` URIs go into `media`, and `images: media.map(m => m.uri)` posts them to the server as-is. Buyers on other devices get broken images. No upload step and no progress UI exist. `lib/api.ts:261` already has an `uploadImage` helper. | add-product.tsx:694-716, 642, 653 | Upload each asset when it is picked. Show a per-thumbnail progress ring or dim overlay on the 80×80 tile and a retry badge on failure. Block Publish until uploads finish, with the button label "Uploading photos…". |
| P1 | Copy | Success is shown with a blocking Alert that uses exclamation marks: "Product published!" / "Product updated!" | 663, 673 | Use a Toast plus navigation: "Published. {name} is live." and "Changes saved". |
| P1 | Copy | Generic error "Error" / "Could not publish. Please try again." | 679 | Title "Couldn't publish", body "Check your connection and try again. Your draft is saved." |
| P1 | Copy | Validation is a wall of bullets in an Alert: "Cannot publish" / "Please fix the following:" | 556-559 | Show errors inline under each field and scroll to the first one. If an Alert stays: title "Almost there", body "Fix these to publish:". |
| P1 | UX | All validation (price, compare-at, dates, SKU) runs only on Publish, via 6 separate Alerts. No field shows an error state. | 520, 569, 575, 583, 591 | Give `FormInput` an `error` prop. Validate on blur, for example "Enter a price like 24.00" and "Must be higher than the price". |
| P1 | UX | Date fields are free-text "YYYY-MM-DD" (7 fields). | 1194-1200, 1262, 1296 | Use a native date picker. Placeholder "Pick a date". |
| P1 | Copy | "Save draft" appears twice with different behaviour: the header saves in place (1326), the footer saves and exits (1402). Both confirm with an Alert. | 1326, 1402, 468, 474 | Keep one: footer "Save draft" (save and exit) plus Toast "Draft saved". Drop the header link or make it "Save". |
| P1 | Consistency | Title Case headings: "Add Product", "Edit Product", "Basic Information", "Pricing Summary", "Sales Model" | 1325, 1353, 890, 1388 | "Add product", "Edit product", "Basic info", "Pricing summary", "Sales model". |
| P1 | A11y | Photo delete button is 20×20 with no hitSlop, and its 12pt × sits on `rgba(0,0,0,0.7)`. | 1567-1571, 738-743 | 28×28 with `hitSlop={8}` and `accessibilityLabel="Remove photo"`. |
| P2 | Motion | The Publish label switches to "Publishing..." (three dots) with no spinner. `PrimaryButton` already has `loading`. | 1404 | `loading={publishing}`, label "Publish". |
| P2 | Copy | Placeholders are weak: "https://...", "per unit", "Price override", "Add value..." | 753, 879, 1152, 1100 | "Paste an image link", "Per order, e.g. 6.50", "Variant price (optional)", "Add a value…". |
| P2 | Perf | `renderFulfillment`, `renderManufacturing` and `renderStorefront` (about 110 lines, with a disabled "Upload tech pack" stub whose copy says "available in the next release") are never rendered. Featured, visibility and SEO cannot be set. | 1208-1313, 1263 | Delete them, or add them as collapsible sections. Remove the tech-pack stub either way. |
| P2 | Perf | 1639-line screen; every keystroke re-renders all sections and `buildDraftSnapshot()` (420). | 420 | Split the sections into memoised components. |

### Product detail (seller): `app/product-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | If the product fails to load (`!product`), the screen renders an empty View with no header, back button or message. It is a dead end. | 139-143 | `EmptyState` "Couldn't load this product" / "Check your connection and try again." with [Try again] and a back header. |
| P0 | Copy | Fake actions in the overflow menu: "Duplicate" shows "Duplicating…" and does nothing; "Share" says "Share link copied" but copies nothing. | 195-196 | Wire them up (`Share.share`, a duplicate API call) or remove them. |
| P0 | Copy | Variant stubs: "Add variant" shows an Alert with no action; "Edit" shows "Edit {title}"; "Delete" confirms, then shows "Deleted" without deleting; Bulk "Status" shows an Alert only. | 507, 522, 534, 570, 577-579 | Route "Add variant"/"Edit" to `/add-product?editId=…&section=variants`. Wire delete to the API and show an Undo toast. Hide Status until it works. |
| P0 | Copy | Production tab stubs: "Request Quote" says "Send quote request to manufacturer.", "View Manufacturer" says "Navigate to manufacturer profile.", and "Tech Pack" says "Open tech pack viewer." These are dev notes shown as Alerts. | 913, 923, 934 | Route to `/manufacturer-hub`, the manufacturer profile and a document viewer, or hide them. |
| P0 | Copy | Store page tab: "Add to Cart" says "Item added to cart.", "Buy Now" says "Proceeding to checkout.", and "Seller" says "Navigate to seller profile." All are fake. | 1249, 1255, 1279 | In a seller preview, disable them with the caption "Buttons are live on your store", or route to `/product-store`. |
| P1 | Copy | Success shown by Alert: "Product archived", "Product published", "Variant prices updated", "Inventory updated" ×3, "Stock updated" | 181, 188, 444, 468, 480, 492, 657 | Toast: "Archived", "Published", "Prices updated", "Stock updated". |
| P1 | UX | "Adjust stock" offers only "Add 5 / Remove 5 / Set to 0", and its message says "Enter adjustment (+/- units)" but has no input. | 666-671 | Push `/inventory-adjust?productId=…`. |
| P1 | Consistency | Title Case labels: "Product Options", "Bulk Edit", "Inventory Summary", "Adjust Stock", "View Full Inventory", "Units Sold", "Page Views", "Refund Rate", "Open Full Preview", "Revenue — Last 14 Days" | 177, 512, 699, 712, 718, 1030-1038, 1043, 1286 | Sentence case: "Bulk edit", "Adjust stock", "Units sold", "Revenue, last 14 days". |

### Product editor (orphan): `app/product-editor.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Shopify-clone copy: "Online Store, Point of Sale, Shop, Faire: Sell Wholesale", "4 channels", "No catalogs", "Add images, videos, or 3D models" | 21, 199-208, 168 | Delete the screen (add-product replaces it), or remove these rows. |
| P0 | Copy | About 14 rows and buttons only fire a haptic: status, Media, "Add description", "Select category", Publishing "Edit", "Add options", Inventory "Edit", Shipping, Type, Vendor ("Brandthread" is hardcoded), Collections, Tags, SEO | 150-170, 181-183, 196, 216, 224, 265-270 | Delete the screen, or route to add-product. |
| P1 | Copy | Contradictory validation: "Enter a whole-dollar amount with up to two decimal places." | 98 | "Enter a price like 24.00". |
| P1 | Motion | `setSaving(true)` runs before the price check, and the early `return` never resets it, so a later save stays blocked. | 95-99 | Validate before `setSaving(true)`. |

### Import products: `app/product-import.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Hardcoded fake "Recent imports" (`IMPORT_HISTORY` "Demo Data": 12 products Today, one Failed) shown to every seller | 17-23, 316-339 | Load real history or remove the section. Empty: "No imports yet". |
| P0 | Consistency | Shopify is marked "Coming soon", "coming in the next update", but store-builder.tsx:379-540 has a working Shopify transfer. | 247, 255 | Replace it with a card that routes to the transfer: "Transfer from Shopify" / "Copy your public products in a few minutes." |
| P1 | Copy | "Download template" opens an Alert that dumps CSV text. "Upload CSV" opens a paste box. Both labels are wrong. | 216-226 | "Copy template" (copies to clipboard, Toast "Template copied") and "Paste CSV". Or add a real `DocumentPicker`. |
| P1 | Copy | Raw `e.message` shown: `Alert.alert('Error', e?.message …)`, which includes thrown strings like "CSV must include a name column." | 163 | Map to "Couldn't import. Check each row has a name, then try again." |
| P1 | Copy | "imported successfully", "Import Complete", "Import Products", "Paste CSV Data" | 120, 151, 374, 346 | "{n} products imported", "Import complete", "Import", "Paste CSV". |
| P1 | Consistency | Bespoke paste modal with inline styles, a static-looking 36px close button, 11–12pt helper text, and no keyboard avoidance for the Import button under the keyboard | 343-377 | Use the shared sheet plus `PrimaryButton`, and wrap in `KeyboardAvoidingView`. |

### Size chart: `app/product-size-chart.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | All styles are module-level `StyleSheet` built from static BG/CARD/BORDER/FG/PURPLE*, so theme presets are ignored. | 20-25, 348-388 | Move to `makeStyles(theme)`. |
| P1 | UX | Form with 3+ inputs and a grid of cell inputs has no `KeyboardAvoidingView`. Save is at the end of the scroll, not sticky. | 200-341 | Wrap in KAV. Pin "Save" in a footer with `insets.bottom`. |
| P1 | Visual | Table cell inputs are 11pt (`FS.xs`) in 80px cells with no visible input border | 386-387, 381 | 13pt minimum. Add a 1px border or fill on the cell. |
| P1 | Copy | "Saved" / "Size chart updated successfully."; "Error" / "Could not save size chart. Please try again." | 158, 162 | Toast "Size chart saved"; Alert "Couldn't save" / "Check your connection and try again." |
| P2 | Copy | Unit toggle shows raw lowercase "inches"/"cm". The CTA reads "Save Size Chart". | 216, 330 | "Inches" / "Centimetres"; "Save". |
| P2 | Motion | Bare `ActivityIndicator` on load | 188 | Skeleton rows. |

### Product store preview: `app/product-store.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Verified Brand" and a check icon are hardcoded for every seller | 347-349 | Show only when `seller.verified`, otherwise hide. |
| P1 | Copy | "Follow" is a stub Alert: "Follow this seller to get drop alerts." | 353 | Wire it to the follow API, or disable it in preview with the caption "Preview only". |
| P1 | Consistency | "Add to cart" appears twice, as an in-scroll CTA (489) and a sticky bar (578-592), with different styles | 486-499, 571-593 | Keep the sticky bar only. Put "Buy now" beside it. |
| P1 | Theme | Placeholder gradients are hardcoded navy/teal (`#0f3460`, `#0F766E`) | 30-34 | Use `theme.heroGradient`. |
| P2 | Motion | Loading state is plain "Loading…" text at the top-left | 236-240 | Product skeleton (hero plus lines). |
| P2 | Copy | "Product Preview", "% OFF" in caps | 285, 391 | "Preview", "{n}% off". |

### Bundles: `app/product-bundles.tsx` and `app/product-bundle-edit.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | Both screens use module-level static BG/CARD/BORDER/FG/PURPLE* styles | bundles 131-151; bundle-edit 29, 340+ | `makeStyles(theme)`. |
| P1 | UX | New bundle: products can't be added until you save. "Save the bundle first, then add products." | bundle-edit 105, 278 | Keep items locally and create them on first save. |
| P1 | UX | No `KeyboardAvoidingView`, and "Create Bundle" / "Save Changes" sits at the end of the scroll | bundle-edit 195-340 | KAV plus sticky footer. Labels "Create bundle" / "Save". |
| P1 | Perf | Catalog picker maps every product inline, with no search or virtualisation | bundle-edit 311-322 | Bottom sheet with `SearchBar` and `FlatList`. |
| P1 | Copy | "Name required" (no body), "Saved" / "Bundle updated successfully.", and "Error" ×3 | bundle-edit 136, 164, 123, 166, 180 | Inline "Give your bundle a name"; Toast "Bundle saved"; "Couldn't save the bundle. Try again." |
| P2 | Perf | The list is a `ScrollView` + `.map` | bundles 112-126 | `FlatList`. |

### Lifestyle images: `app/lifestyle-images.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | UX | The generated photo can't be saved, shared or attached to a product. The result screen offers only "Regenerate" and "Start over". | 276-287 | Add a primary "Save to photos" (MediaLibrary) and a secondary "Add to product". |
| P1 | Motion | The "loading" indicator is 3 static dots at opacity 0.6 with no animation, during a long AI job with no cancel | 259-263, 337 | Use the shared `BrandedLoader`, with copy "Styling your shot… this can take up to 30 seconds" and a "Cancel" text button. |
| P1 | Copy | Result title "Something went wrong"; Alerts "Generation failed" / "Something went wrong … Please try again." | 256, 102, 105 | "Couldn't create this shot" / "Try a different reference photo or tap Try again." |
| P2 | Consistency | Bespoke primary and secondary TouchableOpacity buttons instead of `PrimaryButton`/`SecondaryButton` | 190-248, 279-286 | Use the shared buttons. |
| P2 | Copy | Header "Lifestyle Images" in Title Case | 153 | "Lifestyle photos". |

### Inventory hub: `app/inventory.tsx`

Positives: products, alerts, transfers, incoming, counts and history all use `FlatList` with `keyExtractor`.

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Export shows raw CSV in an Alert titled "Export Ready" and says "…(full CSV copied)", but nothing is copied | 263-266 | `Share.share` or write the file and open the share sheet. Toast "Inventory exported". |
| P0 | Copy | Alert card button "Set Threshold" shows "Enter a new low-stock threshold for this item." with no input | 646-649 | Route to `/inventory-detail?id=…` (it has a threshold field) and label it "Set alert level". |
| P1 | Theme | The whole StyleSheet is module-level with static BG/CARD/BORDER/FG/PURPLE/CYAN, and the back button has inline static CARD/BORDER | 22, 955+, 281 | `makeStyles(theme)`, or use `BrandthreadHeader`. |
| P1 | Copy | Labels with typed glyphs and caps: "+ New Transfer", "+ Add Incoming", "+ New Count", "View Detail →", "DISCREPANCY", "Low Stock Alerts" | 676, 745, 810, 531, 707, 419 | "New transfer", "Add incoming", "New count", "Details", "Discrepancy", "Low stock". The icon already carries the plus. |
| P2 | Motion | Full-screen `ActivityIndicator` plus "Loading inventory…" with no header, then the content pops in | 925-930 | Header plus a skeleton list. |

### Adjust stock: `app/inventory-adjust.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | UX | "Confirm Adjustment" is at the end of a long scroll, not sticky, so it is easy to miss under the keyboard | 449-455 | Sticky footer above the home indicator. Label "Review". |
| P1 | Copy | "Error" / "Failed to adjust stock. Please try again." | 111 | "Couldn't update stock" / "Check your connection and try again." |
| P2 | Copy | Title Case: "Adjust Stock", "Select Item", "Adjustment Type", "Reason *", "Reference Number (optional)", "Stock Adjusted", "Adjust Another", "View Inventory →" | 169, 180, 263, 357, 385, 135, 151-152 | "Adjust stock", "Item", "Type", "Reason", "Reference (optional)", "Stock updated", "Adjust another", "Back to inventory". |

### Inventory counts: `app/inventory-count.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | UX | Per-item "Qty" inputs in a `FlatList` without `KeyboardAvoidingView`, so lower rows are covered by the keyboard | 442-520 | Wrap the screen in KAV and set `automaticallyAdjustKeyboardInsets` on the list. |
| P2 | Motion | Progress bar animates `width` with `useNativeDriver:false` | 89-91 | Animate `scaleX` with the native driver. |
| P2 | Copy | "Inventory Counts", "New Count", "Count Type", "Start Count", "Complete Count" | 254, 332, 337, 379, 575 | Sentence case. |

### Inventory item detail: `app/inventory-detail.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Tracking enabled" is always shown under a permanently disabled switch, even when tracking is off | 339-349 | Show "On"/"Off" as a value, or remove the row. |
| P1 | Copy | Status badge is the raw enum uppercased, e.g. "LOW STOCK", "OUT OF STOCK" | 212 | Map to "Low stock" / "Out of stock". |
| P1 | Copy | "Invalid" / "Enter a valid threshold (0 or more)." | 152 | Inline under the field: "Use 0 or more". |
| P2 | Perf | Adjustment history and events are unbounded `.map` | 405, 435 | Show the latest 10 plus "See all". |

### Incoming stock: `app/inventory-incoming.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Dev placeholders: "e.g. prod_001" (a raw ID) and "e.g. 2025-08-01" (a past date as free text) | 457, 419 | "Production order number (optional)"; use a date picker. |
| P1 | UX | 8-field "Add Incoming" and "Receive Inventory" forms have no `KeyboardAvoidingView`, and the CTA is not sticky | 356-480, 530-620 | KAV plus sticky "Add" / "Confirm receipt". |
| P2 | Copy | Title Case: "Incoming Inventory", "Add Incoming Record", "Mark In Production", "Mark Ready to Ship", "Status Timeline"; the id is shown as "Incoming #A1B2" | 273, 474, 732-735, 694, 657 | "Incoming stock", "Add shipment", "Mark in production", "Mark ready to ship", "Timeline". |

### Transfers: `app/inventory-transfer.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Mark Ready" is a stub. It shows "Transfer marked as ready to ship." but the status never changes. The code comment admits "We'll treat 'Mark Ready' as an Alert stub." | 200-208, 410 | Hide the button until the API exists, or call `updateTransferStatus('ready')`. |
| P0 | Copy | "Mark Resolved" on a discrepancy shows "Discrepancy marked as resolved." and resolves nothing | 503-505 | Wire it to the API, or hide it. |
| P1 | Copy | "Missing locations" / "Please select source and destination locations."; "Invalid"; "Error" / "Failed to create transfer." ×3 | 164, 168, 193, 217, 235 | Inline validation; "Couldn't create the transfer. Try again." |
| P1 | UX | "Expected Arrival" is free text ("e.g. Jul 21, 2026"), a different format from every other date field | 640-645 | Date picker. |
| P2 | Consistency | Three bespoke transparent `Modal` pickers | 710-820 | Shared sheet component. |

### Locations: `app/inventory-location.tsx` and `app/locations.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | The `locations.tsx` modal "Save" is `#fff` text on `colors.primary`. Every preset accent is light (#F7F7FA, #D990FF, #F0C36B…), so the label is invisible. The spinner is `#fff` too. | locations.tsx:238-241, 306 | `color: colors.primaryForeground`, or use `PrimaryButton small`. |
| P1 | Consistency | Two screens manage the same data: Settings goes to `/locations`, Inventory goes to `/inventory-location`, with different forms (7 fields versus 3) | settings.tsx:66, inventory.tsx:383 | Keep one (inventory-location) and redirect the other. |
| P1 | Copy | Raw error shown: `Alert.alert('Cannot delete', e?.message …)` | locations.tsx:113 | "Couldn't delete this location. Move its stock first, then try again." |
| P1 | UX | The `locations.tsx` 7-field pageSheet form has no KAV. Phone and ZIP fields have no `keyboardType`. | locations.tsx:250-262 | KAV; `keyboardType="phone-pad"` and `"number-pad"`. |
| P2 | Copy | Badges "★ PRIMARY", "● Fulfillment"; "+ Add Location"; "Fulfillment Enabled"; "Validation" / "Location name is required." | inventory-location.tsx:216, 220, 272, 351, 137 | "Primary", "Ships orders", "Add location", "Ships orders", inline "Add a name". |

### Metafields: `app/metafields.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Shopify-admin clone reachable from Settings (settings.tsx:72): "Metafields and metaobjects", "Companies", "Company locations", "Markets", "Blogs", "Draft orders". None of these exist in Brandthread. | 15-31, 55 | Remove the entry from Settings. If custom fields are needed, rename to "Custom fields" and list only Products and Collections. |
| P0 | Copy | All 15 rows and "Add definition" only fire a haptic. They are dead buttons. | 70-74, 106-110 | Remove them, or route to a real editor. |
| P1 | Copy | A load error is swallowed and shows all zeros | 45-47 | Inline "Couldn't load. Pull to refresh." |

### Discounts: `app/discounts.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake `DEMO` codes ("WELCOME20", 14 uses; "SAVE10", 23 uses) are shown whenever the API is missing or fails | 54-58, 84-88 | Remove DEMO. Error state: "Couldn't load your codes. Pull to refresh." |
| P0 | Copy | Create falls back to a local "optimistic" code when `api.discounts.create` is missing (it isn't in `lib/api.ts`). Sellers will share codes that don't exist at checkout. | 127-135 | Add the real API and remove the fake fallback. On failure: "Couldn't create the code. Try again." |
| P0 | Theme | The "New Code" FAB is `#fff` text and icon on `theme.accent` (light on every preset), so it is invisible | 218-225, 412-413 | `color: theme.onAccent`; label "New code". |
| P1 | Theme | Static BG/CARD_ELEVATED/BORDER/FG/MUTED are mixed into the themed styles | 395-420 | Use theme tokens. |
| P1 | Copy | Raw `e?.message` shown; "Invalid %" | 140, 113 | "Couldn't save the code. Try again."; inline "Max 100%". |
| P1 | UX | The expiry date is a free-text "YYYY-MM-DD" field and the modal has no KAV | 320, 228-330 | Date picker plus KAV. |
| P2 | Copy | "New Discount Code", "Inactive / Expired", "Create Code" | 231, 210, 327 | "New code", "Inactive", "Create code". |

### Rewards (buyer): `app/loyalty.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | A load failure is swallowed (`.catch(() => {})`) and shows "0 points" plus the "Earn your first points…" copy | 66 | Error state: "Couldn't load your points. Pull to refresh." |
| P1 | UX | The "Points to redeem" input is thrown away: the button just pushes to Cart, so the typed amount is lost | 70-82, 105-127 | Remove the input. Keep "Use points at checkout" plus the note. |
| P1 | Consistency | Emoji icons (🛍 👋 🎁) next to Feather icons | 126-128 | Feather `shopping-bag`, `users`, `gift`. |
| P1 | Copy | Unknown history source falls back to the raw enum (e.g. "admin_adjustment") | 180 | Fallback label "Adjustment". |
| P1 | Theme | Module-level static styles plus a hardcoded orange `rgba(249,115,22,0.1)` | 215+, 184 | Theme tokens. |
| P2 | Copy | Caps labels "YOUR BALANCE", "HOW TO EARN", "REDEEM POINTS"; "Minimum 100 Points" / "Insufficient Points"; "Use points in Cart" | 110, 124, 140, 73, 76, 166 | "Balance", "Earn points", "Redeem"; "You need 100 points to redeem"; "Use points at checkout". |

### Store builder hub: `app/store-builder.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Raw server error text is shown (only the "API 4xx:" prefix is stripped), plus `importJob.errorMessage` | 155, 169, 522 | Map to "Couldn't reach that store. Check the URL is a public Shopify store." |
| P1 | Theme | Shopify-green spinner `#95BF47`, and static BG/CARD/BORDER in styles | 513, 16 | `theme.accent`. |
| P1 | Motion | The transfer progress is a spinner plus a stage label with no progress count and no cancel | 511-516 | "Imported {n} of {total}" and a bar. Secondary "Run in background". |
| P2 | Copy | Arrows and caps: "Customize Thread Theme →", "Open Suggestions →", "SHOPIFY TRANSFER", "Manage Your Store", "Improve Store with AI" | 367, 466, 379, 389, 459 | "Customize theme", "See suggestions", "Shopify transfer", "Manage store", "Improve my store". |

### Store generation wizard: `app/store-generate.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | UX | The content-step "Upload" opens the picker, plays a success haptic, then discards the image | 644-650 | Keep the asset in `answers` and show a thumbnail. Upload it with a progress overlay. |
| P0 | Copy | AI tools call a relative `fetch('/api/ai/chat')`, which does not resolve on native. There is no loading state, and a result overwrites the text while the note says "AI suggestions will be shown below your text for review before applying." | 509-521, 529 | Use `useApi()`. Show a chip spinner and a diff card with "Use this" / "Keep mine". |
| P1 | Copy | "AI Tools", "Write with AI", "Improve Writing", "Make Bold"; "Error" / "AI processing failed. Please try again." | 500-502, 521 | "Writing help", "Draft for me", "Polish", "Bolder"; "Couldn't rewrite that. Try again." |
| P1 | Copy | "Generate Palette" only cycles presets | 367 | "Next palette". |
| P1 | Consistency | Brand-colour pickers conflict with store-editor.tsx:588, which says colours are "locked to keep every storefront unmistakably Thread Theme" | 287-376 | Decide once. If locked, drop this step. |
| P2 | Copy | "Generate My Store →", "Generate →", "Primary Style", "Current Colors", "Age Range (optional)", "Seller posts" | 791, 929, 182, 315, 569, 662 | "Build my store", "Build", "Primary style", "Your colors", "Age range (optional)", "posts". |
| P2 | UX | The bottom nav (Back / Continue) sits outside the KAV, so the keyboard covers it on text steps | 878-890 | Move it inside the KAV. |

### Generating screen: `app/store-generating.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | UX | If the draft answers are missing, the store is silently generated from `DEFAULT_ANSWERS` (teal `#0f766e`, navy, sky blue) | 29-51, 119-124 | Route back to `/store-generate` with Toast "Let's pick your style first". |
| P1 | Motion | Fake progress: 9 steps on fixed timers (5.6s total) unrelated to the real job. If the job is slow it sits at "9 of 9" with every step ticked. If it fails, steps keep ticking under the error. | 17-27, 140-148 | Stop the ticker on error. Loop the final step as "Finishing touches…" until the service resolves. Drop "Step x of 9". |
| P1 | UX | The back arrow "cancels", but the request keeps running and `applyGenerationResult` still overwrites the store after the user leaves | 169-177, 127-133 | Use an abort flag and skip apply once unmounted. Label it "Cancel". |
| P1 | A11y | "Try Again" is a `Text` with `onPress` inside a View (the comment says "TouchableOpacity would need import"), so the tap target is tiny | 242-252 | `PrimaryButton label="Try again"`. |
| P1 | Theme | Background gradient uses static `[BG, SURFACE]`, and the back button uses static CARD/BORDER | 164, 174 | `theme.heroGradient`, theme tokens. |
| P2 | Copy | "Connecting Seller content"; error "Generation failed. Please try again."; subhead "This takes just a moment." | 25, 135, 182 | "Connecting your posts"; "Couldn't build your store. Your answers are saved. Try again."; "About 30 seconds." |

### Store editor: `app/store-editor.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Edit Slides →" is a `TouchableOpacity` with no `onPress` | 411-413 | Wire it to a slides editor, or hide it. |
| P1 | UX | Colours are typed as hex ("#000000", "#0f766e") while the palette note says colours are locked | 363-369, 698-710, 586-589 | Swatch picker, or remove the colour fields. |
| P1 | Copy | ISO datetime placeholders "2025-01-01T00:00:00Z" and "2025-12-31T00:00:00Z" (dev format, past year); "© 2025 Your Brand" | 443, 722, 764 | Date-time picker; "© 2026 Your brand". |
| P1 | Copy | Autosave status "Saving..." / "Saved" / "Failed" | 315-317 | "Saving…" / "Saved" / "Not saved. Tap to retry". |
| P1 | UX | Long section and branding forms without KAV; inputs near the bottom are covered | 344, 951 | KAV plus `automaticallyAdjustKeyboardInsets`. |
| P1 | Copy | Raw paths as placeholders: "/collections/all", "/collections/sale" | 381, 475 | A link picker, or "Choose a page". |
| P2 | Consistency | About 60 Title Case labels ("Background Color", "Button Label", "Sticky Header", "Payment Icons", "Quick Add"…) | 363-854 | Sentence case throughout. |

### Store preview: `app/store-preview.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Dev jargon badge: "Live HTML Preview — tap 🌐 to return to native preview" | 598 | "Live site preview · tap the globe to go back". |
| P1 | Copy | Mock products are hardcoded: "Oversized Cargo Jacket $149.00", cart total "$298.00", "Your Cart" beside "Your bag is empty" | 353-354, 422-432, 417, 445 | Use the seller's real products. Pick "bag" everywhere: "Your bag". |
| P1 | Theme | Mock buttons use `#fff` text on the store `primaryColor`. Thread Theme is monochrome, so white on white is possible. | 358, 363, 435, 450 | Compute on-colour from luminance. |
| P1 | Theme | 20 hex literals (`#0f0f1a`, `#4ade80`, `#000`, `#f0f0f0`) | 145, 497, 525, 605-638, 915-945 | Theme tokens or `SUCCESS`. |
| P2 | Copy | "Store Preview", "Edit Store", "Edit →", "Add to Cart", "Continue Shopping" | 485, 519, 670, 363, 450 | Sentence case, no arrows. |

### Build from logo / mood board / social: `app/store-from-logo.tsx`, `app/store-from-moodboard.tsx`, `app/store-from-social.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Vendor and model names shown to users, and inconsistent: "Powered by GPT-4 — AI analyzes…" (logo, moodboard) versus "Powered by GPT-5" (social) | logo 286; moodboard 317; social 221 | Replace with "We'll pull your colors, type and vibe from your logo." (and equivalents). No model names. |
| P0 | Copy | Social "Posts" tab shows fake `FALLBACK_POSTS` ("New Drop — Summer Collection", "Behind the Scenes") when real posts don't load | social 30-34, 74 | Empty state: "No posts yet" / "Post on Brandthread, then come back." |
| P1 | Copy | Raw IDs shown as badges: `result.suggestedThemeId`, `suggestedTypography` | logo 404, 414; moodboard 438, 445 | Map to display names ("Thread Theme", "Editorial serif"). |
| P1 | Theme | Social's selected-post check is `#fff` on static `PURPLE` (#F7F7FA), so it is invisible | social 296, 417 | `theme.onAccent` on `theme.accent`. |
| P1 | Copy | Three-dot loaders "Preparing logo...", "Analyzing your logo with AI...", "Applying...", "Analyzing..." with a bare spinner and no cancel | logo 303, 332, 464; moodboard 355, 371, 497; social 277, 306, 338 | "Reading your logo…" with a cancel link. |
| P2 | Copy | "Generate from Mood Board", "Retry Analysis" and "Retry analysis" on the same screen, "Generate Full Store with AI", "Analyze & Generate" | moodboard 304, 393, 411; logo 472; social 342 | "Start from a mood board", "Try again", "Build my store". |

### AI suggestions: `app/store-ai-improve.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Preview" opens an Alert showing `sug.previewChange ?? ''`, which can be empty | 192 | Show inline in an expandable card, or hide when empty. |
| P1 | Copy | Raw category enum shown as the badge; "Problem:" / "Recommendation:" labels | 175, 178-180 | Map categories to labels. Use "Why" / "Try". |
| P2 | Copy | "Refreshing...", "Refresh Suggestions", "Applied Changes" | 144, 208 | "Refresh", "Applied". |

### Collections / navigation / pages: `app/store-collections.tsx`, `app/store-nav.tsx`, `app/store-pages.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | Collection "Upload Cover" sets `form.coverImage`, but the box always shows "No cover image", so the pick looks broken. There is no upload or progress either. | collections 385-403 | Render the picked image. Upload with a progress overlay. Relabel "Change cover". |
| P1 | Copy | Nav link fields ask for "Collection name or ID", "Product name or ID", "Page title or slug" | nav 433-462 | Pickers: "Choose a collection" / "Choose a product" / "Choose a page". |
| P1 | Copy | Real-looking third-party domain as a placeholder: "https://nightshiftstudio.co" | nav 474 | "https://yourbrand.com". |
| P1 | UX | Long create/edit forms (SEO, handle, conditions, status, date) have no KAV | collections 330-560; pages 300-435; nav 388-505 | KAV plus a sticky "Save". |
| P1 | Copy | "Error" / "Failed to …" ×7; "Please enter a …" | collections 173, 183, 209; nav 120, 163, 193; pages 149, 162, 168, 191 | "Couldn't save. Try again."; inline "Add a name". |
| P2 | Copy | "Schedule Date" free text "Jul 21, 2026"; "URL Handle"; "SEO Title" | pages 418-423; collections 505-529 | Date picker; "Web address"; "Search title". |

### Policies: `app/store-policies.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | If AI fails, a local template is filled in with the literal store name "Your Store" and badged "AI generated". Sellers may publish a legal policy that says "Your Store". | 110-115 | Pass the real store name. Badge "Template" rather than "AI generated". |
| P1 | UX | "Generate with AI" silently overwrites existing text | 88-115, 163 | Confirm "Replace your current policy?" when content is non-empty. |
| P1 | Copy | Relative `fetch('/api/ai/chat')` never resolves on native, so it always falls back | 93 | Use `useApi()`. |
| P1 | Copy | "Saved" / "Policy saved successfully."; "Error" / "Failed to save policy." | 141, 143 | Toast "Policy saved"; "Couldn't save. Try again." |

### Publish: `app/store-publish.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The success screen's "View Store" is a stub Alert: "Open https://… in browser." | 216 | `Linking.openURL(url)`, label "View store". |
| P1 | Copy | "Your store is live!", "Publishing...", "Publish Store →", "Validate Again", "Checking your store..." | 213, 231, 203, 134 | "Your store is live", "Publishing…", "Publish", "Check again", "Checking your store…". |
| P1 | Copy | `Alert.alert('Cannot publish', result.message)` shows a raw server message | 84 | "Fix the items above to go live." |
| P1 | Theme | Module-level static styles | 16, 250+ | `makeStyles(theme)`. |

### Add section / SEO / settings / domain / versions / theme picker

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | SEO "Upload Social Image" is a `TouchableOpacity` with no `onPress` | store-seo.tsx:112-115 | Wire up the image picker with upload progress, or hide it. |
| P1 | Copy | Dev template syntax in placeholders: "Use {{product}} and {{store}}", "{{collection}} – {{store}}", plus "Sitemap Enabled" | store-seo.tsx:175, 187, 206, 217, 135 | Token chips ("Product name", "Store name"); "Include in search sitemap". |
| P1 | Consistency | SEO and Settings both have a header "Save" and a bottom "Save SEO"/"Save Settings" | store-seo.tsx:69, 226; store-settings.tsx:112, 285 | Keep one sticky "Save". |
| P1 | Copy | ALL-CAPS section headers: "HOMEPAGE SEO", "GOOGLE PREVIEW", "STORE IDENTITY", "LOCALIZATION", "CHECKOUT & ACCOUNTS", "BRANDTHREAD SUBDOMAIN", "CUSTOM DOMAIN" | store-seo 75-198; store-settings 123-254; store-domain 165, 191 | Sentence case: "Homepage", "Search preview", "Store", "Region", "Checkout", "Brandthread address", "Custom domain". |
| P1 | UX | "Time Zone" is free text "America/New_York" | store-settings.tsx:198-204 | Picker, with the device default preselected. |
| P1 | UX | Settings and SEO forms (8+ inputs) have no KAV | store-settings.tsx, store-seo.tsx | Wrap in KAV. |
| P1 | Copy | "Section added." (with a period), shown as an Alert, then back | store-sections.tsx:88 | Toast "Section added". |
| P1 | UX | DNS values (TXT token, CNAME) can't be tapped to copy | store-domain.tsx:209-222 | Copy icon on each row plus Toast "Copied". |
| P2 | Copy | "Verified ✓" / "SSL is being issued."; "Domain Added"; "Remove Domain?" | store-domain.tsx:120, 105, 129 | "Domain verified" / "Your secure certificate is on the way."; "Domain added"; "Remove domain?" |
| P2 | Copy | Theme badges "CURRENT", "PREVIEWING" (white on SUCCESS); "Customize First" | store-theme-picker.tsx:119, 124, 379, 269 | "Current", "Previewing", "Customize first". |
| P2 | Copy | "Version History", "Save Version", "Version saved successfully." | store-versions.tsx:99, 102, 64 | "Versions", "Save version", Toast "Version saved". |

### Share store: `app/share-store.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The QR code is white on white (`backgroundColor="#FFFFFF" color="#FFFFFF"`), so it is invisible and can't be scanned. The screen is reachable from the seller home ("Share Your Store"). | 102-107 | `color="#0A0A0B"`. |
| P0 | Theme | "Copy Link" is `#FFFFFF` text and icon on `colors.primary` (light on every preset), so it is invisible | 116-121, 159 | `color: colors.primaryForeground`. |
| P1 | Copy | "Link Copied!", "Copy Link", "Share Store", "Share via…" | 121, 76 | "Copied", "Copy link", "Share store", "Share". |
| P2 | Theme | Copied state is hardcoded `#22C55E` | 116 | `theme.success`. |

### Website (orphan): `app/website.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Entirely mock: fake page views ("8,240"), "SEO Score 82/100", "brandthread.app · Connected · SSL Active", and teal/navy layouts | 10-17, 190-198, 228-229, 29-60 | Delete the screen (store-builder replaces it). |
| P0 | Copy | Dead buttons: "Edit "{name}" Layout", every page row, "Add New Page" | 183-186, 204, 216-219 | Delete with the screen. |

### Mobile app builder (orphan): `app/mobile-app-builder.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Start building" has no `onPress`. It promises "a fully branded iOS & Android app — no code required." | 36-42 | Delete, or add a waitlist: "Join the waitlist". |
| P2 | Theme | CTA text is hardcoded `#03150B`, and `isDark` is sniffed from hex prefixes | 72, 17 | Theme tokens. |

### Brand kit (orphan): `app/brand.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "AI Brand Name Generator" is a random word mash (`generateBrandNames`), not AI | 25-35, 137 | "Name ideas". |
| P1 | Copy | Hardcoded "Brandthread · Minimalist · Est. 2025", domain "brandthread.app · Available", and a default name input of "Brandthread" | 40, 125-126, 292-294 | Use the seller's brand, or delete the screen. |
| P2 | Copy | "Generation failed" / "Please try again." | 84 | "Couldn't make logos. Try again." |

---

## Clean / low-risk
- `app/store-sections.tsx`: aside from the Alert-as-toast (listed above), it is simple and themed.
- `app/store-versions.tsx`: sound structure with a good empty state. Only copy casing issues.
- `app/store-theme-picker.tsx`: themed and virtualised. Only badge casing.
- `app/inventory.tsx` lists: all 6 tabs use `FlatList` with `keyExtractor`. This virtualisation is the good pattern to copy.
- `app/add-product.tsx` footer: the sticky footer inside the KAV with `insets.bottom` is the pattern the other long forms should copy.

## Cross-cutting patterns in my slice
- **Invisible text or icons on accent (P0 ×5):** `#fff` on `theme.accent`/`colors.primary`/static `PURPLE`, while every one of the 12 presets has a light accent (#F7F7FA, #D990FF, #F0C36B…). Hits: discounts FAB, locations Save, share-store Copy Link, the share-store QR code (white on white), and the store-from-social check. Rule: text on accent always uses `onAccent`/`primaryForeground`.
- **Dead or stub actions:** about 40 across the slice. 17 are Alert stubs that pretend to succeed (product-detail ×14, inventory-transfer ×2, store-publish "View Store"). About 25 are buttons with no `onPress` or haptic only (product-editor ×14, metafields ×16, store-seo, store-editor "Edit Slides", website ×8, mobile-app-builder). The fakes that say "done" are the worst ("Deleted", "Share link copied", "…full CSV copied", "Item added to cart.").
- **Fake or demo data shown to real users:** 6 sources. `DEMO` discounts, `IMPORT_HISTORY`, `FALLBACK_POSTS`, `DEFAULT_ANSWERS` store generation, and in orphan screens `website.tsx` stats and the brand.tsx "Est. 2025".
- **Images picked but never uploaded, and no upload progress anywhere:** add-product, store-generate (discarded), store-collections (not even displayed), store-seo (dead). None of the 5 image pickers in the slice shows upload progress.
- **Long forms without keyboard avoidance:** only 6 of 45 files use `KeyboardAvoidingView` (add-product, lifestyle-images, inventory-adjust, inventory-transfer, store-builder, store-generate). At least 14 multi-input forms lack it (size chart, bundle edit, incoming, count, locations, discounts, product-import modal, collections, pages, nav, SEO, settings, policies, editor). Only add-product, inventory-count and product-store have a sticky CTA with `insets.bottom`.
- **Dates as free text in 5 formats:** "YYYY-MM-DD" (add-product ×7, discounts), "e.g. 2025-08-01" (incoming), "e.g. Jul 21, 2026" (transfer, pages), ISO "2025-01-01T00:00:00Z" (store-editor ×2), "YYYY-MM-DD HH:MM". No date picker is used anywhere in the slice.
- **Static theme tokens:** 34 of 45 files import static colour tokens (BG/CARD/BORDER/FG/MUTED/PURPLE) from `lib/theme`. Nine files keep fully module-level static StyleSheets (inventory, loyalty, size-chart, bundles ×2, store-policies/publish/seo/settings). Even the "themed" store-* `makeStyles` override only the PURPLE* tokens and keep static CARD/BORDER/FG.
- **Copy hygiene:** 31 `Alert.alert('Error', …)` titles, 21 "Failed to…", 26 "Please…" bodies, 6 "successfully", 30 three-dot "..." loaders in 14 files, 13 "→" arrows in labels, 10 ALL-CAPS section headers, and pervasive Title Case labels. Raw error text reaches users in 6 places (product-import, locations, discounts, store-builder ×3). Vendor names appear 3 times ("GPT-4" ×2, "GPT-5").
- **Alerts used as success toasts:** at least 25 (product-detail ×9, add-product ×4, bundles, size chart, policies, domain, SEO, settings, versions, sections…). The codebase already has `Toast`/`UndoToastProvider`.
- **Press feedback and consistency:** 602 `TouchableOpacity` uses against 29 `PressableScale` (all in product-detail). Many screens have bespoke headers, and there are 7+ bespoke `Modal` sheets (import, discounts, locations, transfer ×3, nav).
