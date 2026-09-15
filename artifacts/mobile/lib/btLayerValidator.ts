/**
 * btLayerValidator — strict runtime validator for Brandthread canvas JSON imports.
 *
 * Architecture decisions:
 *  - No casts of arbitrary parsed objects to DesignLayer[]. Every field is
 *    checked before the typed value is returned.
 *  - Produces sanitised DesignLayer[] with fresh IDs (never trusts imported IDs).
 *  - Allowlists known layer kinds and data shapes; rejects unknown kinds.
 *  - Caps string lengths, path lengths, layer count, and numeric bounds.
 *  - Blocks every known injection vector: SVG data URIs, remote http(s) URIs,
 *    javascript: URIs, file-traversal paths, non-image data URIs.
 *
 * Exported pure functions (no React, no Expo) are fully testable in Vitest.
 */

import type { DesignLayer, DesignLayerData } from '@/services/designTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum layers in a single import (prevents memory exhaustion). */
export const BT_MAX_LAYERS = 200;

/** Maximum length of any single string field (name, color, fontFamily…). */
export const BT_MAX_STRING = 512;

/** Maximum SVG path string length per path. */
export const BT_MAX_PATH_D = 50_000;

/** Maximum number of paths in a single drawing layer. */
export const BT_MAX_PATHS = 2000;

/** Allowed image URI prefixes for image-layer URIs. */
const SAFE_IMAGE_URI_PREFIXES = [
  'file:///',
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/gif;base64,',
  'data:image/webp;base64,',
] as const;

/** Allowed layer kinds. */
const ALLOWED_KINDS = new Set(['drawing', 'image', 'text', 'shape']);

/** Allowed shape kinds. */
const ALLOWED_SHAPES = new Set(['rect', 'circle', 'triangle', 'line', 'star']);

/** Allowed blend modes. */
const ALLOWED_BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
]);

// ─── Discriminated result type ────────────────────────────────────────────────

export type ValidationOk = { ok: true; layers: DesignLayer[] };
export type ValidationErr = { ok: false; reason: string };
export type ValidationResult = ValidationOk | ValidationErr;

// ─── Internal helpers ─────────────────────────────────────────────────────────

let _uid = 0;
function freshId(): string { return `imp_${Date.now()}_${++_uid}`; }

function ve(reason: string): ValidationErr { return { ok: false, reason }; }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteBounded(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && isFinite(v) && v >= min && v <= max;
}

function isShortString(v: unknown, maxLen = BT_MAX_STRING): v is string {
  return typeof v === 'string' && v.length <= maxLen;
}

/**
 * Validate an image URI:
 *  - Must start with one of SAFE_IMAGE_URI_PREFIXES.
 *  - Must NOT be an SVG data URI.
 *  - Must NOT be a remote http(s) URI.
 *  - Must NOT contain path traversal sequences.
 */
export function isAllowedImageUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length > 8 * 1024 * 1024) return false;
  const lower = uri.toLowerCase();

  // Block SVG data URIs explicitly
  if (lower.startsWith('data:image/svg')) return false;

  // Block non-image data URIs
  if (lower.startsWith('data:') && !SAFE_IMAGE_URI_PREFIXES.some(p => lower.startsWith(p.toLowerCase()))) {
    return false;
  }

  // Block remote URIs
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;

  // Block javascript:
  if (lower.startsWith('javascript:')) return false;

  // Block path traversal
  if (uri.includes('../') || uri.includes('..\\')) return false;

  // Must match one of the known safe prefixes (or be a cache:// / content:// expo-managed URI)
  const knownSafe =
    SAFE_IMAGE_URI_PREFIXES.some(p => lower.startsWith(p.toLowerCase())) ||
    lower.startsWith('cache://') ||
    lower.startsWith('content://');

  return knownSafe;
}

// ─── Per-kind validators ──────────────────────────────────────────────────────

