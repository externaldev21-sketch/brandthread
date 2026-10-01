/**
 * Brandthread Global Design System
 *
 * Single source of truth for all colors, spacing, typography, and animation tokens.
 * Every Seller screen must import from here — no local color redefinitions.
 *
 * Design language: true black, bold sans type, and a strict grayscale hierarchy.
 * Legacy color-named aliases remain for compatibility but resolve to grayscale.
 */

// ─── Backgrounds ─────────────────────────────────────────────────────────────
// Black, white, and silver: pure black everywhere, silver-bordered black
// surfaces (never a grey fill) — see BORDER below.
export const BG            = '#000000';
// Transparent route surface used by screen roots so the shared animated shell
// remains visible. Keep BG opaque for cards, inputs, modals, and other
// semantic dark surfaces.
export const SCREEN_BG      = 'transparent';
export const SURFACE       = '#000000';
export const CARD          = '#000000';
export const CARD_ELEVATED = '#000000';
export const OVERLAY       = 'rgba(0,0,0,0.72)'; // modal overlay
export const SURFACE_GLASS = 'rgba(0, 0, 0, 0.72)';
export const CARD_GLASS    = 'rgba(0, 0, 0, 0.58)';
export const CARD_ELEVATED_GLASS = 'rgba(0, 0, 0, 0.72)';
export const SKELETON_GLASS = 'rgba(192,192,192,0.10)'; // translucent shimmer
export const SELLER_DASHBOARD_GLASS = 'rgba(0, 0, 0, 0.54)'; // black dashboard panels, silver-bordered
export const SELLER_DASHBOARD_GLASS_ELEVATED = 'rgba(0, 0, 0, 0.68)'; // black elevated dashboard panels, silver-bordered


// ─── Borders ─────────────────────────────────────────────────────────────────
// Surfaces are black fill + thin silver border, never a grey fill. Borders
// stay translucent on purpose (they sit on top of varying card/image content).
export const BORDER          = 'rgba(192,192,192,0.28)';
export const BORDER_SUBTLE   = 'rgba(192,192,192,0.14)';
export const BORDER_ACTIVE   = '#FFFFFF';
export const BORDER_FOCUS    = '#FFFFFF';
// Translucent washes for the handful of non-text call sites (dot/timeline
// backgrounds, a hairline border) that legitimately want the old
// see-through look. Never use these for `color:` — see MUTED/SUBTLE below.
export const MUTED_WASH  = 'rgba(192,192,192,0.35)';
export const SUBTLE_WASH = 'rgba(192,192,192,0.28)';

// ─── Text ─────────────────────────────────────────────────────────────────────
// Every text color here is a SOLID opaque grey, not an alpha blend. A
// translucent small glyph on a near-black background subpixel-antialiases
// against whatever's underneath instead of rendering as one crisp color —
// that's what made every secondary/meta label (review body text, "Helpful
// (N)", dates, "Verified buyer", drop timers, unfocused tab labels, …)
// read as soft/smudgy no matter the font size. Fixed opaque greys read
// crisp at any size. Never reintroduce `rgba(..., <1)` for a text color —
// use SUBTLE_WASH/MUTED_WASH (above) only for non-text backgrounds/borders.
export const FG      = '#FFFFFF';
export const TEXT_PRIMARY   = FG;
export const TEXT_SECONDARY = '#C0C0C0';
export const TEXT_TERTIARY  = '#B0B0B0';
export const MUTED   = TEXT_SECONDARY;
export const SUBTLE  = TEXT_TERTIARY;
/**
 * The create flow's fixed canvas (capture → gallery → edit → post): true black,
 * white and silver whatever Appearance theme is selected — it is a camera-style
 * surface, like the story camera. The only colour is LIVE/record red.
 */
export const CREATE_CANVAS = {
  black: '#000000',
  white: '#FFFFFF',
  silver: '#C0C0C0',
  silverDim: '#8E8E93',
  surface: '#1C1C1E',
  surface2: '#2C2C2E',
  line: '#2C2C2E',
  live: '#FF3B30',
} as const;

export const ON_DARK = '#FFFFFF';                        // on gradient/colored bg
export const ON_DARK_MUTED = '#C0C0C0';   // secondary text on gradient/colored bg — solid, not alpha

