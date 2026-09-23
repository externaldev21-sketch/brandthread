# Shared components, layouts & theme

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**7 P0 · 72 P1 · 43 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Auditor slice: `components/**` (not tests), `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(buyer)/_layout.tsx`, `app/index.tsx`, `app/splash.tsx`, `app/+not-found.tsx`, `lib/haptics.ts`, `lib/theme.ts`, `constants/colors.ts`, `hooks/useColors.ts`, `hooks/useHeaderTopInset.ts`, `contexts/AppThemeContext.tsx`, `contexts/ThreadPullTransitionContext.tsx`.
Read-only audit. Every line number below was checked against the file. I computed contrast ratios with the WCAG 2.1 relative-luminance formula and alpha-composited translucent colours over the real surface.

**Totals: 7 P0, 72 P1, 43 P2.**

---

## Theme contrast check (12 presets)

Runtime tokens: text `#FAFAFA`, muted `#B8B8C0`, subtle `#A8A8B1`, border `#FFFFFF2B`. "Card" is the preset `card`. "Grad-L" is the left stop of `primaryGradient` (the PrimaryButton, PlanUpsell header and AIBrainFAB fill). "Chip-on" is FilterChip's active label (`onAccent` on `accentDim` over card). The last two columns show the STATIC `lib/theme` SUBTLE and RED tokens on the preset card. **Bold** marks a failure: under 4.5 for body text, or under 3 for icons and large text.

| Preset | muted/bg | muted/card | subtle/bg | subtle/card | onAccent/accent | onAccent/Grad-L | Chip-on | static SUBTLE/card | static RED/card |
|---|---|---|---|---|---|---|---|---|---|
| monochrome | 10.04 | 8.99 | 8.39 | 7.51 | 18.51 | 18.51 | **1.92** | 4.98 | 6.40 |
| purple | 8.68 | 7.38 | 7.25 | 6.16 | 8.45 | **4.21** | **1.85** | **4.47** | 5.26 |
| olive | 6.81 | 5.40 | 5.69 | 4.51 | 10.86 | 5.53 | **2.35** | **3.81** | **3.85** |
| navy | 9.24 | 7.80 | 7.72 | 6.51 | 7.97 | **3.36** | **1.72** | 4.62 | 5.55 |
| champagne | 8.01 | 5.92 | 6.69 | 4.94 | 11.32 | 5.32 | **2.33** | **4.01** | **4.22** |
| black | 9.10 | 7.38 | 7.60 | 6.17 | 14.99 | 7.07 | **2.16** | 4.56 | 5.26 |
| silver | 7.60 | 5.45 | 6.35 | 4.55 | 15.16 | 7.63 | **2.81** | **3.84** | **3.88** |
| black-gold | 9.93 | 8.55 | 8.29 | 7.15 | 10.84 | 4.61 | **1.62** | 4.89 | 6.09 |
| emerald-gold | 8.20 | 5.40 | 6.85 | 4.51 | 11.02 | **3.95** | **2.47** | **3.80** | **3.84** |
| leopard-red | 8.00 | 5.93 | 6.68 | 4.95 | 10.84 | **2.28** | **2.16** | **3.70** | **4.22** |
| maroon | 9.11 | 6.96 | 7.61 | 5.81 | 7.32 | **2.79** | **1.82** | **4.14** | 4.96 |
| gold | 8.67 | 5.91 | 7.24 | 4.94 | 12.73 | 5.19 | **2.44** | **4.00** | **4.21** |

