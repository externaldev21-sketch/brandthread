# Seller: design studio

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**26 P0 · 50 P1 · 15 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Scope: `app/design*.tsx` (17 files), `app/bg-removal.tsx`, `app/tech-pack-generator.tsx`, `components/DesignLayerCompositor.tsx`, `components/TextOverlayEditor.tsx`.
All line numbers were checked against the working tree on `claude/polish-audit`.

Headline: I found no vendor or model names in any UI string. The only "OpenAI" is a code comment (`design-bg-removal.tsx:6`). The real problem is **fake success**. Across the AI result screens, about 25 buttons show an `Alert` that *claims* something happened ("Saved", "Export complete!") but do nothing. Two full screens (Export, Mockup preview) are mocks that are reachable from the canvas. The canvas also has real gesture-performance problems.

**Reachability note:** `design-export`, `design-versions`, `design-project`, `design-prompt-edit` and `design-upload-sketch` are registered in `_layout.tsx` (lines 928–942), but no screen navigates to them. Their P0s become live the moment anyone links them, so either delete the routes or fix them before linking.

---

### Design canvas — `app/design-canvas.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The tool row is a plain `View` holding 7 labelled chips, a divider and a colour swatch (about 600pt wide), with no scroll or wrap. On a 393pt iPhone, **Adjust, Layers and the colour swatch are pushed off-screen** and can't be reached. | 2722–2809, styles 5143–5152 | Wrap the row in `<ScrollView horizontal>`, or on compact widths show icon-only chips (44×44) with labels as `accessibilityLabel`. |
| P0 | Consistency | In **Select** mode the four resize handles and the rotate handle are drawn (3006–3035) and have Pressables (3222–3240), but they do nothing. `transformPanResponder` (981) is never attached to any view; the canvas only spreads `selectionPanResponder` for `select` (2853–2858). The user sees handles that can't be dragged. | 981–1075, 2853–2858, 3222–3240 | Attach `transformPanResponder` while a layer is selected in Select mode, or stop drawing handles there and send users to Transform. |
| P0 | Copy | A "coming soon" stub ships in the Export sheet: "Time-lapse" with the sub-line "Not available — requires native video generation". The Wrench sheet also has a whole **Video** tab ("…being built separately and is not yet available in this release. Check back for updates." plus a disabled "Coming soon" button). | 4082–4087, 4834–4848, tab 4498 | Remove the Time-lapse row and the Video tab from `WRENCH_TABS` until the feature exists. |
| P0 | Copy | Raw `err.message` is shown in alerts (export dimension or verification errors, file import, image import, share). | 1836, 1883, 2005, 2007, 2060, 2062, 2318, 2320, 2379, 2381 | Export: "Couldn't save your design. Try again." Share: "Couldn't open sharing. Try again." Import: "That file couldn't be opened. Try a PNG, JPG or Brandthread file." Log the real message instead. |
| P1 | Perf | **Every brush move event** calls `setCurrentPath` and `setBrushCursorPos` (873–890). Each one re-renders the entire ~4,250-line component, and with it every layer twice: the on-screen compositor (2920) and the hidden export `<Svg>` (3178, always mounted at opacity 0). The path is also rebuilt with `join(' ')` over all points on each event, which is O(n²). Everything runs on the JS thread (RN `PanResponder`, no gesture-handler or Reanimated). | 855–946, 2918–2945, 3165–3181 | Move the live stroke into its own memoized `<LiveStroke>` child that owns the points in a ref, or use Skia/Reanimated. Wrap the per-layer render in `React.memo` keyed on layer identity. Mount the export SVG only while `exporting` is true. |
| P1 | Perf | Transform drags call `setLayers(prev => prev.map…)` on every move event (1008, 1248), which re-renders the whole screen and all layers at touch rate. | 1008–1066, 1239–1300 | Hold the in-flight transform in a ref or `Animated.ValueXY` applied to the selected layer's `<G>`, and commit to `layers` once on release. |
| P1 | Perf | While a selection exists, the marching ants run `setInterval(…, 80)` (713), which re-renders the whole screen 12.5 times a second, even when idle. The onion skin runs `JSON.parse` on the previous frame inside render (2950–2960). | 711–721, 2950–2960 | Animate `strokeDashoffset` in an isolated component, and memoize the parsed onion frame with `useMemo([animFrames, animCurrentFrame])`. |
| P1 | Perf | `pushUndo` runs `JSON.stringify`s over the whole document (every stroke path) on each commit (281–283), and it runs *inside* a `setLayers` updater (743–746). Inline text editing calls `mutateLayer` on **every keystroke** (3206–3212). That serialises the document per character and fills the 50-step undo stack with single letters. | 281–283, 743–749, 3206–3212 | Push undo once when editing starts (on focus), and commit text on blur. Move `pushUndo` out of the updater. |
| P1 | Motion | **Transforms can't be undone.** The move, resize, rotate, distort and warp grants never call `pushUndo` (1222–1237, 994–1006). Undo skips straight past the user's last drag. | 1222–1237 | Call `pushUndo(layersRef.current)` in `onPanResponderGrant` of both transform responders. |
| P1 | A11y | Canvas controls fall below 44pt. Handle hit area `HS = 22`: the comment says "44pt finger usability", but the value is 22 (188). The overlay grid, guides and info buttons are 28×28 with 12pt icons (5174, 3245–3259). Top-bar buttons are 36×36 (5137). `animBtn` is 28 (5344). Selection-bar icons are 12pt (3402–3440). | 188, 5137, 5174, 5344 | Set `HS = 44`, `topBtn` 44×44, `overlayBtn` 36 with `hitSlop` 4, and icons at 16pt minimum. |
| P1 | Visual | All 12 bottom sheets use `styles.sheet` with `paddingBottom: SP.lg` and **no `insets.bottom`**, so the last row sits under the home indicator. There's no `maxWidth`, so on iPad the sheet runs edge to edge and its dimmer covers the whole canvas (you can't draw with Layers or Color open). The sheet `View` sits inside the overlay `TouchableOpacity`, so **tapping any empty part of a sheet dismisses it**. | 5209–5216, 3796–3800 (same pattern at every `<Modal>` 3563–4293) | Use `paddingBottom: insets.bottom + SP.md` and `maxWidth: 560, alignSelf: 'center'`. On iPad, dock Layers and Color as a side panel with no dimmer. Wrap the sheet in a `Pressable` with `onPress={() => {}}`, or use the shared sheet. |
| P1 | Motion | The undo and redo disabled states read `undoStack.current.length` (a ref), so the dimming goes stale until some unrelated state changes. The buttons have no `disabled` prop. | 2697–2710 | Mirror the stack sizes in state (`canUndo`/`canRedo`), set `disabled`, and add `accessibilityLabel="Undo"` / `"Redo"`. |
| P1 | Consistency | Export feedback is inverted. A successful save to Photos **immediately opens the share sheet** (2303–2307), and the "Saved to Camera Roll" confirmation appears only when sharing is unavailable (2308–2311). The progress indicator is 11pt "Capturing…" text in the sheet header (4045). | 2290–2325, 4043–4047 | After a save, show the toast "Saved to Photos" with a haptic. Keep Share as its own row. Show a progress state on the tapped row ("Saving…") instead. |
| P1 | Theme | Every surface, border and text colour comes from static `lib/theme` (BG, SURFACE, CARD, CARD_ELEVATED, BORDER, FG, MUTED; imports 52–60, styles 5126–5387). Only accents follow the runtime theme. | 52–60, 5122+ | Move `styles` into `createStyles(theme)` wrapped in `useMemo`. |
| P2 | Copy | Copy is Title Case, clipped or jargon: "Share Image", "Mockup Preview", "Clear Crop", "Prefs" (4499), "Histogram unavailable (raster layer)" (4345), 'Rejected' (1850), 'Picker error' (1783), 'Merge' / "Need at least 2 drawing layers." (1441), "PNG — Lossless · … · saves to Camera Roll" (4059). | as listed | "Share image", "Preview on garment", "Clear crop", "Settings", "Histogram not available for photos", "Can't use this file", "Couldn't open files", "Add another drawing layer to merge", "Full quality · 1080 × 1080". |
| P2 | Consistency | The gear icon (`settings`) opens the "wrench" actions sheet (2677–2682). Save uses a floppy icon. Icon sizes mix 12, 14, `ICON.xs`=14 and `ICON.sm`=16 within the same bars. `ActionCell` is declared inside `WrenchActionsSheet` (4518), so it remounts on every render. The loading state is bare "Loading…" text (2636). | 2677, 4518, 2636 | Use `more-horizontal` for actions, one icon size per bar (16), hoist `ActionCell`, and use `BrandedLoader`. |

