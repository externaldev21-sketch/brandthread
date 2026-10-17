/**
 * Small display helpers for Your Activity (app/buyer-your-activity.tsx).
 */

/** First line of a caption / comment, trimmed to a list-row length. */
export function activitySnippet(text: string | null | undefined, max = 60): string {
  const line = (text ?? '').split('\n').map(part => part.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "Oct 17" (this year) or "Oct 17, 2025"; '' for an unparseable date. */
export function activityDateLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The searches endpoint returns at most `cap` distinct terms, so a full page
 * reads "30+" rather than claiming an exact total.
 */
export function searchCountLabel(count: number, cap: number): string {
  return count >= cap ? `${cap}+` : String(count);
}
