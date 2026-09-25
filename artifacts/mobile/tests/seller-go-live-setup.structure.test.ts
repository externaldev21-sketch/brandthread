import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'app/seller-go-live.tsx'), 'utf8');
const liveScreen = readFileSync(resolve(process.cwd(), 'app/seller-live.tsx'), 'utf8');

describe('Go Live setup screen (camera-first)', () => {
  it('opens straight onto a full-bleed front camera preview', () => {
    expect(source).toContain("useState<'front' | 'back'>('front')");
    expect(source).toContain('<CameraView');
    expect(source).toContain('facing={facing}');
    expect(source).toContain('StyleSheet.absoluteFill');
  });

  it('requests camera and microphone permission as soon as the screen opens', () => {
    expect(source).toContain('useCameraPermissions()');
    expect(source).toContain('useMicrophonePermissions()');
    expect(source).toContain('requestCameraPermission()');
    expect(source).toContain('requestMicPermission()');
  });

  it('shows a clean allow/settings prompt instead of a broken screen when permissions are denied', () => {
    expect(source).toContain('Allow camera');
    expect(source).toContain('Linking.openSettings()');
    expect(source).toContain('canAskAgain === false');
  });

  it('provides a close button, camera flip, and flash toggle only on the back camera', () => {
    expect(source).toContain("accessibilityLabel=\"Close\"");
    expect(source).toContain('flipCamera');
    expect(source).toContain("facing === 'back' &&");
    expect(source).toContain('enableTorch={facing === \'back\' && torch}');
  });

  it('keeps title required and description optional, with Go Live disabled until title is filled', () => {
    expect(source).toContain('placeholder="Add a title…"');
    expect(source).toContain('placeholder="Add a description (optional)…"');
    expect(source).toContain('disabled={starting || !title.trim()}');
  });

  it('degrades gracefully on web instead of showing a broken camera view', () => {
    expect(source).toContain("Platform.OS === 'web'");
    expect(source).toContain('NativeOnlyFeature');
  });

  it('passes title, description, and the chosen camera into the live broadcast flow', () => {
    expect(source).toContain('(api as any).live.start({');
    expect(source).toContain('title: title.trim()');
    expect(source).toContain("description: description.trim() || undefined");
    expect(source).toContain("pathname: '/seller-live'");
    expect(source).toContain('facing,');
  });

  it('matches the broadcast camera to whichever camera was already previewing', () => {
    expect(liveScreen).toContain("params.facing === 'front'");
    expect(liveScreen).toContain('engine.switchCamera()');
  });
});
