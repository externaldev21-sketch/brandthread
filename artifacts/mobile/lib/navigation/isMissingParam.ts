/** True for a route param that carries no usable id ("", "undefined", arrays of those). */
export function isMissingParam(value: string | string[] | undefined | null): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return true;
  const trimmed = String(v).trim();
  return trimmed === '' || trimmed === 'undefined' || trimmed === 'null';
}