### Design Studio gallery — `app/design.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | Every grid cell renders a full `DesignLayerCompositor` SVG (every stroke path of every layer) at `CELL_SIZE`. `GridItem` isn't memoized and `renderItem` is an inline closure. Toggling one selection re-renders every thumbnail SVG. | 1121–1160, 1562–1571 | Store a PNG thumbnail on save and render it with `expo-image`. Until then, wrap `GridItem` in `React.memo` and pass a stable `onPress(id)`. |
| P1 | Theme | The screen never calls `useAppTheme` or `useColors`. It is all static tokens plus `RECOVERY_ACCENT = '#0A84FF'` (iOS blue) for Cancel and the success circle. | 38–44, 66, 313, 405 | Use `theme.accent`, and drop the blue. |
| P1 | Copy | Title Case throughout: "Recover Projects", "Not Now", "Recovery Complete", "Recovery Failed", "Create Canvas", "Delete Forever", "Cloud Master" (jargon). Error alerts are titled "Error". | 205, 216, 236, 258, 708, 1028, 966, 484/499/523/861/1021/1372 | "Recover designs", "Not now", "Designs recovered", "Couldn't recover designs", "Create canvas", "Delete forever", "Full-quality file". Titles: "Couldn't create canvas" and similar. |
| P1 | Copy | The recovery error shows raw `e.message` (140, rendered at 260). Image import shows raw `e.message` or `String(e)` (1358, 1392). | 140, 1358, 1392 | "Couldn't recover your designs. Nothing was changed." / "Couldn't import that photo. Try another." |
| P1 | Visual | The back button is a text glyph "←" at 28pt (1446, 1642–1647), not the Feather `chevron-left` used on every other screen. The header text actions "Select", "Import" and "Photo" have only 4pt vertical padding (1666–1671). "Import" and "Photo" both import images. | 1446, 1466–1488 | Use `<Feather name="chevron-left" size={ICON.md}>`. Merge Import and Photo into one "Import" action sheet. |
| P2 | Consistency | "Import from Clipboard" opens the New Canvas sheet on the **Size** tab, not Clipboard (1408, 434). | 1408 | Pass `initialTab="clipboard"`. |
| P2 | Visual | Thumbnails are square compositors (`displaySize=CELL_SIZE`) inside a 1.4× tall frame (78–81, 1142–1147), leaving an empty CARD band under each design. Grid size comes from module-load `Dimensions`, so it's wrong after an iPad rotation. | 75–81 | Use `useWindowDimensions()`, and fit the compositor to `CELL_SIZE × THUMB_H`. |