Takeaways:
- Runtime muted and subtle pass everywhere. Subtle on card is borderline on olive and emerald-gold (4.51) and on silver (4.55).
- `onAccent` on flat `accent` passes everywhere. On the gradient's left stop, it fails on leopard-red (2.28), maroon (2.79) and navy (3.36). At the gradient midpoint, where a centred label sits, leopard-red is 4.68 and maroon is 4.52. Labels pass only barely, and an icon at the left edge fails.
- **Static tokens diverge from the runtime theme.** `lib/theme.ts:37` MUTED is 58% of FG (≈ #939395), where runtime muted is #B8B8C0. `:40` SUBTLE is 50% (runtime #A8A8B1). `:30` BORDER is 7% white (runtime 17%, `AppThemeContext.tsx:39`). `:31` BORDER_SUBTLE is 4% (runtime 10%). A static BORDER on any card measures **1.17–1.24:1**, which is the "foggy outline". The comment at `theme.ts:38-39` ("clears 4.5:1") holds only on #0A0A0B. On themed cards, SUBTLE drops to 3.70–3.84.
- Other measured failures: `rgba(255,255,255,0.35)` text on the preset bg is 2.90–3.14. The LoadingSkeleton fill (5% white) is 1.10:1 at peak and 1.03:1 at its 0.4 pulse. The disabled PrimaryButton label is 2.43–3.20.

---

### Theme tokens and hooks — `lib/theme.ts`, `constants/colors.ts`, `hooks/useColors.ts`, `contexts/AppThemeContext.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | `useColors().muted` returns a *surface* colour (`surfaceGlass`, e.g. `#111113E8`), but 23 call sites use it as a **text** colour. That text renders at 1.04–1.21:1, which is invisible. Affected: request-sample.tsx:171,174,177; manufacturer-onboard.tsx:422,428; post-analytics.tsx:292,402,406 and more. | hooks/useColors.ts:27 | Rename the key to `mutedSurface`, and add `muted` as an alias of `mutedForeground`. A codemod can then replace `color: colors.muted` with `colors.mutedForeground`. |
| P1 | Theme | Static MUTED/SUBTLE/BORDER/BORDER_SUBTLE differ from the runtime values (see table), so 50+ static uses in BrandthreadUI alone look foggier than themed screens. | lib/theme.ts:30-31,37,40 | Set static values to match the runtime (`MUTED='#B8B8C0'`, `SUBTLE='#A8A8B1'`, `BORDER='rgba(255,255,255,0.17)'`, `BORDER_SUBTLE='rgba(255,255,255,0.10)'`), and mark the colour exports `@deprecated`, pointing to `useAppTheme()`. |
| P1 | Theme | `getOnAccentTextStyle` adds a `#00000055` text shadow to every on-accent label. On light accents (monochrome, black, silver, gold, champagne) the label is dark, so a dark smudge under dark text makes it look blurry. | contexts/AppThemeContext.tsx:25-26 | Remove the shadow, or apply it only when the `onAccent` luminance is above 0.5. |
| P1 | Theme | `onAccent` on the gradient's left stop fails on leopard-red (2.28), maroon (2.79) and navy (3.36). | AppThemeContext.tsx:51,57,58 | Lighten the left stops: `#A70807` to `#E04A3A`, `#B51F32` to `#E0525C`, `#235EDE` to `#4F86F0`. The alternative is flat `accent` for button fills. |
| P1 | Motion | Theme flash when the account changes. `setIsHydrated(false)` runs whenever `userId` changes (sign-in, sign-out, account switch). `RuntimeThemeShell` then swaps the whole tree for `<BootScreen/>`, which unmounts the Stack and resets navigation state. | AppThemeContext.tsx:99 | Keep the current theme mounted while re-reading storage. Only the first cold-boot hydration should gate on `isHydrated`. |
| P1 | Motion | The server theme can override the local theme **after** first paint. The user sees the app switch colours a second or two after launch. | AppThemeContext.tsx:125 | Apply the server theme only if no local value exists, or with a 200 ms cross-fade. Otherwise persist it silently for the next launch. |
| P2 | Theme | `input` is always static `CARD_GLASS`, because presets have no `input` key. `info` maps to accent, so "info" states look identical to primary. | hooks/useColors.ts:35,39 | Add `input: card` and a neutral `info` to `palette()`. |
| P2 | Consistency | The `light` palette in `constants/colors.ts` is dead code, since the app is dark-only. | constants/colors.ts:15-36 | Delete it. |

### Haptics — `lib/haptics.ts`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | Good wrappers exist, but BrandthreadUI itself bypasses them: raw `Haptics.impactAsync` or `Haptics.selectionAsync` with no `.catch`. On web or unsupported devices this rejects unhandled. | BrandthreadUI.tsx:244,465,589,841 | Use `hapticLight()` / `hapticSelection()` everywhere. Add `hapticWarning()` and `hapticHeavy()` so screens stop importing expo-haptics directly. |

### Root layout — `app/_layout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | On the feature-paused screen, the "Go back" button has white text (`#FFFFFF`) on a `#F5F5F7` fill, a **1.09:1** ratio, so the label is invisible. All its colours are hardcoded and ignore the theme. | _layout.tsx:731-736 | Use `<PrimaryButton label="Go back" …/>`. Fall back to `router.replace('/')` when `!router.canGoBack()`. |
| P1 | Copy | The paused-feature copy is wordy. | _layout.tsx:726-729 | Title "Back soon". Body "We're polishing this feature. Your work is safe." |
| P1 | Motion | Up to four boot stages flash in sequence. The native splash (`#0D0D0D`, app.json:275) hides as soon as fonts load (:1016-1020). Then `<ClerkLoading><BootScreen/>` renders **outside** AppThemeProvider, so it is always monochrome (:1061-1063). The not-hydrated BootScreen follows (:96), then the themed index BootScreen, then the redirect. Purple, olive and maroon users see black, then a jump to their colour. | _layout.tsx:96,1016-1020,1061-1063 | Keep the native splash until `fontsLoaded && clerkLoaded && theme.isHydrated`. Cache the theme id in a synchronous store (e.g. MMKV) so the first frame is themed. Match the splash bg to `#0A0A0B`. |
| P1 | Visual | The seller tab bar is `position:'absolute'`, but the comment says it "does not physically overlay these screens". It does overlay them, on every seller screen, including fullScreenModal routes on Android (camera-capture, create-post, seller-go-live), where it covers bottom CTAs. | _layout.tsx:125-130,989 · SellerGlobalTabBar.tsx:385 | Exclude `camera-capture`, `create-post`, `seller-go-live`, `seller-live`, `buyer-*`, `checkout`, `design-canvas` and `thread-*`. Also export a `useTabBarInset()` hook so screens pad correctly. |
| P1 | Visual | `StoreContextBanner` sits above the Stack and adds `insets.top`. Every ScreenHeader then adds `insets.top` again, so team members get a double notch gap on every seller screen. | _layout.tsx:750 · StoreContextBanner.tsx:159 | Move the banner inside the headers (a slot in ScreenHeader), or have ScreenHeader skip the inset when the banner is visible. |
| P1 | Motion | `thread-product-detail` and `thread-checkout` use `animation:'none'` and `gestureEnabled:false`. Checkout has no swipe-back, and it pops in with no transition. | _layout.tsx:873,876 | Use `animation:'slide_from_right'` with gestures enabled (or `'fade'` if a custom thread-pull transition is planned). |
| P1 | Perf | A `Pressable onPress={Keyboard.dismiss}` wraps the entire Stack. Every touch in the app becomes a responder candidate, which can steal taps from nested Pressables and delay scroll starts. | _layout.tsx:752 | Remove it. Use `keyboardDismissMode="on-drag"` and `keyboardShouldPersistTaps="handled"` on the screen scroll views. |
| P2 | Motion | `animationDuration: 220` has no effect on iOS `slide_from_right`; it applies only to fade and bottom animations. `freelancer-apply` is a push that slides from the bottom but swipes back from the left edge. | _layout.tsx:761,961 | Remove `animationDuration`. Make `freelancer-apply` `presentation:'modal'`. |
| P2 | Consistency | 200+ `headerShown:false` and `animation:'slide_from_right'` repeat the screenOptions defaults. `OPAQUE_SCREEN_CONTENT` is named "opaque" but holds `transparent`. | _layout.tsx:60,767-985 | Remove the redundant options and rename the constant to `TRANSPARENT_CONTENT`. |
| P2 | Perf | `<NetworkNoticeBanner/>` always returns null, and the hero `LinearGradient` in RuntimeThemeShell is fully covered by `IsolatedStackScene`'s opaque bg. Both are wasted renders. | _layout.tsx:66,100-104,751 | Remove both, or make scenes transparent if the gradient is wanted. |
| P2 | Perf | `new QueryClient()` uses the defaults (3 retries, `staleTime` 0), so every focus refetches. | _layout.tsx:255 | Set `defaultOptions:{queries:{staleTime:30_000,retry:1}}`. |

### Seller tab layout — `app/(tabs)/_layout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Consistency | Unused label constants exist only to satisfy a source-scanning test. | (tabs)/_layout.tsx:21-33 | Point the test at `TABS` in SellerGlobalTabBar and delete the constants. |

### Seller global tab bar — `components/SellerGlobalTabBar.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | Tab press calls `router.replace(destination)`. It wipes the back stack, animates as a push-slide instead of an instant tab switch, and re-mounts the tab. Tapping the active tab does not scroll to top. | SellerGlobalTabBar.tsx:323-326 | Use `router.navigate('/(tabs)/products')`. When the tab is already focused, emit `tabPress` so `useScrollToTop` works (the Instagram behaviour). |
| P1 | Motion | The four tabs have no pressed style, so there is no visual feedback. Only the side buttons get `pressed`. | SellerGlobalTabBar.tsx:339 | Add `({pressed}) => [styles.tab, pressed && styles.pressed]` or use PressableScale. |
| P1 | Visual | iPad: the `centerBar` is `flex:1` with no maxWidth, so on a 1024 pt screen four tabs spread across about 880 pt. | SellerGlobalTabBar.tsx:397-398 | Wrap the bar in `maxWidth: 560, alignSelf:'center', width:'100%'`. |
| P1 | Consistency | The seller bar is a full-width, solid (96% opaque), unblurred band with pills. The buyer bar is a floating blurred capsule. The two bars look like different apps. | SellerGlobalTabBar.tsx:286-296 vs (buyer)/_layout.tsx:336-349 | Pick one tab bar language: the buyer capsule plus side circles. |
| P1 | Perf | A 30 s `setInterval` fetches the **entire** `api.orders.list()` just to count pending orders, and it keeps running when the app is backgrounded. | SellerGlobalTabBar.tsx:227,259 | Add a `/orders/count?status=pending&since=` endpoint. Pause on `AppState !== 'active'`. |
| P1 | UX | `requestContextualPushPermission` fires from the background poll, so an OS permission prompt can appear mid-task. | SellerGlobalTabBar.tsx:237-239 | Prompt only after the user opens Orders and sees the new order. |
| P1 | Visual | Any unmapped route (design, ai-brain, analytics-*, store-*, marketing) highlights **Dashboard**, which is misleading. | SellerGlobalTabBar.tsx:166-168,182 | Return `null` for unmapped routes and highlight no tab. |
| P2 | Motion | The Studio and AI side buttons have no haptic; the tabs do. | SellerGlobalTabBar.tsx:302,367 | Call `hapticLight()` in both handlers. |
| P2 | Theme | `INACTIVE_COLOR` is hardcoded, and the StyleSheet has dead static backgrounds and borders. | SellerGlobalTabBar.tsx:109,405-406,415-416 | Use `theme.muted`. Delete the dead values. |
| P2 | Consistency | `SellerNavigationShell` is exported but never used. | SellerGlobalTabBar.tsx:473-485 | Delete it. |

### Buyer tab layout — `app/(buyer)/_layout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | A11y | Tab labels are **10 pt**, below the 11 pt floor. | (buyer)/_layout.tsx:584-585 | Use `fontSize: 11, lineHeight: 13` (FS.xs) with `Inter_600SemiBold`. |
| P1 | Visual | On devices with `insets.bottom === 0` (Android gesture off, iPhone SE, iPad without a home indicator), the capsule sits 4 pt from the screen edge. | (buyer)/_layout.tsx:302,328 | `paddingBottom: Math.max(bottomInset, 12) + 4`. Update `barHeight` to match. |
| P1 | Motion | The bar rides up on the keyboard on **every** tab, so it floats over the keyboard while the user types a comment on Home or Discover. | (buyer)/_layout.tsx:206-224,253-265 | Ride the keyboard only when `searchActive`. Otherwise fade the bar out on `keyboardWillShow`, as iOS does. |
| P1 | Perf | `router.setParams({q})` runs on every keystroke, which re-renders the Search screen per character and has no debounce. | (buyer)/_layout.tsx:293-296 | Debounce by 250 ms and set params on submit. Keep the local state immediate. |
| P1 | Perf | A 30 s `setInterval` loads all conversations and notifications for the badge, including in the background. | (buyer)/_layout.tsx:53-61 | Rely on `subscribeSocial` and push. Poll only while `AppState` is active. |
| P1 | Motion | `openTab` calls `navigation.navigate(name)` directly, so no `tabPress` event fires. Re-tapping Home does not scroll to top or refresh. | (buyer)/_layout.tsx:284-291 | Emit `navigation.emit({type:'tabPress', target: route.key, canPreventDefault:true})` before navigating. |
| P2 | Perf | Two `BlurView`s (`dimezisBlurView` on Android is expensive) sit under a 96%-opaque fill, so the blur is invisible and the cost is wasted. | (buyer)/_layout.tsx:344-349,502-510 | Use `tabBarBackground` at 70% alpha so the blur shows, or drop the BlurView. |
| P2 | Visual | Double hairline: `mainPill` has a border, and `pillHairline` draws a second one on top. | (buyer)/_layout.tsx:338-340,352 | Keep one. |
| P2 | Consistency | The `tabBarIcon` SF Symbol configs (:88-177) are never rendered by the custom tab bar, and `TabIcon` (:806-825) is unused. | (buyer)/_layout.tsx:88-177,806-825 | Delete them. |
| P2 | Perf | `reactivate()` has no `.catch` and its promise is floating. | (buyer)/_layout.tsx:831-833 | Chain `.catch(() => {})`. |

### Screen header — `components/ScreenHeader.tsx` (39 screens)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | Web top pad is a hardcoded 68 pt (`SP.xxl+SP.md+SP.xs`), used even on desktop with no status bar. `useHeaderTopInset` uses 67, LegalDocument uses `max(insets.top,67)`, and 19 screens have their own `Platform.OS==='web' ? 6x` literal. iPad native is fine (insets.top 24). The app is portrait-only, so landscape is untested, and iPad split view is not supported (see Cross-cutting). | ScreenHeader.tsx:20-22 · useHeaderTopInset.ts:11 | Use `useHeaderTopInset()` everywhere, returning `insets.top` on web too (the web preview frame should add its own inset). |
| P1 | Visual | The title has no `numberOfLines`. Long titles ("Store settings & policies") wrap to two or three lines, and the bottom-aligned layout grows. | ScreenHeader.tsx:37 | Use `numberOfLines={1}` with `adjustsFontSizeToFit minimumFontScale={0.85}`. |
| P1 | Visual | `rightSlot` is fixed at 44 pt, so any wider right element (text "Save", two icons) overflows or clips. | ScreenHeader.tsx:43-45,81-84 | Use `minWidth: 44` and make the title `flex:1`. |
| P1 | UX | The back button always renders and always calls `router.back()`. On a deep link or web refresh there is no history, so it does nothing. | ScreenHeader.tsx:26-27 | `router.canGoBack() ? router.back() : router.replace(fallbackHref)`. Add a `showBack` and a `fallbackHref` prop. |
| P2 | Motion | There is no haptic on back. The a11y label is verbose: "Go back from X" with the hint "Returns from X". | ScreenHeader.tsx:27,30-31 | Call `hapticLight()`. Label "Back", no hint. |
| P2 | Visual | A 1 pt bottom border at 17% white looks heavy next to the iOS hairline. | ScreenHeader.tsx:57 | `StyleSheet.hairlineWidth`. |

### BrandthreadUI primitives — `components/BrandthreadUI.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | **FilterChip active label and count use `theme.onAccent` (a near-black) on `accentDim` (18% accent over dark)**, measuring 1.62–2.81:1 on all 12 presets. Every selected filter chip in 16 screens is close to unreadable. | BrandthreadUI.tsx:594,597 | Use `color: theme.accentLight` for the active label and count, and keep the `accentDim` fill. Or use a solid `theme.accent` fill with `onAccent` text. |
| P1 | Motion | `PrimaryButton` never passes `disabled` or `loading` to PressableScale, so a disabled button still scales and dims on press and feels live. | BrandthreadUI.tsx:372-381 | Pass `disabled={disabled \|\| loading}` to PressableScale. PressableScale should skip the animation when disabled. |
| P1 | Visual | The disabled PrimaryButton label is muted text at 50% opacity on card, 2.43–3.20:1, which reads as foggy. | BrandthreadUI.tsx:383,393 | Drop `opacity:0.5` and use `palette.subtle` text on `palette.elevated`. |
| P1 | Visual | `PressableScale` forces `minHeight: 44` on the inner view of every consumer. FilterChip's `height:34` becomes 44, and SectionHeader's action link becomes a 44 pt row, which misaligns text rows. | BrandthreadUI.tsx:127 | Enforce touch size with `hitSlop` rather than `minHeight`. Let callers opt in with `minTouch`. |
| P1 | Visual | The IconButton badge is an 8×8 dot, but it renders the count text inside it. The count is clipped to garbage (live on the seller dashboard bell, `(tabs)/index.tsx:615`). | BrandthreadUI.tsx:505-510,519 | When `badgeCount>0`, render a pill: `minWidth:16,height:16,borderRadius:8,paddingHorizontal:4,top:-4,right:-4`. |
| P1 | Theme | `BrandthreadHeader`'s back button uses static `CARD`/`BORDER` with no runtime override, it is 36 pt, and the header has no top safe-area. | BrandthreadUI.tsx:271-272,240 | Merge into ScreenHeader (see the canonical set). |
| P1 | Theme | `FormInput` (10 screens) is fully static: `CARD`, `BORDER` (1.2:1, so the field edge is invisible), `FG`, `SUBTLE` placeholder. It has no error or helper state. | BrandthreadUI.tsx:949-981 | Use `useColors()` with `border` (17%) and a focused `accent` border. Add `error?: string` rendered in `colors.destructive` with FS.xs, and `helper?: string`. |
| P1 | Theme | `NavigationCard`, `QuickActionCard`, `SectionHeader` and `StatCard` text use static `CARD/BORDER/FG/MUTED` and ignore the preset. | BrandthreadUI.tsx:763,780,804-805,819-820,862-867,1057,1064,1066,1072-1074 | Read `useColors()` in each. |
| P1 | Theme | `StatusBadge` uses static status colours (`#10B981`, `#F87171`, `#F97316`) at FS.xs (11 pt). They fail on olive, silver and emerald-gold (3.79–3.88:1). The runtime presets define their own softer `success/warning/error`, so two greens and two reds coexist app-wide. | BrandthreadUI.tsx:626-633,641 | Map variants to `theme.success/warning/error` with a `${color}24` bg. |
| P1 | Visual | `LoadingSkeleton` is 5% white pulsing between 0.4 and 1 opacity, which measures 1.03–1.10:1. Skeletons are nearly invisible and look like an empty screen. | BrandthreadUI.tsx:1088-1101 | Base fill `rgba(255,255,255,0.08)`, pulse 0.55↔1, or a native-driver shimmer sweep. |
| P1 | Visual | `BrandedLoadingState` shows a static Feather `loader` glyph that only fades, so it reads as a frozen spinner. | BrandthreadUI.tsx:1233-1241 | Rotate it (`Animated.loop` rotate, native driver) or reuse BrandedLoader's mark. |
| P1 | Visual | `UndoToastProvider` is pinned at `bottom: 32` with no safe-area and no tab-bar offset. It renders over the seller and buyer tab bars' icons. It has no enter or exit animation, and "Undo" is success-green. | BrandthreadUI.tsx:67-73,79,71 | `bottom: insets.bottom + tabBarHeight + 8`, a 180 ms fade and slide (native driver), `hapticLight()` on show, Undo in `theme.accent`. |
| P2 | Theme | `BrandedLoader` label uses static MUTED. It pulses scale 0.72↔1, which feels bouncy. | BrandthreadUI.tsx:735,748 | Pulse opacity only (0.6↔1). Use `colors.mutedForeground`. |
| P2 | Visual | `BrandthreadHeader gradient` renders a title coloured `theme.accent` on a `[accent, accentLight]` gradient (the same colour), so it is invisible. The prop is unused today. | BrandthreadUI.tsx:252-255 | Delete the `gradient` prop. |
| P2 | Theme | `IconButton` defaults `color = FG` (static). `SheetHandle` is a static 15% white. | BrandthreadUI.tsx:492,1290 | Use `colors.foreground` and `colors.border`. |
| P2 | Theme | `HapticSwitch` has no themed `trackColor`, so iOS shows the stock green, and only 3 callers pass one. | BrandthreadUI.tsx:1180-1190 | Default `trackColor={{true: theme.accent, false: colors.border}}` and `thumbColor` to match. |
| P2 | Motion | `ProgressCard` animates `width` with `useNativeDriver:false`. It is unused. | BrandthreadUI.tsx:998 | Delete it, or use `scaleX` with the native driver. |
| P2 | Visual | EmptyState actions are `width:'100%'` with no max, so the button stretches about 700 pt on iPad. | BrandthreadUI.tsx:715-716 | `maxWidth: 360, alignSelf:'center'`. |
| P2 | Consistency | `TertiaryButton`, `ProgressCard`, `Toast` (1 use), `CheckoutSkeleton` and `SearchResultsSkeleton` (1 use each) duplicate or are unused. | BrandthreadUI.tsx:457,994,1262 | See the canonical set. |

### Inline feedback — `components/InlineFeedback.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | All four primitives are static (`CARD, BORDER, FG, MUTED, SUBTLE, RED`). | InlineFeedback.tsx:17-20 | Use `useColors()`. |
| P2 | A11y | The Retry targets are FS.xs text with an 8 pt hitSlop, about 29 pt tall. | InlineFeedback.tsx:95-103,178-187 | `minHeight: 44` on the retry button. |
| P2 | Copy | `SectionError` always shows `wifi-off`, even for server errors (and the network banner was deliberately removed). | InlineFeedback.tsx:176 | Use `alert-circle`. |
| P2 | Perf | `useRef` is called inside `.map()`, which breaks the rules of hooks. | InlineFeedback.tsx:38 | Use `useRef([0,1,2].map(() => new Animated.Value(0.3))).current`. |

### Keyboard and images — `components/KeyboardAwareScrollViewCompat.tsx`, `components/CachedImage.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | "KeyboardAware" is a plain ScrollView and ignores `bottomOffset`. `react-native-keyboard-controller` is installed but unused and no `KeyboardProvider` is mounted, so inputs low on a form sit under the keyboard. | KeyboardAwareScrollViewCompat.tsx:7-20 | Mount `<KeyboardProvider>` in the root layout. Re-export `KeyboardAwareScrollView` from `react-native-keyboard-controller` and pass `bottomOffset`. |
| P1 | Visual | The default blurhash `LEHV6nWB2yk8pyo0adR*.7kCMdnj` is the blurhash.io demo (a colourful photo). Every loading image flashes a teal and orange blob in a monochrome app. | CachedImage.tsx:4,23 | Use a neutral dark placeholder: `placeholder={{blurhash:'L02rs+of00of~qj[offQ00j[?bj['}}`, or a `backgroundColor: colors.card` view. |

### Boot, splash, index and not-found — `components/BootScreen.tsx`, `app/splash.tsx`, `app/index.tsx`, `app/+not-found.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | The first-run splash auto-advances after 2.5 s with no tap-to-skip. Added to the native splash and BootScreen, that is about 4 s before onboarding. | splash.tsx:139 | 1.2 s, and make the screen a Pressable that calls `continueForward`. |
| P1 | Copy | The not-found screen uses "Oops!" as its title and "Go to home screen!", which breaks the brand voice (no "Oops", no exclamation marks). It also uses bold `fontWeight` without Inter, so it renders in the system font. | +not-found.tsx:170,173,178,195 | Title "Page not found". Body "This link may be broken or expired." Button "Go home" as `<PrimaryButton>`, using `FONT.bold`. |
| P2 | Visual | The BootScreen logo is 150 pt with a theme tint. The native splash is `splash-icon.png` on `#0D0D0D`, so the colour and size may jump at handoff. | BootScreen.tsx:16 · app.json:273-275 | Match the splash bg to `#0A0A0B` and the logo size to the splash image. |

### Store context banner — `components/StoreContextBanner.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | The safe-area band and card are static `BG`, `CARD` and `BORDER`, so a black strip appears above every seller screen on themed presets. | StoreContextBanner.tsx:256,268-270,311-313,352 | `theme.background`, `theme.card`, `theme.border`. |
| P1 | Copy | A vague Alert on switch failure. | StoreContextBanner.tsx:141-144 | Title "Couldn't switch stores". Body "Check your connection and try again." Show as an inline error, not an Alert. |
| P1 | Consistency | The switcher is a centred fade Modal, not a bottom sheet. The close button is 34 pt. | StoreContextBanner.tsx:179-200,333-341 | Use the canonical BottomSheet. Close 44 pt. |

### Shop-the-post sheet — `components/ShopProductSheet.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw `err.message` is shown in the purchase sheet (server or JS error text). | ShopProductSheet.tsx:442,506,532 | Load: "Couldn't load this product. Tap to retry." Add: "Couldn't add to bag. Try again." Buy: "Couldn't start checkout. Try again." |
| P1 | Copy | "Please" padding and robotic phrasing. | ShopProductSheet.tsx:474,478,514,518 | "Pick a size first.", "That combo isn't available.", "Sold out in this option." |
| P1 | Copy | "Only {n} left" shows "Only 0 left" because the condition `<= 5` includes 0. | ShopProductSheet.tsx:741-744 | `inventoryQuantity > 0 && <= 5`. Otherwise show "Sold out". |
| P1 | Copy | The hardcoded trust claims "Easy returns" and "Fast shipping" are not backed by seller data. | ShopProductSheet.tsx:764-766 | Show them only when the product or seller has a return policy or shipping SLA. Otherwise show just "Secure checkout". |
| P1 | Motion | `animationType="none"`, so the dim backdrop pops in at full opacity while the sheet springs. The PanResponder is on the whole sheet and fights the inner ScrollView. | ShopProductSheet.tsx:563-567,576 | Animate backdrop opacity from `slideY`. Attach pan handlers to the handle and header only. |
| P1 | Visual | The handle is `BORDER` (7%), which is invisible. The close button is 32 pt. Chips, qty, add and close use static `CARD_ELEVATED`, `BORDER` and `FG` inside a themed `surface` sheet. | ShopProductSheet.tsx:1036,1054-1059,171-183,238-247,1257-1273 | Use SheetHandle (themed). Close 44 pt. Use `theme.*` throughout. |
| P1 | Consistency | Bespoke TouchableOpacity CTAs, and a spinner where a skeleton belongs. | ShopProductSheet.tsx:771-805,628-633 | `SecondaryButton "Add to bag"` and `PrimaryButton "Buy now"`, plus a 3-row skeleton. |
| P2 | Copy | "SHOP THE POST" and "PRE" are all caps, and it says "cart" where the brand says "bag". | ShopProductSheet.tsx:583,937,784,888 | "Shop the post", "Pre-order", "Add to bag", "View bag", "Added to bag". |
| P2 | Visual | Unavailable chips get a CSS line-through **and** a red overlay line at 50% opacity, so the strike is doubled and faint. | ShopProductSheet.tsx:161,166,184-193 | Keep one strike and use `opacity: 0.4`. |

### Plan upsell — `components/PlanUpsellModal.tsx` (4 callers, the paywall)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The header subtitle is `theme.muted` on `primaryGradient` and measures 1.14–3.97:1 on **every** preset. The feature name is `theme.text` at 1.02:1 on monochrome and 1.18–2.39 on the light stop elsewhere. The close X is 60% white at 1.00–1.74:1. The paywall headline block is unreadable. | PlanUpsellModal.tsx:96-97,106-108,244-254 | On the gradient, use `theme.onAccent` for the subtitle (opacity 0.8) and the feature name, and use the `onAccent` X. Or make the header `theme.card` with the gradient only as a 4 pt top rule. |
| P1 | Motion | `animationType="slide"` puts the dim backdrop inside the sliding modal, so the dark overlay slides up from the bottom. | PlanUpsellModal.tsx:77-86 | `animationType="fade"`, with the sheet translating up itself (native driver). |
| P1 | Copy | "You tapped this" is robotic. "{feature} and 11 more tools are available on the Growth plan ($X/mo)." is long. | PlanUpsellModal.tsx:108,143 | Badge "Selected". Subtitle "Unlock {feature} and 11 more tools with Growth." |
| P2 | A11y | The close button is 32 pt. | PlanUpsellModal.tsx:220-228 | 44 pt. |

### Share sheet — `components/ThreadShareSheet.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw `error.message` from file-system or media-library errors is shown to users. | ThreadShareSheet.tsx:217 | "Couldn't save video. Try again." |
| P1 | Motion | `animationType="slide"` makes the backdrop slide up with the sheet. There is no handle, no swipe-to-dismiss, and no haptics on any share action. | ThreadShareSheet.tsx:234-236 | Use the canonical BottomSheet. `hapticLight()` on each action. |
| P1 | Visual | The busy spinner is `theme.onAccent` (near-black) on `surface` (dark), so it is invisible. | ThreadShareSheet.tsx:343 | `color={theme.text}`. |
| P1 | UX | "More friends" deep-links through the OS (`Linking.openURL(createURL(...))`), which flashes the app and can open the browser on web. | ThreadShareSheet.tsx:265 | `router.push('/(buyer)/friends')`. |
| P2 | Copy | Progress reads "42% Saving…". The permission message is formal. | ThreadShareSheet.tsx:297,188 | "Saving… 42%". "Allow Photos access to save videos." |

### Studio radial menu — `components/SellerStudioRadialMenu.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | "Couldn't save shortcut — tap to retry" is plain Text with no onPress, so the affordance is dead. | SellerStudioRadialMenu.tsx:458-462 | Make it a Pressable that re-saves, or change the copy to "Couldn't save shortcut. Try again." |
| P1 | Motion | The shortcut picker's `animationType="slide"` slides its backdrop with it, the same glitch as above. | SellerStudioRadialMenu.tsx:581-596 | Use the canonical BottomSheet. |
| P2 | Copy | The tab bar button says "Studio" but the sheet heading says "Main menu". | SellerStudioRadialMenu.tsx:447 | "Studio". |
| P2 | Visual | `SHEET_WIDTH` is read from `Dimensions` at module load, so it goes stale on iPad split view or resize. | SellerStudioRadialMenu.tsx:89-95 | Derive it from `useWindowDimensions()`. |

### AI FAB — `components/AIBrainFAB.tsx` (customers, content, product-detail)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | `bottom = 8 + insets.bottom` places it inside the 76 pt seller tab bar. The tab bar is a later sibling at the root, so zIndex 9999 cannot lift it, and the FAB sits under or behind the bar's own "AI" button. That makes two AI entry points in the same corner. | AIBrainFAB.tsx:149 · SellerGlobalTabBar.tsx:363-376 | Retire the FAB (the tab bar already has AI). If it stays, add `+ 76 + 12`. |
| P1 | Motion | A stale closure: the keyboard listeners are registered once, so `_showAfterKeyboard` sees the initial `hidden` and re-shows the FAB after the keyboard closes even when `hidden` is true. | AIBrainFAB.tsx:65-85 | Hold `hidden` in a ref. |
| P2 | UX | The two-tap reveal-then-open pattern is non-standard. The collapsed tab shows only a chevron. | AIBrainFAB.tsx:121-145 | Single tap opens. |

### Seller home dashboard — `components/SellerHomeCommerceDashboard.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | The first stat tile uses the themed `cardElevated`, while tiles 2 and 3 use static `CARD_ELEVATED_GLASS`, so the tiles mismatch on non-monochrome presets. `palette.foreground` and `palette.glass` are not keys on the preset, so they always fall back to static values. | SellerHomeCommerceDashboard.tsx:492,503,514,449,467 | Apply the same themed style to all three. Use `theme.text` and `theme.surfaceGlass`. |
| P1 | Copy | The button says "Withdraw", but every dialog says "Cash out". Labels are title case ("Pending Balance", "Available Balance"). The `$` is a hardcoded text glyph. | SellerHomeCommerceDashboard.tsx:562-565,307,530,536 | "Cash out" everywhere. "Pending", "Available". A Feather `arrow-down-circle` icon. |
| P1 | Consistency | 8 `Alert.alert` calls, including a success Alert "Cash out requested". The cash-out button is a static `FG` fill, which ignores the theme. | SellerHomeCommerceDashboard.tsx:284,292,307,311,346,364,388,410,548-551 | Success as a toast: "{amount} is on its way to your bank." `PrimaryButton label="Cash out"`. |
| P2 | Consistency | A local `SkeletonBlock` (static, no pulse) duplicates LoadingSkeleton. | SellerHomeCommerceDashboard.tsx:95-125 | Use `LoadingSkeleton`. |

### Stripe warning, role lock and native-only fallback — `components/StripeConnectWarning.tsx`, `components/RoleLockedView.tsx`, `components/NativeOnlyFeature.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | `Alert('Error', 'Could not open Stripe onboarding. Please try again.')`. "Fix Now" is title case. "Buyers can't checkout" uses the noun form as a verb. | StripeConnectWarning.tsx:115,122,171,159 | Alert title "Couldn't open Stripe". Body "Check your connection and try again." Button "Fix now". "Buyers can't check out until Stripe verifies your account." |
| P1 | Visual | The body text is static `RED` (#F87171) on an `accentDim` fill with an `accent` border, which reads as red-on-purple on themed presets. "Fix now" is 11 pt red. | StripeConnectWarning.tsx:217-220,237-244 | Use `theme.warning` for the icon and "Fix now", and `theme.text` or `theme.muted` for copy. |
| P1 | UX | RoleLockedView is a dead end: no back button and no action. | RoleLockedView.tsx:22-44 | Add `SecondaryButton "Go back"` (canGoBack or replace to `/(tabs)`) and `TertiaryButton "Ask the owner"` (opens team chat). |
| P2 | UX | NativeOnlyFeature calls `router.back()` without checking `canGoBack`. | NativeOnlyFeature.tsx:47 | Fall back to `router.replace('/')`. |

### Legal document — `components/legal/LegalDocument.tsx` (privacy, terms)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Internal draft text is shipped to users: "Legal review required before launch", "OWNER + COUNSEL ACTION REQUIRED", "[LEGAL ENTITY NAME] · [POSTAL ADDRESS] · …", and "Draft document for legal review." This is also an App Store review risk. | LegalDocument.tsx:96-104,130-137,140 | Delete the notice and placeholder blocks. The footer becomes "© 2026 Brandthread, Inc." Fill in the real entity, address and contact. **Needs owner and counsel.** |
| P2 | Visual | The brand mark is a text letter "B" in a box instead of the logo. | LegalDocument.tsx:73-76 | `<BrandthreadLogo size={28} tintColor={theme.accentLight}/>`. |

### Onboarding plan step — `components/onboarding/SellerPlanRecommendationStep.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | A11y | The charge note is white at 35% and 11 pt (2.90–3.14:1). Guidance at 45% and period at 42% measure 3.64–4.05 on olive, silver and leopard-red. | SellerPlanRecommendationStep.tsx:110,93,104 | Use `theme.muted` at 12 pt minimum. |
| P1 | Theme | Hardcoded `#FFF`, rgba whites and a `#34D399` check (a third green). | SellerPlanRecommendationStep.tsx:69,91-110 | Use `theme.text`, `theme.muted` and `theme.success`. |
| P2 | Copy | All caps: "YOUR PERSONALIZED PLAN", "RECOMMENDED". | SellerPlanRecommendationStep.tsx:29,58 | "Your plan", "Recommended". |
| P2 | Consistency | A bespoke continue button. | SellerPlanRecommendationStep.tsx:79-83 | `<PrimaryButton label={`Continue with ${name}`} />`. |

### Misc used components — `EngagementButton.tsx`, `SellerDashboardSections.tsx`, `TextOverlayEditor.tsx`, `CommerceSignal.tsx`, `SwipeActionRow.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | `FeedToastProvider` is a **third** toast system: bottom 110 hardcoded, a static `#1a0d0d` error bg, and `'error'` as the default variant. | EngagementButton.tsx:60-150 | Fold it into the canonical Toast. |
| P2 | Copy | "Revenue Trend" and "High Demand" are title case. | SellerDashboardSections.tsx:47 · CommerceSignal.tsx:288,395 | "Revenue trend", "High demand". |
| P2 | Perf | The drag creates a new `Animated.event` on every move with `useNativeDriver:false`, so text dragging runs on the JS thread. | TextOverlayEditor.tsx:403 | Create the event once, or move to Gesture Handler with Reanimated (already installed). |
| P2 | Perf | Each countdown row runs its own 1 s `setInterval` in feeds. | CommerceSignal.tsx:130-136 | Use one shared ticker context. |
| P2 | Visual | The action background has square corners behind the rounded card row. | SwipeActionRow.tsx:98-110 | Match the child `borderRadius` on `clip`. |

---

## Clean / low-risk

- `contexts/ThreadPullTransitionContext.tsx`: fine. One minor point: the provider value is not memoised, and `back()` falls back to the buyer home even for sellers (line 42). Use role-aware fallback and `useMemo`.
- `hooks/useHeaderTopInset.ts`: correct on native. Only the web 67 literal is an issue (covered above).
- `components/ErrorBoundary.tsx` is clean. `ErrorFallback.tsx` copy could be "Something broke on our side" / "Reload" (currently "Something went wrong" / "Please reload the app to continue." / "Try Again", lines 72, 76, 98). Treat that as P2.
- `components/SellerQuickActionsGrid.tsx`, `SellerDashboardKPIGrid.tsx`, `sellerCompactGridLayout.ts`, `DesignLayerCompositor.tsx`, `branding/BrandthreadLogo.tsx`: theme-aware and clean. `CommerceSignal` respects Reduce Motion.
- `AddressAutocompleteInput.tsx`: "Powered by Google" is a Google Places attribution requirement, so keep it.
- **Dead code, unused anywhere in the app** (2,700 lines): `StatCard.tsx`, `ProductCard.tsx`, `FeatureCard.tsx`, `Badge.tsx` is used by 11 files but duplicates StatusBadge, `ProfileTabButton.tsx`, `ModeSwitcher.tsx`, `SellerCreateFAB.tsx`, `SupportChatBubble.tsx`, `DateRangePicker.tsx`, `StyleTagsPicker.tsx`, `SellerTutorialOverlay.tsx`, `branding/AnimatedGradientBackground.tsx` (525 lines), `SellerNavigationShell`, `TertiaryButton`, `ProgressCard`. I did not audit these in depth, so delete them rather than polish them.

## Cross-cutting patterns in my slice

- **Static tokens inside the "shared" layer:** BrandthreadUI has 50 static-token references, ShopProductSheet 43, SellerHomeCommerceDashboard 49, InlineFeedback 23 and StoreContextBanner 21. The components every screen reuses are what break theming. Fixing about 6 files fixes most "black card on purple" reports app-wide.
- **Three sheet implementations and no BottomSheet primitive:** 5 bespoke Modals in my slice (ShopProductSheet, ThreadShareSheet, PlanUpsellModal, StoreContextBanner, the radial menu picker). 3 use `animationType="slide"` with the backdrop inside, so the dim slides up from the bottom. `SheetHandle` is only used in design-canvas.
- **Four toast systems:** `Toast` (1 use), `UndoToastProvider` (2 uses), `FeedToastProvider` (feed), and `InlineError` / `onFeedback`, plus 8 `Alert.alert` calls in the dashboard alone, success messages included.
- **Three loaders:** `BrandedLoader` (2 uses), `BrandedLoadingState` (3 uses), `BootScreen`. Plus 124 app files use a bare `ActivityIndicator`. Only 10 use skeletons, and those skeletons measure 1.1:1.
- **Duplicates:** two headers (ScreenHeader 39 uses, BrandthreadHeader 21 uses), two SectionHeaders (the `components/SectionHeader.tsx` file with 1 use vs BrandthreadUI), two StatCards (the file has 0 uses, BrandthreadUI has 19), and two badges (Badge 11 uses vs StatusBadge 33).
- **Raw error text in UI:** 4 places in my slice (ShopProductSheet ×3, ThreadShareSheet ×1).
- **Press feedback:** 22 of 47 component files still use TouchableOpacity, while PressableScale is used in 9 app files. The seller tab bar's 4 tabs have no pressed state at all.
- **Polling:** 2 global 30 s `setInterval` loops (seller orders list, buyer inbox) run while backgrounded, plus per-row 1 s countdown timers.
- **Web inset magic numbers:** ScreenHeader 68, useHeaderTopInset 67, LegalDocument `max(…,67)`, and 19 more `Platform.OS==='web' ? 6x` literals in app screens.
- **iPad:** `supportsTablet:true` with `orientation:"portrait"` and no `ios.requireFullScreen` (app.json:6,18). iPad multitasking needs all orientations or `requireFullScreen:true`. Verify before submission. The seller tab bar and EmptyState CTAs also stretch full width on iPad.
- **Installed but unused:** `react-native-reanimated` (0 uses) and `react-native-keyboard-controller` (not mounted), yet the "KeyboardAware" wrapper is a plain ScrollView.

## Proposed canonical component set

| Pattern | Keep (one) | Retire or merge | Changes required before it is canonical |
|---|---|---|---|
| Button | `PrimaryButton` / `SecondaryButton` (BrandthreadUI) | `TertiaryButton` (0 uses; replace with a `variant="text"` prop), the bespoke TouchableOpacity CTAs in ShopProductSheet, PlanUpsellModal, SellerPlanRecommendationStep, the cash-out button in SellerHomeCommerceDashboard, and the root `_layout` paused screen | Pass `disabled` to PressableScale. Drop the text shadow. Themed disabled state. Add `variant: 'primary' \| 'secondary' \| 'text' \| 'destructive'`. |
| Pressable | `PressableScale` | Raw `TouchableOpacity` in shared components | Use `hitSlop` instead of the forced `minHeight:44`. Skip the animation when disabled. Add an optional `haptic` prop. |
| Header | `ScreenHeader` | `BrandthreadHeader` (21 screens) | Merge the props: `onBack?`, `showBack`, `fallbackHref`, `subtitle`. Title `numberOfLines={1}`. Flexible right slot. `useHeaderTopInset()`. Hairline border. `hapticLight` on back. |
| Section header | BrandthreadUI `SectionHeader` | `components/SectionHeader.tsx` (1 use) | Make it theme-aware. The action link uses a hitSlop without the 44 pt row. |
| Sheet | **New** `BottomSheet` in BrandthreadUI, built from ShopProductSheet's motion (spring in, drag handle, swipe to dismiss) with a separately fading backdrop | The 5 bespoke Modals listed above. `SheetHandle` becomes internal to it. | Props `visible, onClose, title?, snapHeight?`. Themed `surface`. `insets.bottom` padding. The pan gesture lives on the handle and header only. |
| Toast | `UndoToastProvider`, renamed `ToastProvider` and exposing `showToast({message, variant, action?})` | `Toast`, `FeedToastProvider` (EngagementButton.tsx), and success `Alert.alert` | Position above the tab bar and safe area. Native-driver fade and slide. Haptic by variant. `theme.accent` action. |
| Inline error | `InlineError` | `SectionError` (merge in as a `compact` prop) | Themed. 44 pt retry. |
| Empty state | `EmptyState` (full) and `InlineEmpty` (compact) | Bespoke empty states (e.g. `ChartEmptyState` stays as a chart-specific child) | Cap the action width on iPad. Themed InlineEmpty. |
| Skeleton | `LoadingSkeleton` with `SkeletonText`, `FeedSkeleton`, `ProductGridSkeleton` | Dashboard `SkeletonBlock`. Fold `CheckoutSkeleton` and `SearchResultsSkeleton` in as presets or keep them. | Fill at 8% with pulse 0.55↔1, or a shimmer. |
| Loader | `BrandedLoader` (full-screen or section) and `InlineSpinner` (inline) | `BrandedLoadingState`. `BootScreen` stays boot-only. | Opacity-only pulse, themed label. |
| Input | `FormInput` (fields) and `SearchBar` (search) | Bespoke TextInputs in sheets and forms | Themed. 17% border with a focused accent. `error` and `helper` props. Keyboard-controller scroll view. |
| Chip | `FilterChip` | `OptionChip` in ShopProductSheet (make it a `FilterChip` variant) | Active label `accentLight`, not `onAccent` (the P0). |
| Badge | `StatusBadge` | `components/Badge.tsx` (11 uses), `NewFeatureBadge`, and `LockBadge`, all merged in as variants | Use theme status colours. Sentence case. |
| Stat card | BrandthreadUI `StatCard` | `components/StatCard.tsx` (0 uses) | Themed text. |
| List row | `NavigationCard`, renamed `ListRow` | `FeatureCard.tsx` (0 uses), `ProductCard.tsx` (0 uses), bespoke settings rows | Themed. `description` with `numberOfLines={2}`. Optional `destructive`. Hairline dividers for grouped lists. |
| Tab bar | The buyer capsule pattern, extracted to a `components/FloatingTabBar.tsx` shared by buyer and seller | The seller full-width band in `SellerGlobalTabBar`, `AIBrainFAB`, `ProfileTabButton` | 11 pt labels. Min 12 pt bottom margin. `navigate` plus tabPress (scroll-to-top). iPad `maxWidth: 560`. Blur visible or removed. |
| Image | `CachedImage` | RN `Image` (20 app files) | A neutral dark placeholder instead of the demo blurhash. |
