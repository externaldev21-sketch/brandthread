/**
 * Interest picker photos (onboarding, Pinterest's "What are you interested
 * in?" tile grid). Each tile shows a real product photo found by searching
 * the catalogue for that interest — never a stand-in picture. No match
 * means a plain tile.
 */
type SearchResult = { kind?: string; imageUri?: string | null };

/** First public product photo (http/https) in a search response, or null. */
export function pickInterestPhoto(results: readonly SearchResult[] | null | undefined): string | null {
  for (const r of results ?? []) {
    if (r?.kind !== 'product') continue;
    const uri = r.imageUri;
    if (typeof uri === 'string' && /^https?:\/\//i.test(uri)) return uri;
  }
  return null;
}

/**
 * Up to `max` distinct product photos (http/https) across several search
 * responses, taking one from each in turn so every interest shows up.
 */
export function pickFeedPreviewPhotos(responses: readonly (readonly SearchResult[] | null | undefined)[], max = 6): string[] {
  const lists = responses.map((results) => (results ?? [])
    .filter((r) => r?.kind === 'product' && typeof r.imageUri === 'string' && /^https?:\/\//i.test(r.imageUri))
    .map((r) => r.imageUri as string));
  const out: string[] = [];
  for (let round = 0; out.length < max && lists.some((l) => l.length > round); round += 1) {
    for (const list of lists) {
      const uri = list[round];
      if (uri && !out.includes(uri)) out.push(uri);
      if (out.length >= max) break;
    }
  }
  return out;
}