### AI photoshoot — `app/design-ai-photoshoot.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Motion | **Fake progress.** A mock interval counts "Generating 1/4… 4/4 images…" in 3 seconds total (`3000 / count` ms), then sits at "4/4" while the real N parallel requests take far longer. | 170–178, 319 | Show indeterminate branded progress: "Shooting your photos…" / "This usually takes under a minute." Count up only when each request resolves. |
| P0 | Consistency | Four result actions are dead alerts that describe a feature instead of doing it: "Add to Product", "Seller post", "Store Builder", "Campaign". | 286–289 | Wire each one (`router.push('/add-product?…')` and so on) or remove it. |
| P0 | Visual | The results meta line renders `{results.modelStyle} · {results.sceneStyle}`, but `makeResult` never sets them, so users see "4 photos ·  · ". | 242 | Use the local `modelStyle` and `sceneStyle` labels: "4 photos · Female model · Studio". |
| P1 | Copy | Raw `error?.message` in the failure alert. Server strings contain jargon ("Reference image at index 0…", "base64-encoded"). | 194 | "Couldn't finish your photoshoot. Try again." |
| P1 | Motion | "Retry" on the results screen calls `handleGenerate`, but the loading overlay exists only in the wizard branch (315), so a retry shows **no waiting state**. There's no cancel anywhere. | 285, 315–323 | Render the overlay in both branches and add a "Cancel" text button that aborts. |
| P1 | Copy | The disclaimer says "refine your prompt", but this flow has no prompt. Placeholder gradients labelled "Photo 1" appear for non-`data:` URIs (254–265). | 304, 254–265 | "Made with AI. Results can vary. Tap Retry for another take." Render real URIs with `expo-image`. |
| P1 | Perf | The product picker renders the full catalogue with `ScrollView` + `.map` and filters inline on every keystroke. Products with no photo are selectable, and the error only appears at generate time. | 353–386 | Use a `FlatList` and `useMemo` for the filter. Disable rows with no photo: "Add a photo to this product first". |
| P2 | Theme | Hardcoded `#fff` on the accent (269, 449, 974) and an overlay of `rgba(7,7,15,0.92)` (979). `StepBar` is a component declared inside render (215). | as listed | Use `theme.onAccent` and `OVERLAY`, and hoist `StepBar`. |