// ─── Primary Emphasis ─────────────────────────────────────────────────────────
export const ACCENT        = '#FFFFFF';
export const ACCENT_LIGHT  = '#FFFFFF';
// No colored panel wash: compatibility dim tokens resolve to a black/silver wash.
export const ACCENT_DIM    = 'rgba(255,255,255,0.055)';
/** @deprecated Use ACCENT. Kept for compatibility with legacy screens. */
export const PURPLE        = ACCENT;
/** @deprecated Use ACCENT_LIGHT. Kept for compatibility with legacy screens. */
export const PURPLE_LIGHT  = ACCENT_LIGHT;
/** @deprecated Use ACCENT_DIM. Kept for compatibility with legacy screens. */
export const PURPLE_DIM    = ACCENT_DIM;
/** @deprecated Use ACCENT. Kept for compatibility with legacy screens. */
export const CYAN          = ACCENT;
/** @deprecated Use ACCENT_LIGHT. Kept for compatibility with legacy screens. */
export const CYAN_LIGHT    = ACCENT_LIGHT;
/** @deprecated Use ACCENT_DIM. Kept for compatibility with legacy screens. */
export const CYAN_DIM      = ACCENT_DIM;

// ─── Semantic Colors ──────────────────────────────────────────────────────────
export const SUCCESS        = '#10B981';   // completion, available, shipped
export const SUCCESS_DIM    = 'rgba(16,185,129,0.15)';
export const GREEN_BRIGHT   = '#39FF88';   // revenue highlight ONLY (not UI chrome)
/** @deprecated Use ACCENT. Kept for compatibility; info chrome is grayscale. */
export const BLUE           = ACCENT;
/** @deprecated Use ACCENT_DIM. Kept for compatibility; info chrome is grayscale. */
export const BLUE_DIM       = ACCENT_DIM;
export const ORANGE         = '#F97316';   // warning, draft
export const ORANGE_DIM     = 'rgba(249,115,22,0.15)';
export const RED            = '#F87171';   // error, returns, disputed
export const RED_DIM        = 'rgba(248,113,113,0.15)';
export const GOLD           = '#F59E0B';   // premium, pro

// ─── Gradients ────────────────────────────────────────────────────────────────
export const GRAD_PRIMARY   = [ACCENT, ACCENT] as const;
export const GRAD_HERO      = ['#000000', '#000000'] as const;
export const GRAD_CARD_GLOW = ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)'] as const;
export const GRAD_SUCCESS_G = ['#10B981', '#34D399'] as const;
export const GRAD_REVENUE   = ['#39FF88', '#10B981'] as const;
export const GRAD_DARK_FADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,1)'] as const;
export const GRAD_TAB_BAR   = ['rgba(0,0,0,0.96)', 'rgba(0,0,0,1)'] as const;

// ─── Typography ───────────────────────────────────────────────────────────────
export const FONT = {
  thin:     'Inter_400Regular'  as const,
  light:    'Inter_400Regular'  as const,
  regular:  'Inter_400Regular'  as const,
  medium:   'Inter_500Medium'   as const,
  semibold: 'Inter_600SemiBold' as const,
  bold:     'Inter_700Bold'     as const,
  extrabold:'Inter_700Bold'     as const,
} as const;

export const FS = {
  // 11 is the absolute floor — badges/chips only, never body copy. Any
  // secondary/meta/caption text (review "Helpful (N)", dates, "Verified
  // buyer", card fine print, …) belongs at `meta` (12) or above.
  xs:   11,
  meta: 12,
  sm:   13,
  base: 15,
  md:   17,
  lg:   19,
  xl:   22,
  xxl:  26,
  h2:   30,
  h1:   36,
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────
export const SP = {
  xs:   4,
  sm:   8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

// ─── Border Radii ─────────────────────────────────────────────────────────────
export const RADIUS = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   24,
  xxl:  32,
  pill: 999,
} as const;

// ─── Shadows ──────────────────────────────────────────────────────────────────
export const SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.4,
  shadowRadius: 16,
  elevation: 8,
} as const;

