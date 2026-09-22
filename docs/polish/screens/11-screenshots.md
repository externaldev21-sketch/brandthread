# Visual pass: web screenshots (iPhone & iPad)

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**10 P0 · 18 P1 · 20 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Captured from the **dev** web build (`expo start --web`), using the dev preview bypass (`?bt_preview=seller|buyer`), `bt_capture=1` to hide the cookie banner, and `bt_theme=purple|maroon` for the theme checks.
Screenshots: `/home/user/brandthread/docs/polish/screenshots/` (104 JPEGs, about 5.0 MB, q68).

**Caveat on data:** no backend was reachable. `EXPO_PUBLIC_API_BASE_URL` was unset, so the API base resolved to `https://undefined`, and the Clerk key was a dummy. Screens that depend on the API show loading or skeleton states. Those states are still findings, because none of them time out into an error or empty state. Feed videos don't play because headless Chromium lacks H.264. That is an environment limitation.

---

## Cross-cutting issues (fix once, many screens)

| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | Global seller floating tab bar renders over full-screen or modal flows. It covers the Create Post camera controls (Camera/Story mode row hidden, shutter clipped on iPad), the Add Product form, the Plans modal (has an X close), Settings (has an X close) and Billing. | [iphone-seller-create-post.jpg](../screenshots/iphone-seller-create-post.jpg), [ipad-seller-create-post.jpg](../screenshots/ipad-seller-create-post.jpg), [iphone-seller-add-product.jpg](../screenshots/iphone-seller-add-product.jpg), [iphone-seller-plans.jpg](../screenshots/iphone-seller-plans.jpg), [iphone-seller-settings.jpg](../screenshots/iphone-seller-settings.jpg) | Add `create-post`, `add-product`, `plans`, `settings`, `billing`, camera, editor and modal routes to the exclusion list that decides when the seller bar shows (`_layout.tsx`, the `showBar` logic around lines 120-175). Use an allow-list of "shell" routes instead of a deny-list. |
| P0 | Hardcoded mock business data ships in production code. Customers shows "1,240 Total / 84 VIP / $480 CLV / 42% Retention", "840 customers enrolled · $3.2k rewards", "18,400 pts" etc. directly above "No customers found." Marketing shows "8.1k Push Subs", a campaign named "Summer Drop 2025" (stale year) with "$2,840", "SUMMER20 142 uses". None of it is gated by `isSellerDevPreview`. | [iphone-seller-customers.jpg](../screenshots/iphone-seller-customers.jpg), [iphone-seller-marketing.jpg](../screenshots/iphone-seller-marketing.jpg) | Remove the literals (`app/customers.tsx:101-210`, `app/(tabs)/marketing.tsx:14,114`). Drive them from the API, show "—" or empty states, or gate them behind `isSellerDevPreview()`. |
| P0 | Route-name collisions between `(buyer)` and `(tabs)` groups. The web URLs `/profile`, `/feed`, `/following` and `/orders` resolve to one group only. A seller on `/feed` gets the buyer shell (Home/Discover/Inbox tab bar). A buyer on `/orders` hits root `app/orders.tsx`, which redirects to the seller `(tabs)/orders` screen ("When a customer places an order, you can manage payment…") with no tab bar. Deep links and refreshes land in the wrong app. | [iphone-buyer-orders.jpg](../screenshots/iphone-buyer-orders.jpg), [ipad-buyer-orders.jpg](../screenshots/ipad-buyer-orders.jpg) (seller /feed gives the same image as [iphone-buyer-feed.jpg](../screenshots/iphone-buyer-feed.jpg)) | Rename the colliding files (e.g. `(buyer)/buyer-orders`, `(tabs)/seller-feed`), or make `app/orders.tsx` role-aware. Add a test that each role-specific URL renders the right shell. |
| P1 | Inconsistent top offset. About 33 screens use `Platform.OS === 'web' ? 67 : insets.top` (or `ScreenHeader`'s `SP.xxl+SP.md+SP.xs`) and get a 60-120 pt dead band above the title. Dashboard, Products, Orders, Studio and Settings don't. | [iphone-seller-analytics.jpg](../screenshots/iphone-seller-analytics.jpg), [iphone-seller-marketing.jpg](../screenshots/iphone-seller-marketing.jpg), [iphone-seller-boost.jpg](../screenshots/iphone-seller-boost.jpg), [iphone-seller-design.jpg](../screenshots/iphone-seller-design.jpg), [iphone-seller-customers.jpg](../screenshots/iphone-seller-customers.jpg), [iphone-seller-billing.jpg](../screenshots/iphone-seller-billing.jpg), [iphone-seller-finance.jpg](../screenshots/iphone-seller-finance.jpg), [iphone-buyer-discover.jpg](../screenshots/iphone-buyer-discover.jpg) | Replace the magic 67 with `insets.top` (plus a shared header spacing token) everywhere. `grep -rln "web' ? 67" app components` lists the offenders. |
| P1 | Inconsistent header patterns across screens. Six variants appear: large-title + X (Settings), boxed back button + title/subtitle (App theme, Billing, Customers, Finance), centered title + back + X (Promote), centered title + circular X (Plans), plain arrow + centered title (Messages, Inbox), and plain arrow above a large title (Design Studio). | [iphone-seller-settings.jpg](../screenshots/iphone-seller-settings.jpg), [iphone-seller-app-theme.jpg](../screenshots/iphone-seller-app-theme.jpg), [iphone-seller-boost.jpg](../screenshots/iphone-seller-boost.jpg), [iphone-seller-plans.jpg](../screenshots/iphone-seller-plans.jpg), [iphone-seller-seller-inbox.jpg](../screenshots/iphone-seller-seller-inbox.jpg), [iphone-seller-design.jpg](../screenshots/iphone-seller-design.jpg) | Standardise on `ScreenHeader` (push screens use back, modals use X, never both). Boost shows back *and* X together. |
| P1 | Tab-bar active state is wrong on hidden seller tabs. Analytics, Marketing, More, Studio, Customers, Boost etc. all highlight "Dashboard". The seller label "Dashboard" is also truncated to "Dashbo…" on iPhone. | [iphone-seller-analytics.jpg](../screenshots/iphone-seller-analytics.jpg), [iphone-seller-home.jpg](../screenshots/iphone-seller-home.jpg) | Highlight nothing, or the parent section, for `href:null` tabs. Shorten the label to "Home", or allow two-line or smaller labels. |
| P1 | Infinite loaders with no timeout or error state when the API fails: Store Builder (full-screen spinner), Design Studio, Inventory, Billing, Finance, Seller Messages, Cart ("Gathering your picks…"), Notifications, Saved ("Loading saved items…"), Buyer Checkout (permanent skeleton), and Discover and Feed skeletons. Manufacturer Hub shows a blank body with no loader or empty state. | [iphone-seller-store-builder.jpg](../screenshots/iphone-seller-store-builder.jpg), [iphone-seller-billing.jpg](../screenshots/iphone-seller-billing.jpg), [iphone-buyer-cart.jpg](../screenshots/iphone-buyer-cart.jpg), [iphone-buyer-buyer-checkout.jpg](../screenshots/iphone-buyer-buyer-checkout.jpg), [iphone-seller-manufacturer-hub.jpg](../screenshots/iphone-seller-manufacturer-hub.jpg) | Use a shared query-state component: loading, then after about 10 s or on error show an error card with Retry. Treat an empty response as an explicit empty state. |
| P1 | Content scrolls visibly under the floating tab bar with no scrim, and text shows between and under the pills ("Background Removal", "Drops / All drops", the feed caption). | [iphone-seller-more.jpg](../screenshots/iphone-seller-more.jpg), [iphone-buyer-discover.jpg](../screenshots/iphone-buyer-discover.jpg), [iphone-buyer-home.jpg](../screenshots/iphone-buyer-home.jpg) | Add a bottom gradient scrim behind the bar, and make scroll `paddingBottom` equal to the bar height plus the inset. |
| P1 | "All" filter chip, selected state, is dark text on a mid-grey fill and nearly unreadable. Customers uses a different selected style (white fill, black text). | [iphone-seller-products.jpg](../screenshots/iphone-seller-products.jpg), [iphone-seller-orders.jpg](../screenshots/iphone-seller-orders.jpg), [iphone-seller-manufacturer-hub.jpg](../screenshots/iphone-seller-manufacturer-hub.jpg) vs [iphone-seller-customers.jpg](../screenshots/iphone-seller-customers.jpg) | Use one `FilterChip` selected style with AA contrast. |
| P2 | Console noise on every route: `"shadow*" style props are deprecated`, `"textShadow*" … deprecated`, `props.pointerEvents is deprecated`, and `[expo-notifications] Listening to push token changes is not yet fully supported on web`. On 48 of 106 loads: `Animated: useNativeDriver is not supported…`. On feed/home: `TouchableWithoutFeedback is deprecated`. No React key or act() warnings were seen. | (console) | Use `Platform.select` for the `useNativeDriver: Platform.OS !== 'web'` flag, move to `boxShadow` / `style.pointerEvents`, swap in `Pressable`, and guard the push-token listener with `Platform.OS !== 'web'`. |
| P2 | Unhandled `pageerror: Failed to load because no supported source was found` on buyer home. `video.play()` rejects and nothing catches it. | [iphone-buyer-home.jpg](../screenshots/iphone-buyer-home.jpg) | `.catch()` the play promise and fall back to the poster image. |

## iPad-specific (stretched phone layout)

| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | Dashboard time-range pills (Live/Today/Yesterday/This week) stretch to about 390 px tall. The horizontal `ScrollView` grows vertically on wide web. Also visible on the maroon theme. | [ipad-seller-home.jpg](../screenshots/ipad-seller-home.jpg), [ipad-seller-home-maroon.jpg](../screenshots/ipad-seller-home-maroon.jpg) | `components/SellerHomeCommerceDashboard.tsx` about line 453: add `style={{ flexGrow: 0 }}` to the range `ScrollView`, and/or `alignItems:'center'` in `rangeRow`. |
| P1 | Every form and list is stretched edge to edge at 1024 px: sign-in inputs and buttons about 975 px wide, onboarding cards, Settings rows, Analytics, Customers and Plans cards stacked vertically. Large empty lower halves (Products, Analytics, Onboarding, Sign-in, Profile). | [ipad-seller-sign-in.jpg](../screenshots/ipad-seller-sign-in.jpg), [ipad-seller-onboarding.jpg](../screenshots/ipad-seller-onboarding.jpg), [ipad-seller-plans.jpg](../screenshots/ipad-seller-plans.jpg), [ipad-seller-products.jpg](../screenshots/ipad-seller-products.jpg), [ipad-seller-analytics.jpg](../screenshots/ipad-seller-analytics.jpg) | Wrap screens in a `maxWidth: 720` centered container. Use two or three columns for Plans, stats, and the onboarding choice cards. Studio already adapts to three columns and is a good model. |
| P2 | Tab bars differ between roles on iPad. The seller bar spans the full width; the buyer bar is a compact centered pill. | [ipad-seller-products.jpg](../screenshots/ipad-seller-products.jpg) vs [ipad-buyer-profile.jpg](../screenshots/ipad-buyer-profile.jpg) | Pick one: centered and max-width for both. |
| P2 | The buyer feed action rail sits against the far right edge, with the "392" share count touching the bottom edge. | [ipad-buyer-home.jpg](../screenshots/ipad-buyer-home.jpg) | Constrain the feed to a centered 9:16 column on tablets. |

## Per-screen findings

### Seller — Dashboard (`/`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | Orders and Visitors stat cards and the Sales-activity chart well keep a neutral grey-brown surface on purple and maroon. Only "Total sales" picks up the theme, so the cards read as dark patches. | [iphone-seller-home-purple.jpg](../screenshots/iphone-seller-home-purple.jpg), [ipad-seller-home-maroon.jpg](../screenshots/ipad-seller-home-maroon.jpg) | Replace the hardcoded `SELLER_DASHBOARD_GLASS` or neutral card colours with `palette.surface` / `theme.surface`. |
| P2 | Disabled "Withdraw" is a light-grey slab with dark text. It looks like a primary button that failed to render. | [iphone-seller-home.jpg](../screenshots/iphone-seller-home.jpg) | Use the standard disabled style (outline, muted text) and add helper text such as "No balance yet". |
| P2 | Stat cards are nested inside a card (card-in-card with double borders). | [iphone-seller-home.jpg](../screenshots/iphone-seller-home.jpg) | Flatten to a single card with dividers, or use a 3-up grid. |

### Seller — Products / Orders (`/products`, Orders tab)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | On maroon, "Create product" is dark text on a red-to-pink gradient, and the "All" chip is dark-red on red. Contrast is poor. | [iphone-seller-products-maroon.jpg](../screenshots/iphone-seller-products-maroon.jpg) | Use `theme.onAccent` for text on accent fills. |
| P2 | The "0 products" pill butts against the header divider with no gap. Orders uses plain "0 orders" text instead (inconsistent). | [iphone-seller-products.jpg](../screenshots/iphone-seller-products.jpg), [iphone-seller-orders.jpg](../screenshots/iphone-seller-orders.jpg) | Use the same count-row component with top margin. |

### Seller — Profile (Profile tab)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P2 | Stats mix "—" (Following, Followers) with "0" (Likes). | [iphone-seller-profile.jpg](../screenshots/iphone-seller-profile.jpg) | Use one placeholder convention ("0" once loaded). |

### Seller — More (`/more`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | The "Edit profile" button has no horizontal padding, so its text touches the border. | [iphone-seller-more.jpg](../screenshots/iphone-seller-more.jpg), [ipad-seller-more.jpg](../screenshots/ipad-seller-more.jpg) | Fix `SecondaryButton small` padding (`app/(tabs)/more.tsx:207`, `editProfileBtn`). |
| P2 | No page title. The screen opens straight into the profile card. The "PRO" badge is hardcoded in the purple variant. | [iphone-seller-more.jpg](../screenshots/iphone-seller-more.jpg) | Add a "More" or "Menu" header, and show the real plan badge. |

### Seller — Analytics, Marketing, Customers, Finance, Billing
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | Mock data (see cross-cutting). | [iphone-seller-customers.jpg](../screenshots/iphone-seller-customers.jpg), [iphone-seller-marketing.jpg](../screenshots/iphone-seller-marketing.jpg) | as above |
| P2 | On Customers, "840 customers enrolled · $3.2k rewards" runs into the "Manage" button. | [iphone-seller-customers.jpg](../screenshots/iphone-seller-customers.jpg) | Add `flex:1` and `marginRight` to the text column, with `numberOfLines`. |

### Seller — Manufacturer Hub (`/manufacturer-hub`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | The title wraps to two lines ("Manufacturer / Hub") because of three header icons. The body is completely blank, with no loader and no empty state. | [iphone-seller-manufacturer-hub.jpg](../screenshots/iphone-seller-manufacturer-hub.jpg) | Shorten the title to "Manufacturers" or move actions into an overflow menu. Add an empty or error state. |

### Seller — Plans (`/plans`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | The "Switch to Starter" button label is almost invisible: dark text on a dark card. | [iphone-seller-plans.jpg](../screenshots/iphone-seller-plans.jpg), [ipad-seller-plans.jpg](../screenshots/ipad-seller-plans.jpg) | Use an outline style with `colors.text`, or show a "Current plan" label if that's the intent. |

### Seller — Promote (`/boost`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P2 | The header has both back and X. The captions truncate ("Preview — Slideshow (2 …"); preview data is dev-only. | [iphone-seller-boost.jpg](../screenshots/iphone-seller-boost.jpg) | Keep one dismiss affordance, and allow two-line captions. |

### Seller — Inventory, Seller Inbox, Design Studio, Store Builder
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | Infinite spinners (see cross-cutting). Design Studio's spinner sits below centre, and its header layout (plain arrow on its own row above a large title) is unique to this screen. | [iphone-seller-design.jpg](../screenshots/iphone-seller-design.jpg), [iphone-seller-store-builder.jpg](../screenshots/iphone-seller-store-builder.jpg), [iphone-seller-inventory.jpg](../screenshots/iphone-seller-inventory.jpg), [iphone-seller-seller-inbox.jpg](../screenshots/iphone-seller-seller-inbox.jpg) | Use shared header and loading components. |

### Onboarding (`/onboarding`) and Sign-in (`/sign-in`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | The step-progress dots are jammed against the top edge (y is about 10 pt), with no safe-area or top padding. The first "dot" is a partly drawn bar. | [iphone-seller-onboarding.jpg](../screenshots/iphone-seller-onboarding.jpg), [ipad-seller-onboarding.jpg](../screenshots/ipad-seller-onboarding.jpg) | Add top padding based on `insets.top`, and give the progress indicator a fixed height. |
| P2 | Sign-in: the password placeholder is "••••••••", which looks like a pre-filled password. "Forgot password?" sits lower than the "Password" label. | [iphone-seller-sign-in.jpg](../screenshots/iphone-seller-sign-in.jpg) | Use a placeholder such as "Enter password", and align label-row baselines. |

### Legal (`/privacy`, `/terms`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | A visible "Legal review required before launch — This is a functionality-based first draft, not legal advice…" banner appears on both pages. | [iphone-seller-privacy.jpg](../screenshots/iphone-seller-privacy.jpg), [iphone-seller-terms.jpg](../screenshots/iphone-seller-terms.jpg) | Must be resolved (legal sign-off) and the banner removed before release. |
| P2 | There's no back or close control when opened in-app, and a large top gap. | [iphone-seller-privacy.jpg](../screenshots/iphone-seller-privacy.jpg) | Add a back button when `router.canGoBack()`. |

### Buyer — Home feed (`/`) and `/feed`
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | On `/feed` the "High Demand" section header renders *behind* the floating Home/Following/For You header. The two overlap and the header sits on top of the skeleton cards. | [iphone-buyer-feed.jpg](../screenshots/iphone-buyer-feed.jpg), [ipad-buyer-feed.jpg](../screenshots/ipad-buyer-feed.jpg) | Give the feed content a `paddingTop` equal to the header height, or don't render the Discover "High Demand" block inside the feed route. |
| P0 | On iPhone the right action rail's last item (share, "392") collides with the profile tab button, and the caption "…cut for movement." and the music line run under the tab bar. | [iphone-buyer-home.jpg](../screenshots/iphone-buyer-home.jpg) | Offset the rail and caption by tab-bar height plus inset. |
| P1 | An empty dark rectangle sits above the header (y is about 15-70 pt). It looks like an unfilled placeholder or status-bar block. On iPad it becomes a strip across the full width. | [iphone-buyer-home.jpg](../screenshots/iphone-buyer-home.jpg), [ipad-buyer-home.jpg](../screenshots/ipad-buyer-home.jpg) | Remove it, or make it the real status-bar spacer with the correct background. |
| P2 | The header, tab bar and feed stay pure black on purple and maroon. That may be intentional for video, but the tab-bar pill should follow the theme as it does on other screens. | [iphone-buyer-home-maroon.jpg](../screenshots/iphone-buyer-home-maroon.jpg) | Theme the tab-bar pill only. |

### Buyer — Discover (`/discover`) and Search (`/search`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | The search placeholder in the bottom bar is clipped ("Search Brandthreac"). | [iphone-buyer-search.jpg](../screenshots/iphone-buyer-search.jpg) | Shorten it to "Search", or let the field flex wider. |
| P2 | The Search body is almost empty (a single "Browse trending brands and drops" row). | [iphone-buyer-search.jpg](../screenshots/iphone-buyer-search.jpg), [ipad-buyer-search.jpg](../screenshots/ipad-buyer-search.jpg) | Add recent or trending searches and categories. |
| P2 | Skeletons never resolve, and the section header "Drops / All drops" shows through the tab bar. | [iphone-buyer-discover.jpg](../screenshots/iphone-buyer-discover.jpg) | See the cross-cutting rows. |

### Buyer — Friends (`/friends`), Inbox (`/inbox`), Profile (`/profile`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P2 | The "Your Story" avatar is hardcoded purple in the Monochrome theme. | [iphone-buyer-friends.jpg](../screenshots/iphone-buyer-friends.jpg) | Use `theme.accent` or a neutral avatar colour. |
| P2 | Inbox is a tab root but shows a back arrow. | [iphone-buyer-inbox.jpg](../screenshots/iphone-buyer-inbox.jpg) | Hide back on tab roots. |

### Buyer — Notifications (`/buyer-notifications`)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P0 | The category filter pills are clipped vertically. Only the top half of "All / Social / Orders / Messages" is visible, on both iPhone and iPad. | [iphone-buyer-buyer-notifications.jpg](../screenshots/iphone-buyer-buyer-notifications.jpg), [ipad-buyer-buyer-notifications.jpg](../screenshots/ipad-buyer-buyer-notifications.jpg) | `app/buyer-notifications.tsx` `pillsScroll`: add `flexShrink: 0` (and/or a `minHeight`). The flex:1 loading body is shrinking the ScrollView. |

### Buyer — Saved (`/buyer-saved`), Settings (`/buyer-settings`), Checkout, Cart
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P1 | The Saved header is flush to the top (about 12 pt), unlike other screens, and "Loading saved items…" renders in a fallback font (not Inter). | [iphone-buyer-buyer-saved.jpg](../screenshots/iphone-buyer-buyer-saved.jpg) | Use `ScreenHeader`, and set `fontFamily` on the loading text. |
| P1 | `/buyer-settings` redirects to the shared `/settings`. The buyer sees "General settings — Manage your brand setup…", which is seller copy. | [iphone-buyer-buyer-settings.jpg](../screenshots/iphone-buyer-buyer-settings.jpg) | Use role-specific subtitle copy. |
| P1 | Checkout with an empty cart is a permanent skeleton, with no "Your cart is empty" state. | [iphone-buyer-buyer-checkout.jpg](../screenshots/iphone-buyer-buyer-checkout.jpg) | Add an empty-cart redirect or state. |
| P2 | Seller Settings shows the tab bar and buyer Settings doesn't. Both use an X close on a pushed screen. | [iphone-seller-settings.jpg](../screenshots/iphone-seller-settings.jpg), [iphone-buyer-buyer-settings.jpg](../screenshots/iphone-buyer-buyer-settings.jpg) | Make them consistent (no bar, back arrow). |

### Cookie banner (first run)
| Pri | Issue | Screenshot file | Fix |
|---|---|---|---|
| P2 | "Customize" and "Necessary only" are faint grey links next to a bold "Accept all" (dark pattern and low contrast). The banner has about 40 pt of dead space under the buttons and covers the feed action rail. | [iphone-buyer-home-cookie-banner.jpg](../screenshots/iphone-buyer-home-cookie-banner.jpg), [ipad-buyer-home-cookie-banner.jpg](../screenshots/ipad-buyer-home-cookie-banner.jpg) | Give the three actions equal weight (e.g. two buttons plus a link at AA contrast), remove the bottom padding, and cap the width on iPad. |

---

## Theme coverage summary (`bt_theme=purple` / `maroon`)
- **Good:** Settings (seller and buyer), Discover, Products background, tab bar tint, and chips all follow the theme.
- **Gaps:** Dashboard stat cards, the Sales-activity well and the "Needs attention" card stay neutral or near-black (purple and maroon). The buyer Home feed chrome is always black. On maroon, text on accent fills ("Create product", the selected "All" chip) is low-contrast. The Friends story avatar is hardcoded purple.
- Files: `{iphone,ipad}-{seller-home,seller-products,seller-settings,buyer-home,buyer-discover,buyer-buyer-settings}-{purple,maroon}.jpg`

## Screenshots captured (104 files, 52 per device)
- Seller (both devices): home, products, orders, profile, analytics, more, studio, marketing, add-product, inventory, store-builder, design, boost, create-post, settings, app-theme, plans, billing, manufacturer-hub, seller-inbox, customers, finance, onboarding, sign-in, privacy, terms.
- Buyer (both devices): home, discover, search, friends, inbox, cart, profile, feed, orders, buyer-settings, buyer-checkout, buyer-notifications, buyer-saved, home-cookie-banner.
- Themed (both devices): the 6 screens above x purple and maroon.
- `{iphone,ipad}-seller-feed.jpg` and `{iphone,ipad}-seller-orders-url.jpg` are duplicates (seller `/feed` is identical to the buyer feed, and `/orders` is identical to the Orders tab). I deleted them, but another session had already committed them, so I restored the tracked copies. They can be removed in a later commit.

## Routes that failed or were redirected
- No route crashed, and none produced "Unmatched Route" or the ErrorBoundary.
- **Seller `/profile`, `/orders`** resolve to the buyer or root route by URL. I captured them by clicking the seller tab bar ("Orders", "Profile") after loading `/`.
- **Seller `/feed`** renders the buyer `(buyer)/feed` shell (collision).
- **Buyer `/orders`** renders the seller Orders screen (root `app/orders.tsx` redirects to `/(tabs)/orders`).
- **`/buyer-settings`** redirects to `/settings`.
- Data-dependent screens are stuck loading because there was no backend (listed above).
- **Console:** 100% of loads have the 4 deprecation or web-unsupported warnings listed, plus `Failed to load resource: net::ERR_FAILED`. The latter is my deliberate abort of the dummy-key `clerk.example.com` clerk-js request and can be ignored. There were no React key warnings, no act() warnings, and no uncaught errors apart from the video `play()` rejection.

## How to reproduce
```bash
cd /home/user/brandthread/artifacts/mobile
CI=1 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k npx expo start --web --port 8099   # background; first bundle ~60 s
# Playwright lives in the scratchpad (not the repo): npm i playwright@1.56.1 (matches /opt/pw-browsers/chromium-1194)
cd /tmp/claude-0/-home-user-brandthread/4b78e29c-3f8d-5630-be44-67444469f5b4/scratchpad
node capture.js routes   # all routes, iPhone + iPad
node capture.js themes   # purple/maroon on 6 screens
node capture.js banner   # first-run cookie banner
# URL pattern: http://localhost:8099/<route>?bt_preview=seller|buyer&bt_capture=1[&bt_theme=purple]
# Per-route console logs: scratchpad/results-routes.json, results-themes.json
```
Chromium is launched with default Playwright settings. The script aborts requests to `clerk.example.com`, waits for `networkidle` plus 3 s (plus 1.5 s after tab clicks), and saves JPEG q68.

Side effects: `expo start` created `artifacts/mobile/.expo/` and `artifacts/mobile/expo-env.d.ts`. Both are gitignored. The dev server has been stopped.
