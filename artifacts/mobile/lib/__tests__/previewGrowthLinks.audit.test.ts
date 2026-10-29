import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ demo: false }));
vi.mock('../devPreview', () => ({ isPreviewDemoMode: () => flags.demo }));

let growth: typeof import('../previewGrowth')['previewGrowth'];

beforeEach(async () => {
  vi.resetModules();
  flags.demo = false;
  growth = (await import('../previewGrowth')).previewGrowth;
});

describe('previewGrowth tracked links follow the URL-only demo mode', () => {
  it('a fresh page first never leaves a later demo page without its demo links', async () => {
    expect(await growth.listLinks()).toEqual([]);
    flags.demo = true;
    expect((await growth.listLinks()).map((l) => l.id)).toEqual(['demo-link-1', 'demo-link-2', 'demo-link-3']);
  });

  it('a demo page first never leaks its demo links into a later fresh page', async () => {
    flags.demo = true;
    expect((await growth.listLinks()).length).toBe(3);
    flags.demo = false;
    expect(await growth.listLinks()).toEqual([]);
  });

  it('links created in one mode stay while the mode is unchanged', async () => {
    await growth.createLink({ label: 'Mine', destinationType: 'store', destinationRef: null, utmSource: 'x', utmMedium: 'y', utmCampaign: '' } as never);
    expect((await growth.listLinks()).map((l) => l.label)).toEqual(['Mine']);
  });
});