### Remove background — `app/design-bg-removal.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | Vague or tech failure copy: "Something went wrong. Please try again.", "The service is temporarily unavailable…", "The server returned an empty result…", fallback `'Unknown error'`. | 246, 253, 271, 300 | "Couldn't remove the background. Try again." / "Background removal is busy. Try again in a minute." |
| P1 | Consistency | Nine alerts are titled "Error" (376–491), and success uses `Alert` ("Saved", 358, 374). | 358–491 | Use a toast for success. Failure titles: "Couldn't save to Brand Assets" and similar. |
| P1 | Copy | A dev banner renders whenever `BASE_URL` is empty, without `__DEV__` gating: "[DEV] EXPO_PUBLIC_API_BASE_URL is not set — API calls will fail." | 706–713 | Wrap it in `__DEV__ &&`. |
| P1 | Visual | The screen has its own header with `arrow-left` in a 36pt bordered box (524, 812), where other screens use `chevron-left`. Labels are all-caps ("ORIGINAL", "CUTOUT", "USE THIS CUTOUT", 577/585/659). The processing text is 11pt (840). "PNG, JPG, JPEG, HEIC" repeats JPG. | 520–530, 559, 577, 585, 659, 840 | Use `BrandthreadHeader`, sentence case ("Original", "Cutout", "Use this cutout"), and "PNG, JPG or HEIC · up to 8 MB". |
| P2 | Copy | "Process another image", and the header "Remove Background" (Title Case). | 527, 678 | "Remove another" / "Remove background". |

### Background removal (legacy) — `app/bg-removal.tsx` (linked from `ai-studio.tsx:202`)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | The loading "dots" are three static 8pt views at 0.6 opacity with no animation (129–133, 204–206), so they look frozen. There's no cancel. | 127–134 | Use `BrandedLoader` with the copy "Removing background…" and add "Cancel". |
| P1 | Visual | The "checkerboard" is a flat sage `#CBD5C0` (202), so transparency is invisible and off-brand. | 202 | Render a real checker pattern (shared with design-bg-removal). |
| P1 | Consistency | This duplicates `design-bg-removal.tsx` with a different title ("Background Removal" vs "Remove Background"), a different flow, and no cancel or recent list. It uses RN `Image`. | whole file | Point `ai-studio` at `/design-bg-removal` and delete this route. |
| P2 | Copy | "Something went wrong" alert (62), "Please" padding (33, 75), 11pt uppercase labels (198). | 33, 62, 75, 198 | "Couldn't remove the background. Try another photo." |

