import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const source = read('app/seller-go-live.tsx');
const liveScreen = read('app/seller-live.tsx');
const summary = read('app/seller-live-summary.tsx');

describe('Go live: Create your show (Whatnot)', () => {
  it('says LIVE isn\'t available yet before the seller fills anything in when the server has no Agora key', () => {
    expect(source).toContain("availability === 'unavailable'");
    expect(source).toContain('LIVE_NOT_CONFIGURED_TITLE');
    expect(source).toContain('testID="go-live-not-configured"');
  });

  it('asks for a title (with its count), a thumbnail and the products to pin, then Cancel / Next', () => {
    expect(source).toContain('placeholder="Add a title…"');
    expect(source).toContain('Show title ({title.length}/{TITLE_MAX})*');
    expect(source).toContain("showActionSheet('Add Photos'");
    expect(source).toContain("text: 'Upload Photo'");
    expect(source).toContain("text: 'Take Photo'");
    expect(source).toContain("api.productBulk.list({ status: 'active' })");
    expect(source).toContain('toLiveProductOptions(r, API_BASE_URL)');
    expect(source).toContain('if (catalog.length === 0) void loadCatalog();');
    expect(source).toContain('isLivePreviewDemo()');
    expect(source).toContain('toggleFeaturedProduct');
    expect(source).toContain('testID="go-live-next"');
  });

  it('says why Next is disabled and tells a failed product load apart from an empty store', () => {
    expect(source).toContain("'Add a title to go live.'");
    expect(source).toContain('testID="go-live-next-hint"');
    expect(source).toContain('setCatalogFailed(true)');
    expect(source).toContain('Couldn’t load your products. Close and try again.');
  });

  it('uploads the thumbnail and sends it, the title and the products to /api/live/start', () => {
    expect(source).toContain('(api as any).products.uploadImage(');
    expect(source).toContain('(api as any).live.start({');
    expect(source).toContain('thumbnailUrl: coverUrl ?? undefined');
    expect(source).toContain('productTags: featured.map(p => ({');
  });
});

describe('Go live: camera check (Whatnot pre-show)', () => {
  it('opens on a full-bleed front camera with flip, mic and shop, then one Start show pill', () => {
    expect(source).toContain("useState<'front' | 'back'>('front')");
    expect(source).toContain('<CameraView');
    expect(source).toContain('facing={facing}');
    expect(source).toContain("enableTorch={facing === 'back' && torch}");
    expect(source).toContain('testID="go-live-flip"');
    expect(source).toContain('testID="go-live-mic"');
    expect(source).toContain('testID="go-live-start"');
  });

  it('asks for camera + microphone and offers Settings when they were denied for good', () => {
    expect(source).toContain('useCameraPermissions()');
    expect(source).toContain('useMicrophonePermissions()');
    // One button asks for both, so it says both.
    expect(source).toContain('Allow camera & microphone');
    expect(source).toContain('Linking.openSettings()');
    expect(source).toContain('canAskAgain === false');
  });

  it('never starts a broadcast from the web build (the camera check still works there)', () => {
    expect(source).toContain("const canBroadcastHere = previewDemo || (Platform.OS !== 'web' && !!loadAgoraModule());");
  });

  it('hands the chosen camera and mic into the broadcast', () => {
    expect(source).toContain("pathname: '/seller-live'");
    expect(source).toContain('facing,');
    expect(source).toContain("mic:         micOn ? 'on' : 'off'");
    expect(liveScreen).toContain("params.facing === 'front'");
    expect(liveScreen).toContain('engine.switchCamera()');
  });
});

describe('Live controls and summary', () => {
  it('pins / unpins items, confirms before ending, and lands on the summary', () => {
    expect(liveScreen).toContain('(api as any).live.pin(params.streamId, productId)');
    expect(liveScreen).toContain("label: 'Unpin'");
    expect(liveScreen).toContain("showActionSheet('End show?'");
    expect(liveScreen).toContain("pathname: '/seller-live-summary'");
  });

  it('shows only the server\'s own numbers after the show', () => {
    expect(summary).toContain('(api as any).live.summary(streamId)');
    expect(summary).toContain('PEAK VIEWERS');
    expect(summary).toContain('TOTAL VIEWERS');
  });
});
