/**
 * Live shopping — provider-agnostic types.
 *
 * Everything the LIVE pager renders goes through `LiveStreamProvider`. There
 * are exactly two implementations today:
 *
 *   - `createPreviewLiveProvider` (lib/live/previewLiveProvider.ts): a fully
 *     local, zero-network provider used in dev web preview
 *     (`?bt_preview=buyer` / `?bt_preview=seller`). It loops the bundled
 *     runway clips as "streams", ticks viewer counts, and plays a scripted
 *     chat so the whole experience is reviewable with no services.
 *   - `createApiLiveProvider` (lib/live/apiLiveProvider.ts): the real backend
 *     (`/api/live/*`). Listing, chat and viewer counts are real (polling —
 *     the repo has no websocket/realtime transport). Video is NOT: the
 *     backend hands out Agora tokens, but rendering Agora needs the native
 *     `react-native-agora` SDK plus AGORA_APP_ID/AGORA_APP_CERTIFICATE,
 *     which are not configured. See `LiveVideoSource.kind === 'rtc'`.
 *
 * To plug in a real streaming vendor (Mux / LiveKit / Agora / Cloudflare
 * Stream), implement this interface and return it from the single factory
 * in lib/live/liveProvider.ts. Nothing in the UI knows which provider it is
 * talking to.
 */
import type { ImageSourcePropType } from 'react-native';

/** What the pager page actually plays. */
export type LiveVideoSource =
  /** A plain playable video (HLS/MP4 URL or a bundled module) — preview
   *  streams, and the shape an HLS-based vendor (Mux, Cloudflare Stream,
   *  LiveKit egress) would return. Played with expo-video. */
  | { kind: 'video'; source: number | string; posterSource?: ImageSourcePropType; posterUri?: string | null }
  /** A WebRTC room that needs a native SDK to render (the existing Agora
   *  backend). The pager shows the poster + an "open in player" affordance
   *  until a real SDK-backed renderer is plugged in. */
  | { kind: 'rtc'; vendor: 'agora'; posterUri?: string | null };

export interface LiveHost {
  id: string;
  name: string;
  handle: string;
  initials: string;
  avatarColor: string;
  avatarUri?: string | null;
  verified: boolean;
}

export interface LiveProduct {
  productId: string;
  name: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  imageUri?: string | null;
  sizes?: string[];
  remainingUnits?: number | null;
}

export interface LiveChatMessage {
  id: string;
  userId?: string;
  username: string;
  text: string;
  /** Epoch ms. */
  at: number;
  /** Host / system messages render slightly differently. */
  kind?: 'chat' | 'host' | 'join' | 'purchase';
}

export interface LiveViewerAvatar {
  id: string;
  initials: string;
  color: string;
  uri?: string | null;
}

export interface LiveStream {
  id: string;
  host: LiveHost;
  title: string;
  viewerCount: number;
  likeCount: number;
  startedAt: number;
  /** Viewer follows this host — used for ordering (followed first). */
  followedByViewer: boolean;
  products: LiveProduct[];
  /** productId of the item currently being sold (pinned card), if any. */
  pinnedProductId: string | null;
  topViewers: LiveViewerAvatar[];
  video: LiveVideoSource;
}

export interface UpcomingLive {
  id: string;
  host: LiveHost;
  title: string;
  /** Epoch ms. */
  startsAt: number;
  reminderSet: boolean;
}

export interface SuggestedCreator {
  host: LiveHost;
  followerCount: number;
  following: boolean;
}

/** Everything that can change on a stream while it is being watched. */
export type LiveEvent =
  | { type: 'viewers'; streamId: string; viewerCount: number }
  | { type: 'likes'; streamId: string; likeCount: number }
  | { type: 'chat'; streamId: string; messages: LiveChatMessage[] }
  | { type: 'pinned'; streamId: string; productId: string | null }
  | { type: 'ended'; streamId: string };

export type LiveEventListener = (event: LiveEvent) => void;

export interface LiveJoinResult {
  /** Present when joining succeeded; the pager keeps showing the stream's
   *  own `video` source either way. */
  ok: boolean;
  /** Last few chat messages so the overlay isn't empty on join. */
  recentChat: LiveChatMessage[];
}

export interface StartLiveInput {
  title: string;
  productIds: string[];
}

/**
 * The single seam between the LIVE UI and whatever actually moves the
 * video/chat. A real vendor implementation replaces how `video`, `join`,
 * `subscribe` and `sendChat` work; the UI stays the same.
 */
export interface LiveStreamProvider {
  readonly id: 'preview' | 'api';
  /** Currently-live streams, ordered followed-first then by viewer count. */
  listLive(): Promise<LiveStream[]>;
  listUpcoming(): Promise<UpcomingLive[]>;
  listSuggestedCreators(): Promise<SuggestedCreator[]>;
  join(streamId: string): Promise<LiveJoinResult>;
  leave(streamId: string): Promise<void>;
  /** Realtime updates for one stream (viewer count, chat, pinned product,
   *  ended). Returns an unsubscribe function. */
  subscribe(streamId: string, listener: LiveEventListener): () => void;
  sendChat(streamId: string, text: string): Promise<LiveChatMessage>;
  sendLike(streamId: string): Promise<void>;
  setReminder(upcomingId: string, on: boolean): Promise<void>;
  setFollowing(hostId: string, following: boolean): Promise<void>;
  /** Host side. */
  start(input: StartLiveInput): Promise<{ streamId: string }>;
  stop(streamId: string): Promise<void>;
}