### Replace background — `app/design-bg-replace.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The result actions are fake. "Save" shows "Saved / Result saved." and saves nothing (283). "Export" shows "Exporting result image." and exports nothing (286). "Add to product" is a no-op alert (285). | 283–286 | Wire them to `saveImageToMediaLibrary` and the product picker (both exist in design-bg-removal), or remove them. |
| P0 | Visual | The source preview never shows the photo. It shows a gradient with "Source image loaded — tap to change" (155–158). | 153–159 | Render `<Image source={{uri: imageUri}}>` with a small "Change" chip. |
| P1 | Consistency | The Custom gradient From/To inputs are ignored. `handleGenerate` always uses the preset (109). Custom hex isn't validated (200). | 109, 200, 224–231 | Use the custom values when edited, and validate `/^#?[0-9A-F]{6}$/i`. |
| P1 | Motion | The generate overlay has no cancel. The Generate card has no disabled state (so a double tap fires twice). The result renders below the fold with no scroll to it. | 262–268, 292–304 | Disable while generating, add "Cancel", and `scrollToEnd` when the result arrives. |
| P1 | Copy | The alert "Error / Generation failed. Please try again." and the overlay line "AI is compositing your image" (robotic). | 127, 300 | "Couldn't replace the background. Try again." / "Placing your product in the new scene…" |
| P2 | Theme | 34 hex literals (swatch checks `'#000'/'#FFF'`, gradients). | 40–51, 196, 218 | Fine for swatches; derive the check colour from luminance. |

### Create ad — `app/design-campaign.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The success screen shows dev copy: "Activation was verified server-side — not from the browser redirect alone." and "Ad activated!" | 1029–1032 | "Your ad is live" / "Payment confirmed. We'll start showing it right away." |
| P1 | Motion | The budget and duration `SnapSlider` rebuilds its `PanResponder` on every value change (`useMemo` deps include `value`, 130–145) and adds cumulative `g.dx` to the *already updated* value, so the thumb accelerates and jumps mid-drag. This is the money slider. | 130–145 | Capture the start value in `onPanResponderGrant` (a ref) and compute from `start + dx`. Don't depend on `value`. |
| P1 | Theme | No `useAppTheme` at all. The primary button is static `PURPLE_LIGHT` with text `#0A0A0B` (1164–1165), and the spinner is `#000` (1107). | 1107, 1164–1165 | Use `theme.accent` and `theme.onAccent`. |
| P1 | Copy | "Step 1 of 5 — Media" (1085) is duplicated by `StepDots` on every step (696, 777…). "Something went wrong" (1053). Validation uses `Alert` titled "Incomplete" with joined messages (554–609). | 1053, 1085, 554–609 | Keep the dots and drop the text line. "Couldn't start your ad". Show inline field errors instead of alerts. |
| P2 | Consistency | A bespoke header uses `arrow-left` and `x` (679–686). The media spec reads "MP4, MOV · max 500 MB · max 60 seconds". | 679–686, 730 | Use `BrandthreadHeader`. "MP4 or MOV · up to 60s · 500 MB". |

### Mockup to model — `app/design-mockup-to-model.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The Save icon on each result shows "Saved / Image saved to your library." and saves nothing. | 490 | Call `saveImageToMediaLibrary(slot.imageUri)` and show the toast "Saved to Photos". |
| P1 | Copy | Server errors are shown verbatim in each failed card and the batch fallback, e.g. "Reference image at index 0 must be a base64-encoded image." (0-based index, jargon). | 171, 202, 450–452 | "Couldn't create this look. Tap Retry." |
| P1 | Motion | "Go back" while generating resets the UI but doesn't abort the requests, so they resolve into cleared state. The card actions are 34×34 icon-only with no labels (804–806). | 224–228, 804 | Use `AbortController`, and 44pt buttons with the labels "Save" and "Redo". |
| P2 | Copy | "Reference 1 · Failed" and "Select 1–5 images · multi-select supported". | 385, 473 | "Look 1 · Didn't work" / "Pick up to 5 photos". |

### Text to design — `app/design-text-to-design.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The false promise "This takes ~3 seconds" appears while N parallel image generations run (usually 15–60s). | 226 | "Usually under a minute." |
| P0 | Consistency | Dead actions. "Try in Garment" shows an alert about a "3D renderer" that doesn't exist, and "Add to Product" is an explanatory alert. | 179, 182 | Push to `/design-garment?…` and the product picker, or remove them. |
| P1 | Copy | "Try again" **clears the prompt** (201) instead of regenerating. The style badge shows the raw enum (164). The error is "Generation failed / Please try again." (104). | 104, 164, 201 | Make "Try again" call `handleGenerate`. Use a style label map. "Couldn't create designs. Try again." |
| P1 | A11y | The four result actions are 36×36 icon-only buttons with no `accessibilityLabel` (168–193, 598–600). | 168–193 | Use 44pt buttons with labels ("Save", "Try on", "Add to product", "Download"). |

