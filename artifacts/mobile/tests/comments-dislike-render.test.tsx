/**
 * Rendered dislike interaction: mounts the real CommentRow inside a harness
 * that uses the screen's own optimistic/rollback helpers against a mocked
 * api.comments.dislike, for both a root and a reply row.
 */
import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
vi.mock('@/components/KeyboardProviderCompat', () => ({
  KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) => children,
  KeyboardGestureArea: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('@/components/ui/Composer', () => ({ default: () => null }));
vi.mock('@/components/ui/KeyboardAccessoryBar', () => ({ KeyboardAccessoryBar: () => null, keyboardAccessoryID: (id: string) => id }));
vi.mock('@/components/translation/CaptionTranslation', () => ({
  useCaptionTranslation: (body: string) => ({ text: body }),
  TranslationLink: () => null,
}));
vi.mock('@/components/comments/CommentPhoto', () => ({
  CommentPhotoDraft: () => null, CommentPhotoView: () => null, useCommentPhotoDraft: () => ({}),
}));

const mod = await import('../app/buyer-post-comments');
const { CommentRow, applyOptimisticDislike, applyOptimisticLike, restoreReaction } = mod;

type R = { liked: boolean; disliked: boolean; likesCount: number };

function makeRow(id: string, isReply: boolean, liked: boolean) {
  return {
    id, isReply, body: 'nice fit', createdAt: new Date().toISOString(),
    author: { userId: `u-${id}`, name: `user ${id}`, initials: 'U', avatarUrl: null },
    likedByMe: liked, dislikedByMe: false, likesCount: liked ? 5 : 4,
    replies: [], mentions: [], isMine: false, canDelete: false, pendingReview: false,
  } as never;
}

function Harness({ dislike }: { dislike: (id: string, d: boolean) => Promise<R> }) {
  const [rows, setRows] = useState<any[]>([makeRow('root', false, true), makeRow('reply', true, false)]);
  const onDislike = async (c: any) => {
    const next = !c.dislikedByMe;
    setRows((p) => p.map((r) => (r.id === c.id ? applyOptimisticDislike(r, next) : r)));
    try {
      const res = await dislike(c.id, next);
      setRows((p) => p.map((r) => (r.id === c.id ? { ...r, dislikedByMe: res.disliked, likedByMe: res.liked, likesCount: res.likesCount } : r)));
    } catch {
      setRows((p) => p.map((r) => (r.id === c.id ? restoreReaction(r, c) : r)));
    }
  };
  return <>{rows.map((r) => (
    <CommentRow key={r.id} comment={r} postAuthorId="" onLike={() => {}} onDislike={onDislike} onReply={() => {}} onMore={() => {}} />
  ))}</>;
}

const press = (tree: ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props.testID === `comment-dislike-${id}` && typeof n.props.onPress === 'function').props.onPress();
const label = (tree: ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props.testID === `comment-dislike-${id}` && typeof n.props.onPress === 'function').props.accessibilityLabel;

describe('rendered comment dislike', () => {
  it('optimistically dislikes a liked root row and hydrates from the server', async () => {
    let resolve!: (r: R) => void;
    const dislike = vi.fn(() => new Promise<R>((res) => { resolve = res; }));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Harness dislike={dislike} />); });
    await act(async () => { press(tree, 'root'); });
    expect(label(tree, 'root')).toBe('Remove dislike');
    expect(dislike).toHaveBeenCalledWith('root', true);
    await act(async () => { resolve({ disliked: true, liked: false, likesCount: 4 }); });
    expect(label(tree, 'root')).toBe('Remove dislike');
  });

  it('rolls a reply row back when the request fails', async () => {
    const dislike = vi.fn(() => Promise.reject(new Error('offline')));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Harness dislike={dislike} />); });
    await act(async () => { press(tree, 'reply'); });
    expect(dislike).toHaveBeenCalledWith('reply', true);
    expect(label(tree, 'reply')).toBe('Dislike comment');
  });

  it('pure helpers: liking clears dislike; disliking drops an active like', () => {
    const base = { likedByMe: true, dislikedByMe: false, likesCount: 5 };
    const d = applyOptimisticDislike(base, true);
    expect(d).toMatchObject({ likedByMe: false, dislikedByMe: true, likesCount: 4 });
    expect(applyOptimisticLike(d, true)).toMatchObject({ likedByMe: true, dislikedByMe: false, likesCount: 5 });
    expect(restoreReaction(d, base)).toMatchObject(base);
  });
});
