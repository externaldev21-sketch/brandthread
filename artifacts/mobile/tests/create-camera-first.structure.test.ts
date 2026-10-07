import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const createPost = readFileSync(resolve(process.cwd(), 'app/create-post.tsx'), 'utf8');
const camera = readFileSync(resolve(process.cwd(), 'components/create-post/CreateCamera.tsx'), 'utf8');

/**
 * Camera-first Create screen: the seller's Create entry opens straight into
 * a live camera, with the existing picker kept intact underneath it.
 */
describe('camera-first Create screen wiring', () => {
  it('opens a fresh Thread in the camera step and keeps the edit entry unchanged', () => {
    expect(createPost).toContain("useState<Step>(editId ? 'post' : noCameraStep ? 'gallery' : 'capture')");
    expect(createPost).toContain("step === 'capture'");
    expect(createPost).toContain('<CreateCamera');
  });

  it('keeps the existing picker (All/Videos/Photos grid) and opens it as a sheet from the camera roll', () => {
    expect(createPost).toContain("step === 'gallery'");
    expect(createPost).toContain('<GalleryPicker');
    expect(createPost).toContain('<PostPicker');
    expect(createPost).toContain("onOpenLibrary={() => setStep('gallery')}");
    expect(createPost).toContain("setStep('capture')");
  });

  it('routes a capture into the existing editor steps', () => {
    expect(createPost).toContain("setStep('edit')");
    expect(createPost).toContain("kind: 'slides', slides");
    expect(createPost).toContain("kind: 'video'");
    expect(createPost).toContain("onPhoto={(uri) => buildFromAssets(");
    expect(createPost).toContain("onVideo={(uri, duration) => buildFromAssets(");
    // Snapped photos get the same 3:4 crop pass as picked ones.
    expect(createPost).toContain('aspect: DEFAULT_SLIDE_ASPECT');
    expect(readFileSync(resolve(process.cwd(), 'constants/postLimits.ts'), 'utf8')).toContain("DEFAULT_SLIDE_ASPECT: PostAspect = '3:4'");
    expect(readFileSync(resolve(process.cwd(), 'lib/createPost/slides.ts'), 'utf8')).toContain('crop: DEFAULT_SLIDE_CROP');
  });

  it('switches Story in place through the same story composer handoff as the picker pill', () => {
    expect(createPost).toContain("if (next === 'story')");
    expect(createPost).toContain("router.replace('/buyer-story-create' as never)");
  });

  it('camera chrome: X + mode title float on top, right rail, chips, shutter, roll, flip', () => {
    for (const id of [
      'create-camera-close', 'create-camera-mode-title', 'create-camera-mode-menu',
      'create-camera-timer', 'create-camera-chips', 'create-camera-shutter',
      'create-camera-roll', 'create-camera-flip',
    ]) expect(camera).toContain(`testID="${id}"`);
    expect(camera).toContain('useHideTabBar();');
    expect(camera).toContain('useCameraPermissions');
    expect(camera).toContain('useMicrophonePermissions');
    // Recording state is LIVE red only; everything else is theme black/white/silver.
    expect(camera).toContain("import { LIVE_RED } from '@/components/live/LiveAvatarRing';");
    expect(camera).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Press-and-hold and tap both drive the shutter.
    expect(camera).toContain('onLongPress={handleShutterLongPress}');
    expect(camera).toContain('onPressOut={handleShutterPressOut}');
  });
});