### Upload sketch — `app/design-upload-sketch.tsx` (orphaned route)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Every result action is a bare alert with no effect: `Alert.alert('Saved to project')`, `'Add to garment'`, `'Create product'`, `'Export'`, `'All saved'`. | 148–157, 169 | Wire them up or remove them. |
| P0 | Copy | "Processing sketch" is a scripted 3.2s animation ("Cleaning background…", "Increasing contrast…", "Vectorizing…") that does nothing (34–38, 75–96). The "Crop" and "Increase contrast" toggles are never used (54–55, 305–316). | 34–38, 75–96, 305–316 | Remove the fake step and the unused toggles. Go straight to style selection. |
| P1 | Motion | The progress width animates with `useNativeDriver: false` (82). The `setTimeout`s aren't cleared on unmount (86–96). The processing header has no back button (183). | 82, 86–96, 183 | Remove (see above). |

### Edit with prompt — `app/design-prompt-edit.tsx` (orphaned route)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | "Recent projects" lists **hardcoded fake projects** ("Summer Drop Hoodie"…), which set `mock://` URIs that then fail with "Upload the real image…". | 35–40, 67–77 | Load the real projects via `getProjects()`, or remove the button. |
| P0 | Consistency | Fake saves: "Save result" → "Result saved to your gallery.", "Save to Brand Assets" → "Added to Brand Assets.", "Add to product" → alert. | 202–205 | Wire them up or remove them. |
| P1 | Copy | "JPG, PNG, WEBP up to 20MB" (the server limit is 8 MB). "Compare Before/After". The error is titled "Error". | 128, 196, 100 | "JPG, PNG or WEBP · up to 8 MB", "Compare", "Couldn't apply your edit. Try again." |

### Export — `app/design-export.tsx` (orphaned route)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | The whole screen is a mock. It always calls `exportProject(id, 'png')`, which is an 800ms `delay` returning `mock://export/…` (`services/designService.ts:1242–1256`), then claims "Export complete! File saved to your device." The format and size pickers are ignored. The preview is a gradient with the name, not the design. | 79–92, 126–137 | Delete this route. The canvas Export sheet is the real path. |

### Mockup preview — `app/design-mockup-preview.tsx` (linked from the canvas Export sheet, `design-canvas.tsx:4080`)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | "Export mockup" uses the mock `exportProject` and then says "Success / Mockup exported successfully!" | 66–78 | Capture the preview view (`react-native-view-shot`) and save it, or remove the button. |
| P0 | Visual | The "mockup" never shows the user's design. It draws a plain garment path with the project name as text (104–160, 191–203). The Shadow style (57, 229–238) and view tabs change nothing but a label. | 104–203 | Composite `DesignLayerCompositor` onto the garment print zone, or hide this entry in the canvas. |
| P0 | Copy | Dev stub: the custom background "+" shows "Enter a hex color in the next version. Using current color for now." | 101–103 | Remove the "+" swatch. |
| P2 | Copy | The raw garment enum shows lowercase ("tshirt · Front", 201). "Shadow Style" is Title Case. | 201, 226 | Use a label map, and "Shadow". |

### Templates — `app/design-templates.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Social, Product and Packaging templates push `/design-canvas?preset=…`, but the canvas reads only `id` (`design-canvas.tsx:245`). **Every template opens a blank default "Untitled Artwork"**, so "Instagram Story 1080 × 1920" isn't honoured. | 90–92 | Create the project with the preset dimensions first (`createProject('canvas', name, {width, height})`), then push `?id=`. |
| P0 | Visual | Thumbnails print the raw subcategory uppercased, including underscores: "PRODUCT_CARD", "EMAIL", "TSHIRT". | 160 | Remove the label (the name is right below), or map it to "Product card". |
| P1 | Theme | Rainbow gradient thumbnails (orange, pink, green) on a monochrome brand, plus 38 hex literals. | 39–62 | Use `theme.glowGradient`, or real template previews. |
| P1 | Copy | The no-results empty state says "Choose a starting point for your next design." "Clear Search" and "Use Template" are Title Case. "4 views" reads like a view count. | 128–130, 168, 174 | "No templates match "{search}"" / "Clear search" / "Use template" / "Front + back · 4 angles". |

