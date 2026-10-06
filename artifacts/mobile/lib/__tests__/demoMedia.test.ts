import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('demo media', () => {
  it('is same-origin on web and the web host on native', async () => {
    const { demoMediaBaseUrl } = await import('@/lib/demoMedia');
    expect(demoMediaBaseUrl('web', undefined)).toBe('/demo-media');
    expect(demoMediaBaseUrl('ios', undefined)).toBe('https://brandthread.app/demo-media');
  });
  it('uses a CDN base when configured', async () => {
    const { demoMediaBaseUrl, demoRunwayVideoUri } = await import('@/lib/demoMedia');
    expect(demoMediaBaseUrl('ios', 'https://cdn.example.com/demo/')).toBe('https://cdn.example.com/demo');
    expect(demoRunwayVideoUri(3, 'https://cdn.example.com/demo')).toBe('https://cdn.example.com/demo/fashion_runway_03.mp4');
  });
  it('lists the ten clips that exist in public/demo-media', async () => {
    const { DEMO_RUNWAY_VIDEO_URIS } = await import('@/lib/demoMedia');
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(DEMO_RUNWAY_VIDEO_URIS).toHaveLength(10);
    for (const uri of DEMO_RUNWAY_VIDEO_URIS) {
      const file = path.join(__dirname, '../../public/demo-media', uri.split('/').pop()!);
      expect(fs.existsSync(file), file).toBe(true);
    }
  });
  it('no app source bundles a demo .mp4 with require()', async () => {
    const { execSync } = await import('node:child_process');
    const path = await import('node:path');
    const root = path.join(__dirname, '../..');
    const hits = execSync(
      "grep -rln --exclude-dir=__tests__ --include=*.ts --include=*.tsx \"require(.*assets/videos/.*\\.mp4\" app lib components hooks services contexts || true",
      { cwd: root, encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('');
  });
});
