import type { PostAspect, PostMode } from '@/constants/postLimits';
import type { SlideCrop } from '@/lib/createPost/crop';
import type { Adjust } from '@/lib/createPost/adjust';
import type { PostProductTag, PostVisibility } from '@/services/types';

/** One item from the device library (or, on web, a file the user chose). */
export interface PickedAsset {
  id: string;
  uri: string;
  kind: 'photo' | 'video';
  /** Seconds; 0 for photos. */
  duration: number;
  width?: number;
  height?: number;
  mimeType?: string | null;
}

export interface SlideDraft {
  id: string;
  /** THREAD slideshows are photos only; POST carousels mix photos and videos. */
  kind: 'photo' | 'video';
  /** The uncropped original — crops are always applied from this, never re-cropped. */
  uri: string;
  mimeType?: string | null;
  width: number;
  height: number;
  crop: SlideCrop;
  /** Filter / Edit tools (POST). */
  adjust: Adjust;
  /** Video slides only (seconds). */
  duration: number;
  trimStart: number;
  trimEnd: number;
}

export interface VideoDraft {
  uri: string;
  mimeType?: string | null;
  /** Source length in seconds. */
  duration: number;
  speed: 0.5 | 1 | 2 | 3;
  /** Trim window in (post-speed) seconds. */
  trimStart: number;
  trimEnd: number;
  /** Cover frame offset in seconds (post-trim timeline); 0 = first frame. */
  coverOffset: number;
  /** Already uploaded (a remix's copied source clip): publish skips the upload. */
  objectPath?: string;
}

export type MediaDraft =
  | { kind: 'video'; video: VideoDraft }
  | { kind: 'slides'; slides: SlideDraft[]; aspect: PostAspect; coverIndex: number };

export interface PostDetails {
  caption: string;
  productTags: PostProductTag[];
  visibility: PostVisibility;
  scheduledAt: string | null;
}

export interface PublishInput {
  mode: PostMode;
  media: MediaDraft;
  details: PostDetails;
  isDraft: boolean;
  /** `?remixOf=` — the video post this one remixes (server re-checks permission). */
  remixOfPostId?: string;
}