### Garment design — `app/design-garment.tsx` (reached from Templates)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Dead end from Templates: no `projectId` is passed, so "Save Placement" alerts "No project / Create a project first." (99) and "Open Editor" opens `design-canvas?id=` (empty), which creates a new untitled project (126). | 97–101, 126 | Create the project on entry from a template and pass `projectId`. |
| P1 | Copy | The save says "Placement saved to project." but writes only type and colour. The selected zone and overlays are never saved (102–106). | 102–110 | Save `placementZone`, or change the copy to "Garment saved". Use a toast, not `Alert`. |
| P2 | Copy | Title Case section labels ("Garment Type", "Placement Zone", "Print-Safe Area", "Save Placement", "Open Editor"). There are 29 hex literals, and dark garments are detected from a hardcoded hex list (114). | 130–269, 114 | Use sentence case, and a luminance helper. |

### Brand assets — `app/design-brand-assets.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | "Add to Project" pushes `design-canvas?id=…&addAssetId=…`, but the canvas ignores `addAssetId` (`design-canvas.tsx:245`), so the asset is never added. | 148 | Handle `addAssetId` in the canvas load, or remove the action. |
| P1 | Consistency | `Alert.prompt` (iOS only) drives Brand Color, Font and Rename (92, 103, 128), so they're broken on Android. The hex isn't validated. | 92–110, 128 | Use the shared `FormInput` sheet. |
| P1 | Motion | Tapping a card does nothing. All actions sit behind an undiscoverable long-press (188–192). "Download" actually opens the Share sheet with the text name (155–162). | 188–192, 155 | Tap opens a detail sheet. Rename the action to "Share". |

### Version history — `app/design-versions.tsx` (orphaned route)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Consistency | "Preview" is a stub alert: "Version preview — open editor to compare versions side by side." Errors are titled "Error / Failed to…". | 56, 75, 92 | Show a `DesignLayerCompositor` preview sheet. "Couldn't restore this version." |

### Tech pack generator — `app/tech-pack-generator.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | On failure, the result step shows "Something went wrong", and the only action is **"Start a new tech pack", which wipes all four steps of input** (485, 515–517, `startOver` 231–247). There's no retry and no back. | 485, 506–518 | Add "Try again" (calls `generate`) and "Edit details" (`setStep('details')`). Title: "Couldn't build your tech pack". |
| P1 | Motion | The loading dots are static (491, 612), so they look frozen during a long PDF build. There's no cancel. | 486–493 | Use `BrandedLoader` with the copy "Building your tech pack…" / "About 30 seconds". |
| P1 | Copy | "Send to manufacturer" just opens the system share sheet (512, 225). "Product name*" uses an asterisk. "Something went wrong" alert (210). | 210, 279, 512 | "Share PDF", "Product name" with a "Required" hint, "Couldn't build your tech pack. Try again." |
| P2 | Visual | Hardcoded `fontSize: 12` (429). RN `Image` for photo thumbnails (329). | 329, 429 | Use `FS.sm` and `expo-image`. |

### New project wizard — `app/design-project.tsx` (orphaned route)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P2 | Consistency | Unreachable duplicate of the gallery's New Canvas sheet (the `createProject` flow). | whole file | Delete the route. |

### Text overlay editor — `components/TextOverlayEditor.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | The overlay drag calls `Animated.event([...], { useNativeDriver: false })(_, gs)` **inside** `onPanResponderMove`, which allocates a new event handler on every move on the JS thread. | 401–404 | Create the handler once (`const onMove = Animated.event(...)`), or move to gesture-handler with Reanimated. |
| P1 | Perf | `createEditorStyles(theme)` (a full `StyleSheet.create`) runs in every `ColorSwatch` render, 16 times per editor render. | 76, 108 | Build it once in the parent with `useMemo` and pass it down. |
| P1 | Copy | Seven "fonts" (Elegance, Retro, Vintage, Postcard, Script, Technic) differ only by bold or italic in Inter, so users see near-identical text. | 43–51, 320–325 | Map each one to a real font family, or cut the list to 3 honest options ("Bold", "Italic", "Regular"). |
| P2 | A11y | 28pt swatches (580–581). The a11y label reads "Color #ff3333". There's no Cancel in the top bar (an empty 60pt spacer, 206). | 87, 206, 580 | 36pt swatches with `hitSlop`, a colour-name map, and a "Cancel" button on the left. |

