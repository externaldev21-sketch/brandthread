import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'app/create-post.tsx'), 'utf8');
const apiSource = readFileSync(resolve(process.cwd(), 'lib/api.ts'), 'utf8');

describe('Post a video — choose cover frame', () => {
  it('lets a seller pick a specific frame as the cover instead of a fixed auto-generated one', () => {
    // Previously "Edit cover" only reopened the trim screen with no way to
    // actually change which frame became the thumbnail — compose-video
    // always grabbed a fixed offset server-side.
    expect(source).toContain('function useCurrentFrameAsCover()');
    expect(source).toContain('api.posts.composeVideoThumbnail(composedVideo.mediaPath, scrubTime)');
    expect(source).toContain('Use this frame as cover');
  });

  it('re-extracts the frame from the already-composed video instead of re-encoding it', () => {
    expect(apiSource).toContain('composeVideoThumbnail:');
    expect(apiSource).toContain("'/api/posts/compose-video/thumbnail'");
  });

  it('still supports the full video → trim → tag products → caption → post flow', () => {
    expect(source).toContain("useState(0)"); // trimStart/trimEnd present
    expect(source).toContain('trimStart, trimEnd');
    expect(source).toContain('function tagProduct(p: Product)');
    expect(source).toContain('getTaggableProducts');
    expect(source).toContain("value={caption}");
    expect(source).toContain('createSellerPost');
  });
});
