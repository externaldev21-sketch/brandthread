/**
 * Notice under the location search field. The server adds Google Places
 * suggestions only when it has GOOGLE_PLACES_API_KEY (reported back as
 * `providerEnabled` on /api/places/search). Without it, only places someone has
 * already tagged are searchable — say so, and point at the free-text
 * "Add …" custom location row, instead of silently showing few/no results.
 */
export function locationSearchNotice(opts: { query: string; providerEnabled: boolean | null; searching: boolean }): string | null {
  const q = opts.query.trim();
  if (!q || opts.searching || opts.providerEnabled !== false) return null;
  return `Only places someone has already tagged are searchable right now. You can still add “${q}” as a custom location.`;
}
