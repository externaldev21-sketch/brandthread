/**
 * Brandthread Global Design System
 *
 * Single source of truth for all colors, spacing, typography, and animation tokens.
 * Every Seller screen must import from here — no local color redefinitions.
 *
 * Design language: premium fashion operating system — dark, precise, alive.
 * Matches the onboarding flow (purple/cyan gradients, deep black, glassmorphism).
 */

// ─── Backgrounds ─────────────────────────────────────────────────────────────
export const BG            = '#07070F';   // deep application background
export const SURFACE       = '#0C0C17';   // slightly lifted surface (tabs, sheets)
export const CARD          = '#12121F';   // standard card background
export const CARD_ELEVATED = '#18182E';   // elevated card (hero, featured)
export const OVERLAY       = 'rgba(0,0,0,0.72)'; // modal overlay

// ─── Borders ─────────────────────────────────────────────────────────────────
export const BORDER          = 'rgba(255,255,255,0.07)';
export const BORDER_SUBTLE   = 'rgba(255,255,255,0.04)';
export const BORDER_ACTIVE   = 'rgba(139,92,246,0.45)';
export const BORDER_FOCUS    = 'rgba(34,211,238,0.5)';

// ─── Text ─────────────────────────────────────────────────────────────────────
export const FG      = '#F4F4FF';                       // primary foreground
export const MUTED   = 'rgba(244,244,255,0.50)';        // secondary text
export const SUBTLE  = 'rgba(244,244,255,0.28)';        // tertiary / placeholder
export const ON_DARK = '#FFFFFF';                        // on gradient/colored bg

// ─── Brand Accents ────────────────────────────────────────────────────────────
export const PURPLE        = '#8B5CF6';   // primary brand
export const PURPLE_LIGHT  = '#A78BFA';   // lighter purple (hover, tint)
export const PURPLE_DIM    = 'rgba(139,92,246,0.18)';
export const CYAN          = '#22D3EE';   // secondary brand
export const CYAN_LIGHT    = '#67E8F9';
export const CYAN_DIM      = 'rgba(34,211,238,0.15)';

// ─── Semantic Colors ──────────────────────────────────────────────────────────
export const SUCCESS        = '#10B981';   // completion, available, shipped
export const SUCCESS_DIM    = 'rgba(16,185,129,0.15)';
export const GREEN_BRIGHT   = '#39FF88';   // revenue highlight ONLY (not UI chrome)
export const BLUE           = '#3B82F6';   // info, processing
export const BLUE_DIM       = 'rgba(59,130,246,0.15)';
export const ORANGE         = '#F97316';   // warning, draft
export const ORANGE_DIM     = 'rgba(249,115,22,0.15)';
export const RED            = '#F87171';   // error, returns, disputed
export const RED_DIM        = 'rgba(248,113,113,0.15)';
export const GOLD           = '#F59E0B';   // premium, pro

// ─── Gradients ────────────────────────────────────────────────────────────────
export const GRAD_PRIMARY   = ['#8B5CF6', '#22D3EE'] as const;  // purple → cyan
export const GRAD_HERO      = ['#8B5CF6', '#3B82F6', '#22D3EE'] as const;
export const GRAD_CARD_GLOW = ['rgba(139,92,246,0.12)', 'rgba(34,211,238,0.04)'] as const;
export const GRAD_SUCCESS_G = ['#10B981', '#34D399'] as const;
export const GRAD_REVENUE   = ['#39FF88', '#10B981'] as const;
export const GRAD_DARK_FADE = ['rgba(7,7,15,0)', 'rgba(7,7,15,1)'] as const;
export const GRAD_TAB_BAR   = ['rgba(7,7,15,0.96)', 'rgba(12,12,23,1)'] as const;

// ─── Typography ───────────────────────────────────────────────────────────────
export const FONT = {
  thin:     'Inter_100Thin'     as const,
  light:    'Inter_300Light'    as const,
  regular:  'Inter_400Regular'  as const,
  medium:   'Inter_500Medium'   as const,
  semibold: 'Inter_600SemiBold' as const,
  bold:     'Inter_700Bold'     as const,
  extrabold:'Inter_800ExtraBold'as const,
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
export const SHADOW_PURPLE = {
  shadowColor: '#8B5CF6',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.35,
  shadowRadius: 16,
  elevation: 8,
} as const;

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
  buttonHSm:  42,   // small button
  inputH:     52,   // form input
  tabBarH:    72,   // bottom tab bar
  headerH:    56,   // screen header
  cardRadius: RADIUS.lg,
  iconBtn:    40,   // circle icon button
} as const;
