/** Reviews with photos first, each group keeping the server's order (item 138). */
export function orderPhotoFirst<T extends { photos?: string[] | null }>(reviews: T[]): T[] {
  return [...reviews.filter(r => (r.photos?.length ?? 0) > 0), ...reviews.filter(r => !(r.photos?.length))];
}