### Layer compositor — `components/DesignLayerCompositor.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Perf | The component isn't memoized, re-sorts layers on each render (297), and renders every path at full logical detail even at a 52pt thumbnail. It's used for every gallery cell and every Recently Deleted row. | 286–321 | `export default React.memo(DesignLayerCompositor, (a,b) => a.project.updatedAt === b.project.updatedAt && a.displaySize === b.displaySize)`, plus `useMemo` for `sorted`. Long-term, use a cached PNG thumbnail. |

---

## Clean / low-risk
- No vendor or model names ("Nano Banana", "Gemini", "OpenAI", "Replicate", "fal") appear in any user-facing string in this slice. The only mention is the code comment at `design-bg-removal.tsx:6`.
- `design-bg-removal.tsx` has the best AI waiting UX in the slice (a real `AbortController` cancel, retryable error states, and a before/after view). Use it as the pattern for the others.

## Cross-cutting patterns in my slice
- **Fake success or dead actions: about 29 handlers** show an `Alert` claiming work happened ("Saved", "Export complete!", "Mockup exported successfully!") or describing a feature, with no effect: bg-replace 3, prompt-edit 4, upload-sketch 5, photoshoot 4, text-to-design 2, mockup-to-model 1, mockup-preview 2, export 1, versions 1, brand-assets 1 (addAssetId), templates 1, garment 1, canvas time-lapse and video 2. This is the single biggest launch risk.
- **No AI generation flow except bg-removal has cancel.** Photoshoot, bg-replace, prompt-edit, text-to-design, upload-sketch, mockup-to-model and tech-pack all block with an overlay or spinner. Two lie about duration or progress (photoshoot's 3-second counter; "This takes ~3 seconds").
- **Generic failure copy:** 21 alerts titled "Error" and 4 "Something went wrong", plus 13 places that surface raw `e.message` or `String(e)` (canvas 10, gallery 3). Server strings passed through include "at index 0" and "base64-encoded".
- **Alert as UI:** 188 `Alert.alert` calls in the slice (canvas 43, campaign 22, bg-removal 21, photoshoot 14, text-to-design 13…). This covers success toasts, pickers (Brand Assets chains 3 alerts deep) and validation.
- **Runtime theme ignored:** 2 screens never read the theme (`design.tsx`, `design-campaign.tsx`). 15 others import static BG/CARD/SURFACE/BORDER/FG into `createStyles`, so only accents change. There are about 260 hex literals in the slice (templates 38, bg-replace 34, TextOverlayEditor 34, garment 29).
- **Perf:** 0 files use Reanimated or gesture-handler. The canvas runs 6 `PanResponder`s on the JS thread, each calling `setState` per move event on a 75-`useState` component. `createStyles(theme)` is rebuilt on every render in 15 files (none use `useMemo`). There are 9 `Dimensions.get` values captured at module load (wrong after iPad rotation or Split View).
- **Touch targets under 44pt:** canvas handles 22, overlay 28, top bar 36, layer action about 28, mockup-to-model 34, text-to-design 36, bg-removal back 36, templates back 36. Icons are 12pt in canvas bars.
- **Header drift:** 4 header styles in one feature: `BrandthreadHeader` (6 files), `ScreenHeader` (2), bespoke `arrow-left` boxes (6), and a text-glyph "←" (gallery). Back icons mix `arrow-left` and `chevron-left`.
- **Case drift:** Title Case buttons and labels in at least 9 files ("Create Canvas", "Use Template", "Save Placement", "Recover Projects", "Share Image", "Clear Search"…). ALL-CAPS labels in bg-removal and templates.
- **Orphaned routes:** 5 of the 19 screens are unreachable but registered (`design-export`, `design-versions`, `design-project`, `design-prompt-edit`, `design-upload-sketch`), and 4 of them are largely mock. Delete them rather than polish them.
