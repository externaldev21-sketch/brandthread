/**
 * Seed data for the comments sheet in `?bt_preview` mode. Real published
 * posts have real comments from the server; preview/demo posts (whose ids
 * fail the server's UUID check, see UUID_RE in buyer-post-comments.tsx)
 * have no backing post row to fetch comments for — this used to mean a
 * dead-end "Preview content…" empty state with a locked composer. Instead,
 * every preview post now gets 8-15 realistic seeded comments (fit/sizing
 * questions, "where'd you get that", a creator reply mixed in, one comment
 * the creator has liked), and posting a new comment actually appends it to
 * local state so the preview never hits that dead end again.
 */
import { Asset } from 'expo-asset';
import type { ThreadComment, ProfileSummary } from '@/lib/safetyTypes';

export interface PreviewComment extends ThreadComment {
  /** Shown as a small "creator liked" badge — not part of the real API shape. */
  creatorLiked?: boolean;
  replies: PreviewComment[];
}

// Same bundled-asset-as-stand-in-photo convention as lib/previewActivity.ts /
// lib/previewCatalog.ts / lib/previewInbox.ts: every preview comment gets a
// real (if generic) photo avatar instead of a bare initials circle, with no
// network dependency.
const AVATAR_SOURCES = [
  require('../assets/videos/fashion_runway_01.jpg'),
  require('../assets/videos/fashion_runway_02.jpg'),
  require('../assets/videos/fashion_runway_03.jpg'),
  require('../assets/videos/fashion_runway_04.jpg'),
  require('../assets/videos/fashion_runway_05.jpg'),
  require('../assets/videos/fashion_runway_06.jpg'),
  require('../assets/videos/fashion_runway_07.jpg'),
  require('../assets/videos/fashion_runway_08.jpg'),
  require('../assets/videos/fashion_runway_09.jpg'),
  require('../assets/videos/fashion_runway_10.jpg'),
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function avatarUriFor(handle: string): string {
  return Asset.fromModule(AVATAR_SOURCES[hashString(handle) % AVATAR_SOURCES.length]).uri;
}

function profile(name: string, handle: string, color?: string): ProfileSummary {
  return {
    userId: `preview-user-${handle}`,
    name,
    handle,
    initials: name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(),
    avatarUrl: avatarUriFor(handle),
    accountType: null,
    suspended: false,
    deleted: false,
  };
}

// A fixed, hand-written pool — cycled and lightly varied per post so every
// preview post's seed reads as plausible, real conversation rather than
// obviously-looped filler.
const POOL: { name: string; handle: string; body: string; likes: number; creatorLiked?: boolean }[] = [
  { name: 'Maya Chen', handle: 'mayac', body: 'okay the fit on this is insane, need it', likes: 34, creatorLiked: true },
  { name: 'Jordan Reyes', handle: 'jreyes', body: 'what size are you wearing here? tts or size up?', likes: 12 },
  { name: 'Priya Patel', handle: 'priyap', body: 'where is this from?? been looking for something like this all week', likes: 21 },
  { name: 'Sam Okafor', handle: 'samo', body: 'the way you styled this omg', likes: 8 },
  { name: 'Lena Park', handle: 'lenap', body: 'is this true to size for someone in between M/L?', likes: 5 },
  { name: 'Diego Alvarez', handle: 'diegoa', body: 'stop it looks so good on you', likes: 17 },
  { name: 'Ava Thompson', handle: 'avat', body: 'the lighting in this video is gorgeous too', likes: 3 },
  { name: 'Noah Kim', handle: 'noahk', body: 'do you have a link for this in your bio?', likes: 9 },
  { name: 'Ines Fischer', handle: 'inesf', body: 'this brand never misses honestly', likes: 14 },
  { name: 'Marcus Webb', handle: 'marcusw', body: 'need this in every color available', likes: 6 },
  { name: 'Ruth Adeyemi', handle: 'ruth_a', body: 'how does the fabric feel, is it stretchy at all?', likes: 4 },
  { name: 'Toby Nguyen', handle: 'tobyn', body: 'saving this for later 🔥', likes: 2 },
];

const CREATOR_REPLIES = [
  'tts! runs true to size for me',
  'linked in bio now, thank you for asking!',
  'appreciate you 🙏',
  'yes it has a little stretch, comfortable all day',
  'so glad you like it!!',
];

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/**
 * Deterministic per-post seed (same post always gets the same starting
 * comments within a session) — cheap "randomness" via a string hash rather
 * than Math.random, so re-opening the same preview post doesn't reshuffle
 * comments that already look like they've "always been there".
 */
export function buildPreviewComments(postId: string, creatorName: string): PreviewComment[] {
  const seed = hashString(postId);
  const count = 8 + (seed % 8); // 8..15
  const rootCount = Math.max(5, count - 3);
  const roots: PreviewComment[] = [];

  for (let i = 0; i < rootCount; i++) {
    const entry = POOL[(seed + i * 7) % POOL.length];
    const id = `preview-comment-${postId}-${i}`;
    const hasReply = i < count - rootCount;
    const replies: PreviewComment[] = hasReply
      ? [{
          id: `${id}-reply`,
          postId,
          parentId: id,
          body: CREATOR_REPLIES[(seed + i) % CREATOR_REPLIES.length],
          createdAt: iso(5 + i),
          author: profile(creatorName, creatorName.toLowerCase().replace(/\s+/g, '')),
          likesCount: Math.max(1, Math.round(entry.likes / 6)),
          likedByMe: false,
          isMine: false,
          canDelete: false,
          pendingReview: false,
          replies: [],
        }]
      : [];
    roots.push({
      id,
      postId,
      parentId: null,
      body: entry.body,
      createdAt: iso(10 + i * 9),
      author: profile(entry.name, entry.handle),
      likesCount: entry.likes,
      likedByMe: false,
      isMine: false,
      canDelete: false,
      pendingReview: false,
      creatorLiked: entry.creatorLiked,
      replies,
    });
  }

  return roots;
}

/** The Activity notification a preview comment deep link came from. */
export interface PreviewNotificationComment {
  commentId: string;
  postId: string;
  type: string;
  body: string;
  actorName: string;
  createdAt: string;
}

/**
 * The comment(s) a seeded preview Activity row is about, so tapping
 * "Forme 22 commented on your post" / "… replied to your comment" /
 * "… mentioned you" opens the comments on exactly that comment — it has to
 * exist in the sheet to be scrolled to and highlighted. A reply also gets the
 * viewer's own comment it answers, as its parent.
 */
export function previewNotificationComments(note: PreviewNotificationComment, viewerName: string): PreviewComment[] {
  const handle = note.actorName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const base = {
    postId: note.postId,
    createdAt: note.createdAt,
    likesCount: 0,
    likedByMe: false,
    isMine: false,
    canDelete: false,
    pendingReview: false,
    replies: [] as PreviewComment[],
  };
  const actorComment: PreviewComment = {
    ...base,
    id: note.commentId,
    parentId: null,
    body: note.body,
    author: profile(note.actorName, handle),
  };
  if (note.type !== 'comment_reply') return [actorComment];
  const parentId = `${note.commentId}-parent`;
  return [{
    ...base,
    id: parentId,
    parentId: null,
    body: 'okay this one might be my favorite drop yet',
    createdAt: new Date(new Date(note.createdAt).getTime() - 30 * 60_000).toISOString(),
    author: profile(viewerName, viewerName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'you'),
    isMine: true,
    canDelete: true,
    replies: [{ ...actorComment, parentId }],
  }];
}
