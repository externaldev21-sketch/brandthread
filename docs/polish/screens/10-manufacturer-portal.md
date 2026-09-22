# Manufacturer portal (web)

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**24 P0 · 70 P1 · 38 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Root: `artifacts/manufacturer-portal/`. All paths below are relative to `src/` unless they start with `index.html`.
Build check: `vite build` (output sent to the scratchpad, then deleted; git tree untouched) **succeeds**, but ships **one 2.32 MB JS chunk (656 KB gzip)** that includes the Agora RTC SDK, and has no route code-splitting.

**Brand match verdict:** BG (`240 10% 4%` ≈ #09090B) and FG (`0 0% 98%` ≈ #FAFAFA) are close to mobile (#0A0A0B / #F7F7FA), and Inter is loaded. Everything else is off-brand: the accent is **neon green #00CC66** where mobile is strict grayscale; the palette is stock shadcn **zinc** (hue 240); the radius is 2–4px where mobile uses 10–18px and pills; there's a "terminal" aesthetic (JetBrains Mono in 42 places, "SYS.ONLINE"); the Clerk auth screens use a *third* palette (green-tinted #0d1410); and the moderation and reports pages use raw Tailwind slate, blue or light-mode grays.

---

### Global tokens — `src/index.css`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | Primary, ring, sidebar-primary and chart-1 are all neon green `150 100% 40%` (#00CC66). The mobile brand is monochrome, so every CTA, active nav item, unread badge, checkmark and text selection is green | index.css:88, 92, 96, 107, 108 | Set `--primary: 240 7% 97%` (≈#F7F7FA) and `--primary-foreground: 240 6% 4%`. Point `--ring`/`--sidebar-ring` at the same value, and `--sidebar-primary` likewise. Keep green only as a semantic `--success` token |
| P1 | Visual | `--radius: 0.25rem`, so `rounded-sm` = **0px**, `rounded-md` (Button, Input, Badge) = 2px, `rounded-lg` = 4px. It reads as a boxy admin panel next to the app's 10–18px cards and pill buttons | index.css:66-69, 117 | Set `--radius: 0.875rem` (14px). Then md = 12px and lg = 14px, which matches the mobile RADIUS scale. Make primary CTAs `rounded-full` |
| P1 | Motion | `hover-elevate` / `active-elevate-2` are referenced by Button and Badge but **never defined** here (they exist only in `brandthread-woven/src/index.css`). The Button variants deliberately drop `hover:` classes, so **every shadcn Button has no hover and no pressed state** | components/ui/button.tsx:8 (vars declared but unused at index.css:76-77) | Port the `@utility hover-elevate` / `active-elevate-2` blocks from `artifacts/brandthread-woven/src/index.css`, or add `hover:brightness-110 active:scale-[0.98] transition` to the base cva |
| P1 | Theme | `--app-font-mono: 'JetBrains Mono'` is used for eyebrows, status chips, timestamps, prices and IDs (42 hits in 14 files). Mobile is Inter-only, and the mono gives a "dev console" feel | index.css:1, 116 | Drop JetBrains Mono from the import. Replace `font-mono` with `font-medium tabular-nums` for numbers, and with `text-xs font-medium text-muted-foreground` (sentence case) for eyebrows |
| P2 | Perf | Inter is loaded twice: a CSS `@import` (index.css:1) plus a `<link>` in index.html:18. The CSS `@import` is render-blocking inside the bundle | index.css:1 | Remove the `@import url(...)` line and keep the `<link>` in index.html |
| P2 | Theme | Chart palette (amber, cyan, purple, pink at 100% saturation) clashes with monochrome | index.css:108-112 | Use grayscale steps: `0 0% 98%`, `0 0% 72%`, `0 0% 52%`, `0 0% 36%`, `0 0% 24%` |

### HTML shell — `index.html`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Placeholder meta visible in link previews and search results: "Brandthread Manufacturer Portal — built on Replit. Update this description to reflect the app." (×3) | index.html:7, 10, 14 | "Receive orders, send quotes and get paid — the Brandthread manufacturer portal." |
| P1 | A11y | `maximum-scale=1` blocks pinch-zoom on phones | index.html:5 | `content="width=device-width, initial-scale=1, viewport-fit=cover"` |
| P2 | Visual | `twitter:card summary_large_image`, but there's no `og:image`, so shares show a broken or empty card | index.html:12 | Add `<meta property="og:image" content="/manufacturers/og.png">`, or switch to `summary` |

### App shell and auth — `src/App.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | `<SignIn forceRedirectUrl="/onboard">`: **every returning manufacturer who signs in is dropped into the sign-up wizard** (onboarding has no "already registered" guard) | App.tsx:109 | Change the SignIn redirect to `${basePath}/dashboard`. Keep `/onboard` only for SignUp (App.tsx:122) |
| P0 | Consistency | Only the Radix `<Toaster/>` is mounted, but onboarding, profile and quote-requests call `toast` from **sonner**, so **all their success and error toasts are silently dropped** ("Quote sent to seller", "Profile updated", registration errors…) | App.tsx:6, 272 | Mount `<Toaster />` from `@/components/ui/sonner` next to (or instead of) the Radix one, and move ip-cases onto sonner so there's one toast system |
| P1 | Theme | Clerk appearance uses a green-tinted palette (#0d1410 bg, #6b8f7a muted, #00cc66 CTA, #a0c4b0 labels) that matches neither the portal nor mobile | App.tsx:55-90 | colorBackground `#18181B`, colorInput `#111113`, colorForeground `#F7F7FA`, colorMutedForeground `rgba(247,247,250,0.58)`, colorPrimary `#F7F7FA`, `formButtonPrimary: 'bg-[#F7F7FA] text-[#0A0A0B] rounded-full'`, borderRadius `'0.875rem'` |
| P1 | Motion | The moderator check renders a blank full-screen div (no loader) before the Safety queue appears | App.tsx:142-144 | Render the Layout with a list skeleton, or a centred `<Spinner/>` |
| P1 | Consistency | `/reports` (staff-only content moderation) is wrapped in `Protected` only, not `ModeratorProtected`, so any manufacturer can open it by URL | App.tsx:263-265 | Wrap it in `<ModeratorProtected>`, like `/moderation/ip-cases` |
| P2 | Copy | Clerk subtitle "Join the Brandthread manufacturer network" is fine. Sign-in subtitle: prefer "Sign in to manage orders and quotes." | App.tsx:200 | As quoted |

### Layout and navigation — `src/components/layout.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake status pill "SYS.ONLINE" with a pulsing green dot in the header of every page: dev/debug jargon | layout.tsx:100-103 | Remove it. Put the account menu there instead (see the next row) |
| P0 | Consistency | **No sign-out anywhere in the portal** (no `UserButton` or `signOut` in the codebase) | layout.tsx:71-85, 99-104 | Add Clerk `<UserButton />` to the header's right side and to the sidebar footer |
| P0 | Consistency | **Payouts (`/payment`) is not in any nav**, so manufacturers can't reach Stripe onboarding from the UI. `/reports` isn't either | layout.tsx:24-32 | Add `{ href: "/payment", label: "Payouts", icon: Wallet }` after Completed, and a moderator-only "Reports" item |
| P0 | Visual | Logo `src="/brandthread-logo.png"` is absolute, but the app is served under `BASE_PATH=/manufacturers/`. Vite rewrites index.html but not JSX strings (confirmed in the build), so the logo 404s in production. The file is also **984 KB** for a 32px image | layout.tsx:44, 94 | `src={`${import.meta.env.BASE_URL}logo.svg`}` (a 265 B SVG already exists in public/). Delete the 1 MB PNGs, or compress them to under 20 KB |
| P1 | Visual | The mobile bottom nav shows only `navItems.slice(0, 5)`, so **Profile, Completed, Payouts and Safety queue are unreachable on phones** | layout.tsx:113 | Show 4 items plus a "More" tab that opens a `Sheet` with the rest |
| P1 | Visual | `h-screen` (100vh) root: on iOS Safari the bottom nav sits under the browser toolbar. There's also no `env(safe-area-inset-bottom)` padding | layout.tsx:39, 112 | `h-dvh` on the root, and `pb-[env(safe-area-inset-bottom)]` on the mobile `<nav>` |
| P1 | Visual | Mobile nav labels are 10px, and "Quote Requests" truncates to "Quote Requ…" at 360px | layout.tsx:119, 123 | `text-[11px] font-medium`, and use short labels: "Home", "Inbox", "Quotes", "Sellers", "Orders" |
| P1 | Copy | Title Case nav labels ("Quote Requests", "Active Orders", "Safety Queue") break the sentence-case rule | layout.tsx:25-35 | "Quote requests", "Active orders", "Completed", "Safety queue" |
| P2 | Copy | Sidebar footer fallback "Loading..." (three dots). Also a 10px mono "Menu" label | layout.tsx:51, 81 | Use a 12px skeleton bar instead of text. If text is needed, "Loading…". Remove the "Menu" label |
| P2 | Theme | Active nav item `bg-primary/10 text-primary` is green | layout.tsx:59, 62 | `bg-secondary text-foreground` (it follows from the primary fix) |

### Landing — `src/pages/landing.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The only header action is "Join the Network". There's **no sign-in link for returning manufacturers** | landing.tsx:21-25 | Add a secondary link, "Sign in" → `/sign-in`, left of the CTA. Rename the CTA to "Get started" |
| P1 | Visual | Header `px-8` + logo + "BRANDTHREAD" + "PORTAL" chip + CTA ≈ 445px wide, so it overflows or cramps at 360–430px | landing.tsx:13-26 | `px-4 sm:px-8`. Hide the PORTAL chip below `sm` (`hidden sm:inline`) |
| P1 | Visual | Placeholder "B" letter-box logo in green instead of the brand mark | landing.tsx:15-17 | `<img src={`${import.meta.env.BASE_URL}logo.svg`} className="h-8 w-auto" alt="Brandthread" />` |
| P1 | Copy | Duplicate cards: cards 1 and 3 both say "Get discovered by … vetted brands … production partners" and both use the Globe2 icon | landing.tsx:59-62, 73-76 | Card 3: title "Get paid securely", body "Escrow holds every payment until the buyer approves. No chasing invoices.", icon `ShieldCheck` (already imported, unused) |
| P1 | Copy | "A precise, authoritative command center for vetted garment manufacturers." reads robotic | landing.tsx:40-44 | "Everything your factory needs to work with new brands. Quote, sample, produce and get paid, all in one place." |
| P1 | Copy | Title Case: "Earn New Customers", "Streamlined Ops", "Global Reach", "Join the Network", "Manufacturer Network Open" | landing.tsx:23, 32, 61, 68, 75 | "Meet new brands", "Run production in one place", "Get paid securely", "Get started", "Now accepting manufacturers" |
| P2 | Visual | `text-5xl` hero at 360px breaks "next-generation" across lines at the hyphen | landing.tsx:35 | `text-4xl sm:text-5xl md:text-7xl` and `text-balance` |
| P2 | Theme | Green hero accent and green CTA glow (`shadow-primary/20`) | landing.tsx:37, 49 | Follows from the primary token fix. Drop the coloured shadow |

### Onboarding — `src/pages/onboarding.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Success and error toasts use unmounted sonner, so a failed registration shows **nothing** (the button just re-enables) | onboarding.tsx:15, 77, 81 | Mount the sonner Toaster (see App). Also render an inline error above the footer: "Couldn't create your profile. Check your connection and try again." |
| P1 | Consistency | No guard for already-registered users. Combined with the SignIn redirect, it re-shows the wizard, and submitting may error or duplicate | onboarding.tsx:33-36 | On mount, `useGetMyManufacturerProfile()`. If a profile exists, `setLocation("/dashboard")` |
| P1 | Visual | The step progress rail is `hidden md:block`, so phone users see no "Step 2 of 4" | onboarding.tsx:102 | Add a mobile bar above the form: `<p className="text-xs text-muted-foreground md:hidden">Step {step} of 4</p>` plus a 2px progress bar |
| P1 | Copy | Toasts: "Account created successfully" / "Failed to create account. Please try again." | onboarding.tsx:77, 81 | "You're in. Welcome to Brandthread." / "Couldn't create your profile. Try again." |
| P1 | Copy | Validation copy: "Description is required" fires when it has fewer than 10 chars; "MOQ is required" is jargon | onboarding.tsx:24, 28 | "Tell buyers a little more — at least 10 characters." / "Enter a minimum order of 1 or more." |
| P1 | Copy | Step 3 is a dead step with dev-flavoured copy: "Authenticated uploads only… We never publish client-supplied image links." | onboarding.tsx:309-315 | Remove step 3, or say: title "Add photos later", body "Once you're set up, add factory photos from your Profile." |
| P1 | Copy | Title Case headings and labels: "Business Details", "Business Name", "Location (Country)", "Primary Specialty", "Minimum Order Quantity (MOQ)", "Avg. Price Range Per Unit", "Review & Submit", "Submit Profile" | onboarding.tsx:105-108, 138, 148, 162, 192, 233, 247, 261, 275, 290, 392 | "Business details", "Business name", "Country", "Specialty", "Minimum order (units)", "Price per unit", "Review", "Create profile" |
| P2 | Copy | "Please confirm your information before submitting." / "Submitting..." | onboarding.tsx:324, 392 | "Check everything looks right." / "Creating…" |
| P2 | Visual | Header uses the green "B" placeholder mark + "BRANDTHREAD SETUP" | onboarding.tsx:93-96 | Use the logo SVG + "Set up your factory" |
| P2 | Copy | The country list is hard-limited to 10 countries, with no "Other". Price and turnaround defaults are pre-filled ("$10 - $50", "30-45 days"), so the placeholders never show and users may submit fake values | onboarding.tsx:45-47, 170-179 | Default these to "". Add `<SelectItem value="Other">Other</SelectItem>`. Use the en-dash "10–14 days" |

### Business profile — `src/pages/profile.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The zod schema has **no custom messages**, so users see raw zod text: "String must contain at least 2 character(s)", "Invalid url", "Invalid email", "Expected number, received nan" | profile.tsx:16-30 | Add messages, e.g. `.min(2, "Enter your business name")`, `.url("Enter a full link, like https://yourfactory.com")`, `.email("Enter a valid email")`, `.min(10, "Add at least 10 characters")` |
| P0 | Visual | On mobile, the fixed save bar (`fixed bottom-0 … z-20`, ~80px) **covers the layout's bottom tab bar** | profile.tsx:483 | `bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0`, or make the bar `sticky bottom-0` inside the scroll area |
| P1 | Copy | Raw server `error.message` / `body.error` goes straight into toasts | profile.tsx:97, 119, 124, 146, 150, 172, 176 | Map to "Couldn't save your profile. Try again.", "Couldn't upload that photo. Try again.", "Couldn't reorder photos. Try again.", "Couldn't remove that photo. Try again." |
| P1 | Copy | "Profile updated successfully", "Refresh the profile before saving changes." | profile.tsx:86, 93 | "Profile saved" / "Your profile changed elsewhere. Reload to see the latest." |
| P1 | Consistency | Native `window.confirm("Remove this factory photo from your profile?")` | profile.tsx:159 | shadcn `AlertDialog`: title "Remove photo?", action "Remove", cancel "Keep" |
| P1 | Visual | No error or not-found state: if the profile query fails, an empty form renders and "Save" is disabled with no explanation | profile.tsx:35, 183-190 | Handle `isError` with `<QueryError title="Couldn't load your profile" description="Check your connection and try again." onRetry={refetch}/>` |
| P1 | A11y | Photo reorder and delete buttons are 28px (`h-7 w-7`) and sit on the image. That's too small to tap on a phone | profile.tsx:357, 368, 379 | `h-9 w-9` on mobile (`h-9 w-9 sm:h-7 sm:w-7`) |
| P1 | Copy | Status chip "Status: PENDING" is uppercase mono and green-checked even when not approved | profile.tsx:206-209 | A sentence-case badge: "Under review" / "Live" / "Paused". Show the check icon only when live |
| P1 | Consistency | Section headers are numbered "01. Basic Info", "02. Capabilities", "03. About", but "Factory photos" is unnumbered, and all are green mono uppercase | profile.tsx:218-219, 335, 397, 462 | Drop the numbers: "Basics", "Factory photos", "Capabilities", "About", in `text-sm font-semibold text-foreground` |
| P1 | Consistency | Country and Specialty are free text here but a Select and chips in onboarding, so the data drifts | profile.tsx:242-244, 269-271 | Reuse the same Select and specialty chips as onboarding |
| P2 | Copy | Photo helper copy is confusing: "Files stay protected and are shown on your published manufacturer profile. Move the first photo into the lead position." | profile.tsx:337 | "Add up to 8 photos (JPEG, PNG or WebP, under 5 MB). The first photo is your cover." |
| P2 | Copy | Uploading more than 8 files silently drops the extras | profile.tsx:108 | Toast: "Only 8 photos fit. We added the first {n}." |
| P2 | Copy | Title Case labels: "Business Name", "Location / Country", "Website (Optional)", "Years in Business", "Save Changes", "Saving..." | profile.tsx:228, 242, 283, 296, 490 | "Business name", "Country", "Website (optional)", "Years in business", "Save", "Saving…" |

### Quote requests — `src/pages/quote-requests.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Dev jargon in the primary money flow: "Price is sent as exact cents to the server." | quote-requests.tsx:514 | "Set the price and terms the seller will see." |
| P0 | Copy | Raw seller IDs are shown as the seller name ("From seller user_2x…", list subtitle), plus a "Request ID" UUID block | quote-requests.tsx:412, 437, 458 | Show the seller's store or display name (add it to the API). Remove the Request ID row, or move it to a "Copy reference" menu |
| P0 | Consistency | Every success toast ("Quote sent to seller", "Counteroffer accepted") goes to unmounted sonner, so there's no confirmation after sending a quote | quote-requests.tsx:16, 259 | Mount the sonner Toaster (see App) |
| P1 | Visual | On phones, the list and detail stack. Tapping a request updates the detail **below the whole list**, off-screen, so it looks like nothing happened | quote-requests.tsx:382-396 | Below `lg`, show only the list; on select, show only the detail, with a "Back to requests" button. Or `detailRef.scrollIntoView()` on select |
| P1 | Motion | "Refresh" sets `loading=true`, so the whole page is swapped for a 560px skeleton and back (flash) | quote-requests.tsx:346 | Keep the content visible. Spin the RefreshCw icon (`animate-spin`) while refetching |
| P1 | Consistency | "Decline request" (described as "a final decision") and "Accept counteroffer" fire immediately, with no confirmation | quote-requests.tsx:480, 576 | AlertDialog: "Decline this request?" / "The seller will be notified. This can't be undone." / [Decline] [Cancel] |
| P1 | Copy | Server errors are shown raw ("Quote request action failed" fallback), and the load error text is passed into QueryError | quote-requests.tsx:182, 198, 267, 335 | "Couldn't update this request. Try again." / load: "Couldn't load quote requests. Check your connection and try again." |
| P1 | Copy | An extra "Mark viewed" step gates the form: "Mark it viewed to open the response form." | quote-requests.tsx:501-505 | Auto-mark as viewed when the request opens. If a button stays: "Start quote" |
| P2 | Visual | 10–11px mono uppercase labels (`DetailValue` dt, "Request detail", "Previous notes", date) | quote-requests.tsx:140, 415, 435, 493 | `text-xs font-medium text-muted-foreground`, sentence case |
| P2 | Copy | Placeholders use "...": "Search product or seller ID...", "Add inclusions, assumptions, or next steps..."; the eyebrow "Commercial inbox" | quote-requests.tsx:342, 357, 559 | "Search requests…", "Add what's included, assumptions or next steps…". Drop the eyebrow |
| P2 | Perf | A 30s `setInterval` poll runs even when the tab is hidden | quote-requests.tsx:208-213 | Skip when `document.hidden`, or move it to react-query with `refetchInterval` + `refetchIntervalInBackground:false` |

### Message thread — `src/pages/message-thread.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | `h-[calc(100vh-8rem)]` ignores the mobile bottom nav (~52px) and the p-4 padding, so on phones the composer is pushed ~20px under the tab bar and the page double-scrolls. iOS 100vh makes it worse | message-thread.tsx:103 | `h-[calc(100dvh-8rem)] md:h-[calc(100dvh-8rem)]`, and subtract the nav on mobile: `h-[calc(100dvh-4rem-52px-2rem)]` |
| P1 | Motion | On first open, `scrollIntoView({behavior:"smooth"})` animates from the top through the whole history | message-thread.tsx:29-34 | Use `behavior: "auto"` on first load and `"smooth"` only when a new message arrives |
| P1 | Consistency | Once a file is attached there's no way to remove it (only the text "Attached: name"), and the input isn't reset | message-thread.tsx:197, 208 | Render a chip "{name} ✕" with `onClick={() => setAttachment(null)}`, and reset `event.target.value` |
| P1 | A11y | The paperclip `<label>` has no accessible name | message-thread.tsx:195 | `aria-label="Attach file"` |
| P1 | Copy | Placeholder "Type your reply... (Press Enter to send)". On mobile, Enter should add a new line | message-thread.tsx:185-191 | "Write a reply…". Only send on Enter when `!isMobile` |
| P2 | Copy | "Attachment upload failed. Please try again." | message-thread.tsx:209 | "Couldn't attach that file. Try again." |
| P2 | Visual | `orderStatus.replace('_',' ')` only replaces the first underscore, so "cut and_sew" shows. Mono uppercase chip | message-thread.tsx:126 | `replaceAll("_"," ")`, sentence-case badge |
| P2 | Visual | Timestamps are 10px mono. Day separators use `hour:'2-digit'` ("09:05 AM") | message-thread.tsx:147-148, 168 | `text-[11px]`, `hour:'numeric'` |
| P2 | Motion | No pending state on send: the button just disables, and the message appears after the round-trip | message-thread.tsx:199-206 | Show `<Loader2 className="animate-spin"/>` in the button while `sendMutation.isPending`, or append an optimistic bubble at 60% opacity |

### Inbox — `src/pages/messages.tsx` + `src/components/thread-card.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Inconsistent audience: the subtitle says "brands and buyers", the search says "buyer", the empty state says "seller" | messages.tsx:22, 29, 49 | Use "brands" everywhere: "Talk directly with the brands you make for.", "Search conversations…", "No conversations yet" / "When a brand messages you, it lands here." |
| P2 | Visual | Order-status chip is 10px mono uppercase | thread-card.tsx:40 | `text-[11px] font-medium` sentence case |

### Thread call (voice/video) — `src/components/thread-call.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw vendor/SDK errors are shown to users: "Call SDK error: {message}", "…(403).", "Calling is not configured right now (503). Please try again later." | thread-call.tsx:25, 63-65 | "Couldn't start the call. Try again." / "You can't call in this conversation." / "Calls are unavailable right now. Try again later." |
| P0 | Motion | The local video preview never shows: `camera.play(localVideoRef.current)` runs right after `setMode()`, before React renders the overlay, so the ref is `null`. Remote video has the same race if the remote publishes early | thread-call.tsx:192-194, 173, 245-249 | Play the tracks in a `useEffect(() => { if (mode==="video") cameraRef.current?.play(localVideoRef.current!) }, [mode])`, and keep the remote container always mounted |
| P1 | Visual | The error bubble is absolutely positioned under the header with **no dismiss** and never auto-clears | thread-call.tsx:257 | Use a toast instead (sonner, once it's mounted), or add a ✕ button and a 6s timeout |
| P1 | Visual | On mobile, "Starting voice call…" text is inserted into the header row and squeezes the buyer name. The call state ("Connected", "Waiting…") is hidden below `lg` | thread-call.tsx:236, 239 | Replace the call buttons with a spinner while starting. Show a compact "0:12" timer or dot on all sizes |
| P2 | Copy | "The call lost its secure connection and could not be renewed. Media was closed. Start a new call from this conversation." | thread-call.tsx:110 | "Call dropped. Tap the phone to call again." |
| P2 | Visual | Local preview is 192×144 at `right-8 bottom-24`, which covers a large share of a 360px screen | thread-call.tsx:249 | `h-28 w-20 sm:h-36 sm:w-48 right-4` |

### Payouts — `src/pages/payment.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The page is unreachable: there's no nav item or link anywhere (see Layout) | layout.tsx:24-32 | Add "Payouts" to the nav, and link to it from the Dashboard when `!status.ready` |
| P1 | Copy | Raw Stripe requirement keys are shown: "Stripe still requires: individual.verification.document, external_account" (only `_` is replaced) | payment.tsx:126 | Map the known keys to "ID document", "Bank account", "Business address"… and fall back to "A few more details" |
| P1 | Visual | If loading fails, the page still renders "Connect your payout account" (because status is null) under a red error. That's misleading and there's no retry | payment.tsx:110-123 | On load error, render `<QueryError title="Couldn't load payouts" description="Check your connection and try again." onRetry={load}/>` instead of the card |
| P1 | Copy | Raw server errors, plus the fallback "Request failed" | payment.tsx:46, 60, 79 | "Couldn't open Stripe. Try again." |
| P1 | Visual | Reversals and refunds show the same green "incoming" arrow and a positive amount | payment.tsx:177, 183 | For `payment_reversed`: `ArrowUpRight`, `text-destructive`, and the amount prefixed with "−" |
| P2 | Motion | "Refresh status" has no pending feedback | payment.tsx:105-107 | Add a `refreshing` state and `animate-spin` on the icon |
| P2 | Copy | `toLocaleString()` dates include seconds ("9/22/2026, 3:04:11 PM"). The payout account status is lowercase "not started" | payment.tsx:157, 180 | `Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'})`. Map statuses to "Not started", "Pending", "Action needed", "Active" |

### Content reports (staff) — `src/pages/reports.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Theme | Light-mode colours on the black app: `bg-yellow-100`, `bg-blue-100`, `bg-red-100`, `bg-gray-100` chips, and `bg-red-50`/`bg-gray-50` buttons (white boxes on black) | reports.tsx:9-14, 103-114 | Use `<Badge variant="secondary">` and `<Button size="sm" variant="destructive">` / `variant="outline"` |
| P1 | Perf | The fetch URL is `${BASE_URL}/api/reports` → `/manufacturers/api/reports`, while every other page uses `/api/…`. It likely 404s, and **with no error state it shows "No pending reports."** | reports.tsx:29, 72-73 | Use `/api/reports`, like the other pages. Add `isError`: "Couldn't load reports. Try again." |
| P1 | Consistency | The status mutation never checks `res.ok`, so failures look like success | reports.tsx:40-44 | `if (!res.ok) throw new Error()`. Toast "Couldn't update this report." |
| P1 | Copy | Raw IDs: "{targetType} · {targetId…}", "reporter: user_2abc…". Lowercase status chips. The button is labelled "Action" | reports.tsx:82, 85, 98, 107 | Show the target label and reporter name. Chips: "Pending", "Reviewed"… Button: "Take action" |
| P1 | Visual | The header row (title + 4 chips) doesn't wrap, so it overflows at 360px. `p-6` also double-pads inside the Layout | reports.tsx:50-67 | `flex-col gap-3 sm:flex-row`, `flex-wrap`. Remove `p-6` |
| P2 | Copy | "Content Reports" Title Case. Bare "Loading…" text | reports.tsx:52, 71 | "Content reports". Use row skeletons |

### Orders — `src/pages/orders.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Seller: {sellerId}" shows a raw Clerk/user ID, and the search placeholder asks users to "Search title or seller ID..." | orders.tsx:30, 53 | Show the brand's display name. Placeholder: "Search orders…" |
| P1 | Visual | Price is `${(cents/100).toFixed(2)}`, with no thousands separator ("$12500.00"), while the Dashboard uses Intl | orders.tsx:53 | Use a shared `formatMoney()` (Intl USD) |
| P1 | Copy | "Completed History", "Active Orders" Title Case. A green mono eyebrow "PRODUCTION" | orders.tsx:23-24 | "Completed", "Active orders". Drop the eyebrow |
| P2 | Visual | Type and status chips are 10px mono uppercase, and statuses are raw lowercase ("cut and sew") | orders.tsx:50-51 | Use `<Badge variant="secondary">` with a status label map: "Cutting & sewing", "Packing", "Shipped"… |
| P2 | Copy | Empty state has no action: "Orders will appear here as sellers place them." | orders.tsx:42 | "No active orders" / "When a brand places an order, it shows up here." + [Complete your profile] |

### Order tracker — `src/pages/order-tracker.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The stage rail highlights only the current stage. Completed stages look identical to future ones (all show the same CheckCircle icon), and `payment_received` highlights nothing | order-tracker.tsx:66 | Compute the index. Past stages: `text-foreground` + filled check. Current: ring. Future: `Circle` icon, muted |
| P1 | Visual | The 5 stage boxes stack in one column on phones (`sm:grid-cols-5`), which takes a whole screen | order-tracker.tsx:66 | A horizontal `grid-cols-5` with icon only on mobile and labels from `sm` |
| P1 | Copy | Button "Mark cut and sew" / "Updating..." is lowercase and robotic | order-tracker.tsx:73 | Map to "Start cutting & sewing", "Mark packed", "Mark shipped", "Mark delivered"; pending "Updating…" |
| P1 | Copy | Error: "The update failed or the order changed elsewhere. Latest shared state has been reloaded; review it and try again." | order-tracker.tsx:74 | "Couldn't update this order. We've refreshed it — check the status and try again." |
| P1 | Consistency | "Mark delivered" / "Mark shipped" are irreversible and have no confirmation | order-tracker.tsx:37-49, 73 | AlertDialog "Mark as delivered?" / "The brand will be notified." |
| P2 | Copy | "Seller ID: {id}", status and orderType in raw mono uppercase. The price isn't Intl-formatted | order-tracker.tsx:56, 58, 60 | Brand name, a status label map, `formatMoney()` |
| P2 | Consistency | The back link always goes to "/orders", even when opened from Completed or from a message card | order-tracker.tsx:52 | `history.back()` with a `/orders` fallback. Label "Back" |
| P2 | Copy | Placeholders "Carrier (required)", "Tracking number (required)" have no labels | order-tracker.tsx:72 | Add labels "Carrier" / "Tracking number" and use placeholders like "e.g. DHL" |

### Sellers — `src/pages/sellers.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **Each seller card's title is the raw seller ID** (mono), and search is "Search seller ID..." | sellers.tsx:28, 32 | Show the brand name and avatar (API join). Placeholder "Search brands…" |
| P1 | Copy | "Active Sellers" plus a subtitle count taken from `dashboard.activeSellers`, while the list includes sellers with only completed orders, so the numbers disagree. The empty state says "No active sellers" | sellers.tsx:27, 31 | Title "Brands". Subtitle "{sellers.length} brands you've worked with". Empty: "No brands yet" / "Brands you make orders for will show up here." |
| P2 | Visual | `$x.toFixed(2)` money; the "ORDER VALUE" uppercase label; the "No thread yet" dead end | sellers.tsx:32 | `formatMoney()`, "Order value", and hide the button area instead of "No thread yet" |

### Dashboard — `src/pages/dashboard.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Recent-order meta is raw: "{orderType} · 50 units · cut and sew" (lowercase enum values) | dashboard.tsx:23 | "Sample · 50 units · Cutting & sewing" (shared label map) |
| P1 | Visual | Stat cards are `grid-cols-1` on phones, so there are 4 tall 128px cards before any content | dashboard.tsx:22 | `grid-cols-2 lg:grid-cols-4`, with `p-4` on mobile |
| P1 | Copy | Error: "Unable to load dashboard" / "Your latest workspace metrics could not be retrieved." | dashboard.tsx:10 | "Couldn't load your dashboard" / "Check your connection and try again." |
| P2 | Copy | "Overview" / "Live sample and bulk production metrics." | dashboard.tsx:21 | "Today" / "Your orders, messages and brands at a glance." |
| P2 | Consistency | Header links are hand-styled `<Link>`s, not `Button asChild`, so they have no hover or press state | dashboard.tsx:21 | `<Button asChild variant="outline">` / `<Button asChild>` |

### Safety queue (IP cases, staff) — `src/pages/moderation/ip-cases.tsx` + `src/hooks/use-ip-cases.ts`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw JSON is dumped into the audit log (`JSON.stringify(log.details, null, 2)`), plus "Actor: {actorId}" | ip-cases.tsx:315-322 | Render key/value rows with human labels. Show "By {actor name}" |
| P1 | Theme | The entire page bypasses tokens: 95 `slate-*` and 31 `blue-*` classes, `text-white`, `bg-slate-950`, and a blue accent that exists nowhere else in the brand | ip-cases.tsx:14-19, 78-167, 408-493 | Replace with `bg-card`, `border-border`, `text-foreground`/`text-muted-foreground`. Use `destructive` only for enforcement |
| P1 | Consistency | Raw `<button>`, `<select>` and `<textarea>` instead of shadcn Button, Select and Textarea | ip-cases.tsx:95-137, 144-164, 363-369, 373-392, 425-437 | Use the shared primitives |
| P1 | Visual | The fixed `w-80` list plus the detail pane side by side means the detail is about 8px wide at 360px. The header's 5 action buttons also don't wrap | ip-cases.tsx:79, 93, 422 | Below `md`, show the list OR the detail (like quote-requests). `flex-wrap` on the action row |
| P1 | Motion | After "Start review" or any status change, the case leaves the current filter, the list refetches, and **the detail pane vanishes** to "Select a case…" | ip-cases.tsx:69-72, 405 + use-ip-cases.ts:136-148 | Keep `selectedCase` in local state (or fetch by id), so it stays open after status changes |
| P1 | Copy | "Case updated successfully", "Failed to update case", "Status set to Under Review". `setUnderReview` has no error path | ip-cases.tsx:61, 65, 70-72 | "Case updated", "Couldn't update this case. Try again.", "Marked as in review". Add `onError` |
| P1 | A11y | `focus:outline-none` on list items removes the keyboard focus ring. The 10px `text-slate-600` on slate-950 fails contrast | ip-cases.tsx:320, 461 | `focus-visible:ring-2 focus-visible:ring-ring`, `text-xs text-muted-foreground` |
| P2 | Copy | Title Case and jargon: "Safety Review Queue", "adjudicate", "Info Req", "Enforce Listing Action", "Moderator Notes (Required)", "Confirm Action", "Confirming...", "Loading cases...", "Loading audit log..." | ip-cases.tsx:16, 296, 341, 361, 391, 413, 416, 444 | "Safety queue", "Review intellectual property claims.", "Info requested", "Hide or remove listing", "Notes (required)", "Confirm", "Confirming…", skeleton rows |
| P2 | Copy | The error text "Refresh to try again." has no retry button | ip-cases.tsx:448 | Use `<QueryError … onRetry={refetch}/>` |

### Not found — `src/pages/not-found.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Dev text is shown to users: "Did you forget to add the page to the router?" | not-found.tsx:17 | "This page doesn't exist or has moved." + `<Button asChild><Link href="/">Go home</Link></Button>` |
| P0 | Theme | A white light-mode page (`bg-gray-50`, `text-gray-900`, `text-gray-600`, `text-red-500`) in a dark app. It's a full white flash | not-found.tsx:6, 10, 11, 16 | `bg-background`, `text-foreground`, `text-muted-foreground`, and a neutral icon |
| P1 | Copy | "404 Page Not Found" | not-found.tsx:12 | "Page not found" |

### Shared states — `src/components/query-state.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | `EmptyState` has no `action` prop, so no empty state in the portal can offer a next step | query-state.tsx:35-55 | Add an `action?: React.ReactNode` rendered as `<div className="mt-5">{action}</div>` |
| P2 | Consistency | Callers pass "Unable to load …" titles everywhere (dashboard, inbox, orders, sellers, tracker, thread, quotes) | query-state.tsx:5 (callers) | Standardise on "Couldn't load {thing}" + "Check your connection and try again." |

---

## Clean / low-risk
- `src/lib/order-status.ts`, `src/lib/utils.ts`, `src/main.tsx`: fine.
- `src/hooks/use-mobile.tsx`: stock shadcn, used only by `ui/sidebar.tsx`.
- `src/hooks/use-toast.ts`: stock shadcn (`TOAST_LIMIT=1`). It's fine once one toast system is chosen.
- `src/components/ui/*`: mostly stock new-york shadcn, with Replit edits. Pages *do* use Button, Input, Textarea, Form, Select and Badge. The exceptions are ip-cases (raw elements), reports (raw buttons), and dashboard/landing/sellers (hand-styled `<Link>` buttons).

## Cross-cutting patterns in my slice
- **Two toast systems, one mounted:** 3 pages (onboarding, profile, quote-requests: 19 `toast.*` calls) use sonner, which is never mounted, so they fail silently. Only ip-cases (3 calls) uses the mounted Radix toaster.
- **Off-brand accent:** neon green `--primary` drives every CTA and active state. There's also a separate green Clerk palette (37 hex literals in App.tsx), 95 `slate-*` + 31 `blue-*` classes (ip-cases), and light-mode `gray-*`/`*-50/100` colours in 2 files (reports, not-found).
- **No hover or press feedback on Buttons:** `hover-elevate`/`active-elevate-2` are undefined in this app's CSS, which affects every shadcn Button and Badge.
- **Raw IDs as user-facing names:** seller or user IDs are shown in 6 places (orders, order-tracker, sellers, quote-requests ×3), plus reports (targetId, reporterId) and ip-cases (ownerId, actorId, JSON).
- **Raw server/SDK error text in UI:** 14 places pass `error.message`/`body.error` straight to users (profile 7, quote-requests 3, payment 3, thread-call 1 "Call SDK error").
- **Terminal aesthetic:** `font-mono` 42× in 14 files; 10–11px text 18× in 8 files; uppercase tracking-wide eyebrows ("PRODUCTION", "RELATIONSHIPS", "COMMERCIAL INBOX", "SYS.ONLINE").
- **Mobile gaps:** the bottom nav exposes 5 of 8–9 destinations. There's no sign-out and no Payouts link on any breakpoint. There are 2 `100vh` calc layouts, no `dvh` or safe-area. 2 two-pane pages (quotes, ip-cases) don't collapse on phones. The profile save bar covers the tab bar.
- **Copy hygiene:** 10 three-dot "..." strings instead of "…"; "successfully" ×3; "Please" ×4; Title Case headings and labels on almost every page; "Unable to load" ×7.
- **Destructive actions with no confirm:** decline request, accept counteroffer, mark shipped/delivered, report "Action"/"Dismiss". The only confirm is a native `window.confirm` (profile photo).
- **Perf:** a single 2.32 MB (656 KB gzip) JS bundle including Agora for every visitor. The sidebar logo is a 984 KB PNG, referenced by a base-path-breaking absolute URL. There are 7 polling intervals (10–30s), and the quote-requests `setInterval` ignores tab visibility.
