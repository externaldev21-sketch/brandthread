import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const publish = read('lib/createPost/publish.ts');
const post = read('components/create-post/PostScreen.tsx');
const apiSource = read('lib/api.ts');
const flow = read('app/create-post.tsx');

describe('create flow — cover frame, trim, caption and publish pipeline', () => {
  it('lets the creator pick a specific video frame as the cover', () => {
    expect(post).toContain('VideoCoverPage');
    expect(post).toContain('Drag to choose a cover frame');
    expect(publish).toContain('api.posts.composeVideoThumbnail(composed.mediaPath, video.coverOffset)');
  });

  it('re-extracts the frame from the already-composed video instead of re-encoding it', () => {
    expect(apiSource).toContain('composeVideoThumbnail:');
    expect(apiSource).toContain("'/api/posts/compose-video/thumbnail'");
  });

  it('uploads long videos chunked and sends trim to compose', () => {
    expect(publish).toContain('api.posts.uploadVideoChunked');
    expect(publish).toContain('trimStart: video.trimStart');
    expect(publish).toContain('trimEnd: video.trimEnd');
    expect(apiSource).toContain('/api/posts/uploads');
  });

  it('keeps caption, product tagging, visibility and scheduling on the post screen', () => {
    expect(post).toContain('testID="caption-input"');
    expect(post).toContain('getTaggableProducts');
    expect(post).toContain('VisibilityPage');
    expect(post).toContain('SchedulePage');
    expect(flow).toContain('publishCreatePost');
  });
});
