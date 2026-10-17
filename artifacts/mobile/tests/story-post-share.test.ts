import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storyPostShareHref, storyPostShareSeed } from '@/lib/storyPostShare';

const ID = '3f2b8c1e-9a4d-4e6b-8c2a-1d5e7f9a0b3c';
const composer = readFileSync(resolve(process.cwd(), 'app/buyer-story-create.tsx'), 'utf8');
const sheet = readFileSync(resolve(process.cwd(), 'components/ThreadShareSheet.tsx'), 'utf8');

describe('Add to Story post handoff', () => {
  it('routes only a UUID post id', () => {
    expect(storyPostShareHref(ID)).toBe(`/buyer-story-create?sharePostId=${ID}`);
    expect(storyPostShareHref('demo-1')).toBeNull();
    expect(sheet).toContain('router.push(href as never)');
    expect(sheet).toContain('storyPostShareHref(postId)');
    expect(sheet).not.toContain("isn't supported yet");
  });

  it('refuses posts without server reshare permission', () => {
    const base = { id: ID, mediaType: 'photo', mediaUrls: ['https://cdn/x.jpg'], caption: 'fit' };
    expect(storyPostShareSeed(base, ID)).toEqual({ ok: false, reason: 'not_shareable' });
    expect(storyPostShareSeed({ ...base, canReshareToStory: false }, ID)).toEqual({ ok: false, reason: 'not_shareable' });
    expect(storyPostShareSeed(null, ID)).toEqual({ ok: false, reason: 'not_found' });
    expect(storyPostShareSeed({ ...base, id: 'other', canReshareToStory: true }, ID)).toEqual({ ok: false, reason: 'not_found' });
    expect(storyPostShareSeed({ ...base, deletedAt: 1, canReshareToStory: true }, ID)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('seeds from authoritative data with poster and canonical link', () => {
    const r = storyPostShareSeed({ id: ID, canReshareToStory: true, mediaType: 'video', mediaUrl: 'https://cdn/v.mp4', thumbnailUrl: 'https://cdn/p.jpg', caption: ' hi ', seller: { brandName: 'Acme' } }, ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.seed.imageUri).toBe('https://cdn/p.jpg');
    expect(r.seed.postUrl).toMatch(new RegExp(`/p/${ID}$`));
    expect(r.seed.creatorName).toBe('Acme');
    expect(r.seed.caption).toBe('hi');
  });

  it('composer fetches the post, seeds card/link/caption, and guards account + errors', () => {
    expect(composer).toContain('sharePostId?: string');
    expect(composer).toContain('storyPostShareSeed(await api.posts.get(sharePostId), sharePostId)');
    expect(composer).toContain("id: 'ov_shared_post_link', type: 'link'");
    expect(composer).toContain('linkUrl: seed.postUrl');
    expect(composer).toContain('[api, sharePostId, sharePostOwner, topInset]');
    expect(composer).toContain('if (cancelled) return;');
    expect(composer).toContain("'Post unavailable'");
    expect(composer).toContain('isPosting || reshareUnavailable || sharedPostPending');
    expect(composer).toContain('originalStoryId: reshareStoryId');
  });

  it('sheet leaves repost toasts to the parent', () => {
    expect(sheet).not.toContain("'Reposted'");
    expect(sheet).not.toContain("'Repost removed'");
  });
});
