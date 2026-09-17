/**
 * Shared strict validation for slideshow overlay payloads.
 *
 * Called from:
 *   - POST /api/posts/compose-slideshow  (composition-time)
 *   - POST /api/posts                   (persistence-time, direct callers)
 *   - PATCH /api/posts/:id              (persistence-time, direct callers)
 *
 * Both paths MUST validate so that a caller who bypasses compose-slideshow
 * cannot inject malicious text or out-of-bounds values into the DB.
 */

// ─── Overlay field bounds ─────────────────────────────────────────────────────
export const MAX_SLIDES           = 10;
export const MAX_OVERLAYS_PER_SLIDE = 10;
export const MAX_TEXT_LENGTH      = 200;
export const MIN_FONT_SIZE        = 10;
export const MAX_FONT_SIZE        = 120;

export const VALID_FONT_STYLES = new Set([
  "classic", "elegance", "retro", "vintage", "postcard", "script", "technic",
]);
export const VALID_ALIGN    = new Set(["left", "center", "right"]);
export const VALID_BG_STYLES = new Set(["none", "solid", "semi"]);
export const HEX_COLOR_RE   = /^#[0-9A-Fa-f]{6}$/;

// ─── Types ────────────────────────────────────────────────────────────────────

/** One validated overlay ready for DB storage or FFmpeg rendering */
export interface ValidatedOverlay {
  id:        string;
  text:      string;
  x:         number;
  y:         number;
  color:     string;
  fontStyle: string;
  align:     string;
  bgStyle:   string;
  fontSize:  number;
  startTime?: number;
  endTime?:   number;
}

/** One validated slide-overlay record (slideIndex + overlays array) */
export interface ValidatedSlideOverlayRecord {
  slideIndex: number;
  overlays:   ValidatedOverlay[];
}

// ─── Overlay validation ───────────────────────────────────────────────────────

/**
 * Validate a single overlays array (for one slide).
 * Returns { ok: true, overlays } or { ok: false, error }.
 * All fields are strictly checked — unknown or extra keys in each entry are ignored (not stored).
 */
