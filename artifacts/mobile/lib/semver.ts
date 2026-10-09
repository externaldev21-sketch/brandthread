/**
 * Minimal, dependency-free version comparison for app version strings
 * ("1.4.2", "v2.0", "1.5.0-beta.1"). Used by the force-update gate.
 *
 * Unparseable input never causes a block: callers treat `null` as "unknown"
 * and fail open.
 */

export type ParsedVersion = { core: [number, number, number]; pre: string[] };

const VERSION_RE = /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: unknown): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const match = VERSION_RE.exec(raw.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ? match[4].split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any pre-release of the same core version.
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** -1 / 0 / 1 like a sort comparator, or null when either side is not a version. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  const pre = comparePre(x.pre, y.pre);
  return pre === 0 ? 0 : pre < 0 ? -1 : 1;
}

/** True only when both versions parse and `current` is strictly older than `minimum`. */
export function isVersionBelow(current: unknown, minimum: unknown): boolean {
  return compareVersions(current, minimum) === -1;
}
