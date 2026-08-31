/**
 * Brandthread central branding constants.
 * All logo usage should import from here — never hardcode the asset path.
 */

// ── Official logo asset ───────────────────────────────────────────────────────
// Replace `brandthread-logo.png` with the real transparent PNG to update everywhere.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const LOGO_SOURCE = require('../assets/images/brandthread-logo.png');

// ── Accessibility ─────────────────────────────────────────────────────────────
export const LOGO_A11Y_LABEL = 'Brandthread logo';

// ── Standard sizes (logical pixels) ──────────────────────────────────────────
export const LOGO_SIZE = {
  /** Tiny in-line icon */       xs:     24,
  /** Small header mark */       sm:     32,
  /** Standard header logo */    md:     44,
  /** Auth screen header */      lg:     80,
  /** Splash / hero */           xl:    120,
  /** Empty-state illustration */empty:  64,
  /** Profile fallback */        avatar: 56,
} as const;

// ── Glow defaults ─────────────────────────────────────────────────────────────
export const LOGO_GLOW_COLOR   = '#DDE2E8';
export const LOGO_GLOW_ENABLED = true;