export function validateOverlaysArray(
  raw: unknown,
  slideLabel = "overlay",
): { ok: true; overlays: ValidatedOverlay[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, overlays: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${slideLabel}: overlays must be an array` };
  if (raw.length > MAX_OVERLAYS_PER_SLIDE) {
    return { ok: false, error: `${slideLabel}: max ${MAX_OVERLAYS_PER_SLIDE} overlays per slide` };
  }

  const overlays: ValidatedOverlay[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: must be an object` };
    }
    const it = item as Record<string, unknown>;

    // id — optional string, clamped to 64 chars; falls back to positional id
    if (it.id !== undefined && typeof it.id !== "string") {
      return { ok: false, error: `${slideLabel} overlay[${i}]: id must be a string` };
    }
    const id = typeof it.id === "string" ? it.id.slice(0, 64) : `overlay_${i}`;

    // text — required non-empty string, max 200 chars
    if (typeof it.text !== "string" || it.text.length === 0) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: text must be a non-empty string` };
    }
    if (it.text.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: text exceeds ${MAX_TEXT_LENGTH} characters` };
    }

    // x, y — must be finite numbers in [0, 1]
    const x = Number(it.x);
    const y = Number(it.y);
    if (!Number.isFinite(x) || x < 0 || x > 1) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: x must be 0–1` };
    }
    if (!Number.isFinite(y) || y < 0 || y > 1) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: y must be 0–1` };
    }

    // color — required, must be lowercase 6-digit hex #rrggbb
    if (typeof it.color !== "string") {
      return { ok: false, error: `${slideLabel} overlay[${i}]: color is required` };
    }
    const color = it.color.toLowerCase();
    if (!HEX_COLOR_RE.test(color)) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: color must be a 6-digit hex string (#rrggbb)` };
    }

    // fontStyle — required, must be one of the allowed presets
    if (typeof it.fontStyle !== "string" || !VALID_FONT_STYLES.has(it.fontStyle)) {
      return {
        ok: false,
        error: `${slideLabel} overlay[${i}]: fontStyle must be one of ${[...VALID_FONT_STYLES].join(", ")}`,
      };
    }

    // align — required
    if (typeof it.align !== "string" || !VALID_ALIGN.has(it.align)) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: align must be left, center, or right` };
    }

    // bgStyle — required
    if (typeof it.bgStyle !== "string" || !VALID_BG_STYLES.has(it.bgStyle)) {
      return { ok: false, error: `${slideLabel} overlay[${i}]: bgStyle must be none, solid, or semi` };
    }

    // fontSize — required integer in [MIN_FONT_SIZE, MAX_FONT_SIZE]
    const fontSize = Number(it.fontSize);
    if (!Number.isFinite(fontSize) || fontSize < MIN_FONT_SIZE || fontSize > MAX_FONT_SIZE) {
      return {
        ok: false,
        error: `${slideLabel} overlay[${i}]: fontSize must be ${MIN_FONT_SIZE}–${MAX_FONT_SIZE}`,
      };
    }

    // startTime / endTime — optional non-negative numbers
    let startTime: number | undefined;
    let endTime: number | undefined;
    if (it.startTime !== undefined && it.startTime !== null) {
      startTime = Number(it.startTime);
      if (!Number.isFinite(startTime) || startTime < 0) {
        return { ok: false, error: `${slideLabel} overlay[${i}]: startTime must be >= 0` };
      }
    }
    if (it.endTime !== undefined && it.endTime !== null) {
      endTime = Number(it.endTime);
      if (!Number.isFinite(endTime) || endTime < 0) {
        return { ok: false, error: `${slideLabel} overlay[${i}]: endTime must be >= 0` };
      }
    }

    // Reject any unexpected keys to avoid hidden payload injection
    const knownKeys = new Set(["id","text","x","y","color","fontStyle","align","bgStyle","fontSize","startTime","endTime"]);
    for (const key of Object.keys(it)) {
      if (!knownKeys.has(key)) {
        return { ok: false, error: `${slideLabel} overlay[${i}]: unknown field "${key}"` };
      }
    }

    overlays.push({ id, text: it.text, x, y, color, fontStyle: it.fontStyle, align: it.align, bgStyle: it.bgStyle, fontSize, startTime, endTime });
  }
  return { ok: true, overlays };
}

/**
 * Validate a full slideOverlays payload: array of { slideIndex, overlays[] }.
 *
 * Rules:
 *  - Must be an array (or undefined/null → empty [])
 *  - Max MAX_SLIDES entries
 *  - Each entry: { slideIndex (integer 0–MAX_SLIDES-1, unique), overlays (array) }
 *  - No unknown fields on the entry object
 *  - Each overlay validated by validateOverlaysArray
 *
 * Returns { ok: true, records } or { ok: false, error }.
 */
export function validateSlideOverlays(
  raw: unknown,
): { ok: true; records: ValidatedSlideOverlayRecord[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, records: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "slideOverlays must be an array" };
  if (raw.length > MAX_SLIDES) {
    return { ok: false, error: `slideOverlays: max ${MAX_SLIDES} entries` };
  }

  const records: ValidatedSlideOverlayRecord[] = [];
  const seenIndices = new Set<number>();

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `slideOverlays[${i}]: must be an object` };
    }
    const e = entry as Record<string, unknown>;

    // Reject unknown keys on the entry object
    const entryKnownKeys = new Set(["slideIndex", "overlays"]);
    for (const key of Object.keys(e)) {
      if (!entryKnownKeys.has(key)) {
        return { ok: false, error: `slideOverlays[${i}]: unknown field "${key}"` };
      }
    }

    // slideIndex — required non-negative integer in [0, MAX_SLIDES - 1], unique
    if (typeof e.slideIndex !== "number" || !Number.isInteger(e.slideIndex) || e.slideIndex < 0 || e.slideIndex >= MAX_SLIDES) {
      return { ok: false, error: `slideOverlays[${i}]: slideIndex must be an integer 0–${MAX_SLIDES - 1}` };
    }
    if (seenIndices.has(e.slideIndex)) {
      return { ok: false, error: `slideOverlays[${i}]: duplicate slideIndex ${e.slideIndex}` };
    }
    seenIndices.add(e.slideIndex);

    // overlays — validate the array
    const ovResult = validateOverlaysArray(e.overlays, `slideOverlays[${i}]`);
    if (!ovResult.ok) return { ok: false, error: ovResult.error };

    records.push({ slideIndex: e.slideIndex, overlays: ovResult.overlays });
  }

  return { ok: true, records };
}
