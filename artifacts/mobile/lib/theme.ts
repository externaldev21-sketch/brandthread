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
export const BG            = '#0A0A0B';
// Transparent route surface used by screen roots so the shared animated shell
// remains visible. Keep BG opaque for cards, inputs, modals, and other
// semantic dark surfaces.
export const SCREEN_BG      = 'transparent';
export const SURFACE       = '#111113';
export const CARD          = '#18181B';
export const CARD_ELEVATED = '#222226';
export const OVERLAY       = 'rgba(0,0,0,0.72)'; // modal overlay
export const SURFACE_GLASS = 'rgba(17, 17, 19, 0.72)';
export const CARD_GLASS    = 'rgba(24, 24, 27, 0.58)';
export const CARD_ELEVATED_GLASS = 'rgba(34, 34, 38, 0.72)';
export const SKELETON_GLASS = 'rgba(255,255,255,0.05)'; // translucent shimmer
export const SELLER_DASHBOARD_GLASS = 'rgba(16, 16, 16, 0.54)'; // neutral graphite dashboard panels
export const SELLER_DASHBOARD_GLASS_ELEVATED = 'rgba(26, 26, 26, 0.68)'; // neutral elevated dashboard panels


// ─── Borders ─────────────────────────────────────────────────────────────────
export const BORDER          = 'rgba(255,255,255,0.07)';
export const BORDER_SUBTLE   = 'rgba(255,255,255,0.04)';
export const BORDER_ACTIVE   = '#F7F7FA';
export const BORDER_FOCUS    = '#F7F7FA';

// ─── Text ─────────────────────────────────────────────────────────────────────
export const FG      = '#F7F7FA';
export const MUTED   = 'rgba(247,247,250,0.58)';
// 50% white on the black background clears the 4.5:1 readable-text target
// while remaining visibly dimmer than MUTED.
export const SUBTLE  = 'rgba(247,247,250,0.50)';
export const ON_DARK = '#FFFFFF';                        // on gradient/colored bg
export const ON_DARK_MUTED = 'rgba(255,255,255,0.72)';   // secondary text on gradient/colored bg

// ─── Primary Emphasis ─────────────────────────────────────────────────────────
export const ACCENT        = '#F7F7FA';
export const ACCENT_LIGHT  = '#FFFFFF';
// No colored panel wash: compatibility dim tokens resolve to neutral graphite.
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
export const GRAD_HERO      = ['#0A0A0B', '#18181B'] as const;
export const GRAD_CARD_GLOW = ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)'] as const;
export const GRAD_SUCCESS_G = ['#10B981', '#34D399'] as const;
export const GRAD_REVENUE   = ['#39FF88', '#10B981'] as const;
export const GRAD_DARK_FADE = ['rgba(10,10,11,0)', 'rgba(10,10,11,1)'] as const;
export const GRAD_TAB_BAR   = ['rgba(10,10,11,0.96)', 'rgba(17,17,19,1)'] as const;

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
  xs:   11,
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

// Heading / body type scale (paired with FS above). Use these role names
// instead of picking raw FS.* sizes per screen.
export const TYPE = {
  largeTitle: { fontSize: FS.h1, fontFamily: FONT.bold, lineHeight: 42 },
  title:      { fontSize: FS.h2, fontFamily: FONT.bold, lineHeight: 36 },
  heading:    { fontSize: FS.xl, fontFamily: FONT.semibold, lineHeight: 28 },
  subheading: { fontSize: FS.lg, fontFamily: FONT.semibold, lineHeight: 24 },
  body:       { fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 22 },
  bodyMedium: { fontSize: FS.base, fontFamily: FONT.medium, lineHeight: 22 },
  caption:    { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  label:      { fontSize: FS.xs, fontFamily: FONT.semibold, lineHeight: 14 },
} as const;