function validateDrawingData(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return ve('drawing data must be an object');
  if (raw.kind !== 'drawing') return ve('drawing kind mismatch');

  if (!Array.isArray(raw.paths)) return ve('drawing.paths must be an array');
  if (raw.paths.length > BT_MAX_PATHS) return ve(`drawing has too many paths (max ${BT_MAX_PATHS})`);

  for (let i = 0; i < raw.paths.length; i++) {
    const p = raw.paths[i];
    if (!isPlainObject(p)) return ve(`paths[${i}] must be an object`);
    if (!isShortString(p.d, BT_MAX_PATH_D)) return ve(`paths[${i}].d is missing or too long`);
    if (!isShortString(p.color)) return ve(`paths[${i}].color is invalid`);
    if (!isFiniteBounded(p.width, 0, 1000)) return ve(`paths[${i}].width is out of range`);
    if (!isFiniteBounded(p.opacity, 0, 1)) return ve(`paths[${i}].opacity is out of range`);
    if (!isShortString(p.tool)) return ve(`paths[${i}].tool is invalid`);
  }

  return { ok: true, layers: [] };
}

function validateImageData(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return ve('image data must be an object');
  if (raw.kind !== 'image') return ve('image kind mismatch');
  if (typeof raw.uri !== 'string') return ve('image.uri must be a string');
  if (!isAllowedImageUri(raw.uri)) {
    return ve('image.uri uses a disallowed scheme (remote, SVG, or javascript URIs are blocked)');
  }
  if (raw.blendMode !== undefined && !ALLOWED_BLEND_MODES.has(String(raw.blendMode))) {
    return ve(`image.blendMode "${raw.blendMode}" is not allowed`);
  }
  if (raw.opacity !== undefined && !isFiniteBounded(raw.opacity, 0, 1)) {
    return ve('image.opacity out of range');
  }
  return { ok: true, layers: [] };
}

function validateTextData(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return ve('text data must be an object');
  if (raw.kind !== 'text') return ve('text kind mismatch');
  const textStr = raw.text ?? raw.content;
  if (textStr !== undefined && !isShortString(textStr)) return ve('text content too long');
  if (!isShortString(raw.fontFamily ?? 'System')) return ve('text.fontFamily invalid');
  if (raw.fontSize !== undefined && !isFiniteBounded(raw.fontSize, 1, 1000)) {
    return ve('text.fontSize out of range');
  }
  return { ok: true, layers: [] };
}

function validateShapeData(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return ve('shape data must be an object');
  if (raw.kind !== 'shape') return ve('shape kind mismatch');
  if (!ALLOWED_SHAPES.has(String(raw.shape ?? ''))) {
    return ve(`shape.shape "${raw.shape}" is not a known shape kind`);
  }
  if (raw.strokeWidth !== undefined && !isFiniteBounded(raw.strokeWidth, 0, 500)) {
    return ve('shape.strokeWidth out of range');
  }
  if (raw.cornerRadius !== undefined && !isFiniteBounded(raw.cornerRadius, 0, 2000)) {
    return ve('shape.cornerRadius out of range');
  }
  return { ok: true, layers: [] };
}

function validateTransform(t: unknown): ValidationResult {
  if (!isPlainObject(t)) return ve('transform must be an object');
  const DIM_MAX = 32_768;
  if (!isFiniteBounded(t.x, -DIM_MAX, DIM_MAX))        return ve('transform.x out of range');
  if (!isFiniteBounded(t.y, -DIM_MAX, DIM_MAX))        return ve('transform.y out of range');
  if (!isFiniteBounded(t.width, 0, DIM_MAX))           return ve('transform.width out of range');
  if (!isFiniteBounded(t.height, 0, DIM_MAX))          return ve('transform.height out of range');
  if (!isFiniteBounded(t.rotation ?? 0, -3600, 3600))  return ve('transform.rotation out of range');
  if (!isFiniteBounded(t.scaleX ?? 1, -100, 100))      return ve('transform.scaleX out of range');
  if (!isFiniteBounded(t.scaleY ?? 1, -100, 100))      return ve('transform.scaleY out of range');
  return { ok: true, layers: [] };
}

// ─── Top-level layer validator ────────────────────────────────────────────────

