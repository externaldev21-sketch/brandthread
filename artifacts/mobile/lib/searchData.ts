// Shared, searchable catalogue of brands + products for the buyer "Search" screen.
// Consolidates mock data referenced across Home / Feed / Profile so search results
// stay consistent with what the buyer sees elsewhere in the app.


export interface SearchProduct {
  id: string;
  kind: 'product';
  brand: string;
  name: string;
  priceCents: number;
  color: string;
  initials: string;
  imageUri?: string;
}

export interface SearchBrand {
  id: string;
  kind: 'brand';
  name: string;
  handle: string;
  color: string;
  initials: string;
}

export interface SearchVideo {
  id: string;
  kind: 'video';
  postId: string;
  caption: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
  color: string;
  initials: string;
  likesCount: number;
}

export type SearchResult = SearchProduct | SearchBrand | SearchVideo;

export interface SearchCategory {
  category: string;
  productCount: number;
  imageUri: string | null;
  color: string;
}

// ─── Search-empty-state data (from /api/public/search/trending + /suggested) ──

export interface TrendingTerm {
  term: string;
  type: 'category' | 'brand' | 'query';
}

export interface SuggestedBrand {
  id: string;
  sellerId: string;
  name: string;
  handle: string;
  color: string;
  initials: string;
  followerCount: number;
}

export interface SuggestedProduct {
  id: string;
  productId: string;
  name: string;
  brand: string;
  category: string;
  imageUri: string | null;
  color: string;
  initials: string;
}
