/**
 * Release notes shown on the in-app Change log (app/changelog.tsx, also
 * https://brandthread.app/changelog on the web). Newest first. Add an entry
 * with each store release — the screen shows an honest empty state until then.
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date, e.g. "2026-11-01". */
  date: string;
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [];

export function sortedChangelog(entries: ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}