function validateOneLayer(raw: unknown, index: number): DesignLayer | ValidationErr {
  if (!isPlainObject(raw)) return ve(`layers[${index}] must be a plain object`);

  if (!isShortString(raw.name)) return ve(`layers[${index}].name is invalid`);
  if (!isFiniteBounded(raw.order, -1e9, 1e9)) return ve(`layers[${index}].order is invalid`);
  if (typeof raw.visible !== 'boolean') return ve(`layers[${index}].visible must be boolean`);
  if (typeof raw.locked !== 'boolean') return ve(`layers[${index}].locked must be boolean`);
  if (!isFiniteBounded(raw.opacity ?? 1, 0, 1)) return ve(`layers[${index}].opacity out of range`);

  const tResult = validateTransform(raw.transform);
  if (!tResult.ok) return ve(`layers[${index}].transform: ${tResult.reason}`);
  const rawT = raw.transform as Record<string, unknown>;

  const type = String(raw.type ?? '');
  const data = raw.data;
  if (!isPlainObject(data)) return ve(`layers[${index}].data must be an object`);
  const kind = String((data as Record<string, unknown>).kind ?? '');

  if (!ALLOWED_KINDS.has(kind)) return ve(`layers[${index}].data.kind "${kind}" is not allowed`);

  // layer.type must exactly equal layer.data.kind — no silent coercions.
  if (type !== kind) {
    return ve(`layers[${index}]: type "${type}" does not match data.kind "${kind}" — they must be identical`);
  }

  let dataResult: ValidationResult;
  if (kind === 'drawing') dataResult = validateDrawingData(data);
  else if (kind === 'image') dataResult = validateImageData(data);
  else if (kind === 'text')  dataResult = validateTextData(data);
  else                       dataResult = validateShapeData(data);

  if (!dataResult.ok) return ve(`layers[${index}].data: ${dataResult.reason}`);

  let sanitisedData: DesignLayerData;
  if (kind === 'drawing') {
    const d = data as Record<string, unknown>;
    sanitisedData = {
      kind: 'drawing',
      paths: (d.paths as Array<Record<string, unknown>>).map(p => ({
        d:       String(p.d),
        color:   String(p.color),
        width:   Number(p.width),
        opacity: Number(p.opacity),
        tool:    String(p.tool),
      })),
      ...(isShortString(d.brushType) ? { brushType: d.brushType } : {}),
    } as DesignLayerData;
  } else if (kind === 'image') {
    const d = data as Record<string, unknown>;
    sanitisedData = {
      kind:      'image',
      uri:       String(d.uri),
      opacity:   typeof d.opacity === 'number' ? Math.min(1, Math.max(0, d.opacity)) : 1,
      fit:       isShortString(d.fit) ? d.fit : 'contain',
      blendMode: ALLOWED_BLEND_MODES.has(String(d.blendMode)) ? (d.blendMode as string) : 'normal',
    } as DesignLayerData;
  } else if (kind === 'text') {
    const d = data as Record<string, unknown>;
    sanitisedData = {
      kind:          'text',
      text:          isShortString(d.text) ? d.text : undefined,
      content:       isShortString(d.content) ? d.content : undefined,
      fontFamily:    isShortString(d.fontFamily) ? d.fontFamily : 'System',
      fontSize:      isFiniteBounded(d.fontSize, 1, 1000) ? d.fontSize : 24,
      letterSpacing: isFiniteBounded(d.letterSpacing, -100, 1000) ? d.letterSpacing : 0,
      bold:          typeof d.bold === 'boolean' ? d.bold : false,
      italic:        typeof d.italic === 'boolean' ? d.italic : false,
      color:         isShortString(d.color) ? d.color : undefined,
      textColor:     isShortString(d.textColor) ? d.textColor : undefined,
      align:         (['left', 'center', 'right'] as string[]).includes(String(d.align))
                       ? (d.align as 'left'|'center'|'right') : 'center',
    } as DesignLayerData;
  } else {
    const d = data as Record<string, unknown>;
    sanitisedData = {
      kind:        'shape',
      shape:       String(d.shape ?? 'rect') as 'rect',
      fill:        isShortString(d.fill) ? d.fill : undefined,
      stroke:      isShortString(d.stroke) ? d.stroke : undefined,
      fillColor:   isShortString(d.fillColor) ? d.fillColor : undefined,
      strokeColor: isShortString(d.strokeColor) ? d.strokeColor : undefined,
      strokeWidth: isFiniteBounded(d.strokeWidth, 0, 500) ? d.strokeWidth : 0,
      cornerRadius: isFiniteBounded(d.cornerRadius, 0, 2000) ? d.cornerRadius : 0,
    } as DesignLayerData;
  }

  const now = new Date().toISOString();
  return {
    id:        freshId(),
    name:      String(raw.name).slice(0, BT_MAX_STRING),
    type:      type as DesignLayer['type'],
    visible:   Boolean(raw.visible),
    locked:    Boolean(raw.locked),
    order:     Number(raw.order),
    opacity:   isFiniteBounded(raw.opacity, 0, 1) ? raw.opacity : 1,
    transform: {
      x:        Number(rawT.x),
      y:        Number(rawT.y),
      width:    Number(rawT.width),
      height:   Number(rawT.height),
      rotation: isFiniteBounded(rawT.rotation, -3600, 3600) ? Number(rawT.rotation) : 0,
      scaleX:   isFiniteBounded(rawT.scaleX, -100, 100) ? Number(rawT.scaleX) : 1,
      scaleY:   isFiniteBounded(rawT.scaleY, -100, 100) ? Number(rawT.scaleY) : 1,
      ...(typeof rawT.flipX === 'boolean' ? { flipX: rawT.flipX } : {}),
      ...(typeof rawT.flipY === 'boolean' ? { flipY: rawT.flipY } : {}),
    },
    data:      sanitisedData,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * validateBtJson — parse and strictly validate a raw JSON string as a
 * Brandthread canvas export.
 *
 * @param raw        Raw file text.
 * @param maxLayers  Maximum layer count accepted (default BT_MAX_LAYERS).
 * @returns          ValidationResult — ok:true with sanitised DesignLayer[],
 *                   or ok:false with a human-readable reason.
 *
 * Never throws; all errors surface as ok:false.
 */
export function validateBtJson(
  raw: string,
  maxLayers = BT_MAX_LAYERS,
): ValidationResult {
  // ── 1. Parse ──────────────────────────────────────────────────────────────
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return ve('File is not valid JSON'); }

  // ── 2. Root must be a plain object ────────────────────────────────────────
  if (!isPlainObject(parsed)) return ve('Root must be a JSON object, not an array or primitive');

  // ── 3. Must have a layers array ───────────────────────────────────────────
  if (!Array.isArray(parsed.layers)) {
    return ve('Missing or invalid "layers" field — this does not look like a Brandthread canvas export');
  }

  // ── 4. Layer count cap ────────────────────────────────────────────────────
  if (parsed.layers.length > maxLayers) {
    return ve(`Too many layers (${parsed.layers.length} > max ${maxLayers})`);
  }

  // ── 5. Unsafe-content scan (belt-and-suspenders pre-field check) ──────────
  const rawLower = raw.toLowerCase();
  if (rawLower.includes('<script')) {
    return ve('File contains script content — rejected for security');
  }
  if (rawLower.includes('javascript:')) {
    return ve('File contains javascript: URI — rejected for security');
  }
  if (/data:(?!image\/(png|jpeg|gif|webp))[a-z\-]+\//.test(rawLower)) {
    return ve('File contains a disallowed data URI type — only raster image data URIs are allowed');
  }

  // ── 6. Validate each layer ────────────────────────────────────────────────
  const sanitised: DesignLayer[] = [];
  for (let i = 0; i < parsed.layers.length; i++) {
    const result = validateOneLayer(parsed.layers[i], i);
    if ('ok' in result) return result;
    sanitised.push(result);
  }

  return { ok: true, layers: sanitised };
}
