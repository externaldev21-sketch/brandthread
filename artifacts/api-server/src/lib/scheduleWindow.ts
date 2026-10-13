/**
 * Shared parsing for seller "active dates" (discount codes + automatic sales).
 * Instants arrive as ISO strings (the app converts the seller's wall-clock
 * date + time to UTC); the IANA zone they were picked in is stored alongside
 * so the edit form can show the same wall clock again.
 */

/** undefined = field not sent, null = cleared, Date = valid instant, "invalid" = unparseable. */
export function parseInstant(v: unknown): Date | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return "invalid";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** undefined = not sent, null = cleared, string = valid zone, "invalid" otherwise. */
export function parseTimeZone(v: unknown): string | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return isValidTimeZone(v) ? v : "invalid";
}
