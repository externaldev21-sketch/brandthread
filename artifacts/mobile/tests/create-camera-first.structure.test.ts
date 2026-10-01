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
    expect(createPost).toContain("type Step = 'camera' | 'media-pick'");
    expect(createPost).toContain("const cameraFirst = !editId;");
    expect(createPost).toContain("useState<Step>(cameraFirst ? 'camera' : 'media-pick')");
    expect(createPost).toContain("if (step === 'camera')");
    expect(createPost).toContain('<CreateCamera');
  });

  it('keeps the existing picker (All/Videos/Photos grid) and opens it as a sheet from the camera roll', () => {
    expect(createPost).toContain("if (step === 'media-pick')");
    expect(createPost).toContain('<MediaGrid');
    expect(createPost).toContain('const PickerRoot = cameraFirst ? SheetRise : View;');
    expect(createPost).toContain("onOpenLibrary={() => haptic(() => setStep('media-pick'))}");
    expect(createPost).toContain("haptic(cameraFirst ? () => setStep('camera') : leaveSetupDestination)");
  });

  it('routes a capture into the existing editor steps', () => {
    expect(createPost).toContain("setStep('slide-edit');");
    expect(createPost).toContain("setStep('video-edit');");
    expect(createPost).toContain('onPhoto={handleCameraPhoto}');
    expect(createPost).toContain('onVideo={handleCameraVideo}');
    // Snapped photos get the same 3:4 crop pass as picked ones.
    expect(createPost).toMatch(/function handleCameraPhoto[\s\S]*setCropQueue\(\[id\]\);[\s\S]*setCropTargetId\(id\);/);
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