/** @deprecated Use SHADOW. Kept for compatibility with legacy imports. */
export const SHADOW_PURPLE = SHADOW;

export const SHADOW_SM = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.4,
  shadowRadius: 8,
  elevation: 4,
} as const;

// ─── Animation Timing ─────────────────────────────────────────────────────────
export const ANIM = {
  fast:   150,
  normal: 250,
  slow:   400,
  spring: { tension: 60, friction: 10 },
} as const;

// ─── Icon Sizes ───────────────────────────────────────────────────────────────
export const ICON = {
  xs:  14,
  sm:  16,
  md:  20,
  lg:  24,
  xl:  28,
  xxl: 36,
} as const;

// ─── Component Sizes ─────────────────────────────────────────────────────────
export const COMP = {
  buttonH:    52,   // primary button height
  buttonHSm:  44,   // small button; minimum comfortable touch target
  inputH:     52,   // form input
  tabBarH:    72,   // bottom tab bar
  headerH:    56,   // screen header
  cardRadius: RADIUS.lg,
  iconBtn:    44,   // icon button; minimum comfortable touch target
  minTouchTarget: 44,
} as const;

// ─── Layout / Breakpoints ─────────────────────────────────────────────────────
// Shared grid used across buyer + seller screens: 16pt side gutters on phone,
// a centered max-width content column on iPad/landscape, and consistent
// section gaps. Screens should read gutters/section gaps from here instead of
// one-off paddings.
export const GUTTER = SP.md;          // 16pt side gutter (phone)
export const SECTION_GAP = SP.lg;     // 24pt gap between stacked sections
export const CONTENT_MAX_WIDTH = 720; // centered column cap for forms/detail on iPad
export const GRID_MAX_WIDTH = 1080;   // centered column cap for multi-column grids on iPad

export const BREAKPOINT = {
  tablet: 768,   // iPad portrait and up
  desktopWeb: 1024,
} as const;

/**
 * Overnight batch item 40 (dead top space): the one value every tab-page
 * header (TabPageHeader, DiscoverSearchHeader, PageHeader/Header.tsx,
 * buyer-conversation, buyer inbox, seller orders/products) used to
 * hand-roll its own copy of, each as `Platform.OS === 'web' ? 67 : insets.top`.
 *
 * Outside a real device (or a preview frame that actually emulates one),
 * react-native-safe-area-context's web implementation reads `insets.top`
 * as 0, so every one of those screens needed a stand-in value for what a
 * real device's status-bar inset would be — but `67` was a guess, and a
 * high one: an iPhone 12/13/14-class device at this exact 390x844 size
 * (the size the owner actually reviews at) has a real safe-area-inset-top
 * of 47pt, not 67. That 20pt gap, stacked with each header's own
 * additional title gap, is what read as dead space well past where
 * Instagram's own title sits relative to the status bar.
 */
export const WEB_SAFE_AREA_TOP = 47;

// Heading / body type scale (paired with FS above). Use these role names
// instead of picking raw FS.* sizes per screen.
export const TYPE = {
  // Large titles get a touch of negative tracking — big Inter Bold reads
  // slightly loose otherwise; smaller roles keep the font's natural tracking.
  largeTitle: { fontSize: FS.h1, fontFamily: FONT.bold, lineHeight: 42, letterSpacing: -0.3 },
  title:      { fontSize: FS.h2, fontFamily: FONT.bold, lineHeight: 36, letterSpacing: -0.3 },
  heading:    { fontSize: FS.xl, fontFamily: FONT.semibold, lineHeight: 28 },
  subheading: { fontSize: FS.lg, fontFamily: FONT.semibold, lineHeight: 24 },
  body:       { fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 22 },
  bodyMedium: { fontSize: FS.base, fontFamily: FONT.medium, lineHeight: 22 },
  caption:    { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  label:      { fontSize: FS.xs, fontFamily: FONT.semibold, lineHeight: 14 },
  // Fine print at 12-13px needs medium (500) weight to hold up as a solid
  // shape on a near-black background — regular weight's thin strokes are
  // what read as "smudgy" even once the color itself is opaque.
  meta:       { fontSize: FS.meta, fontFamily: FONT.medium, lineHeight: 16 },
} as const;
