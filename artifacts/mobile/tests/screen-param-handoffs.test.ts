/**
 * Param mismatches between screens (QA-0082, QA-0113, QA-0126, QA-0115, QA-0042).
 * Pure helpers are unit tested; the screen wiring is checked structurally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickRouteParam } from '@/lib/routeParamAliases';
import { adCampaignToFormState } from '@/lib/adCampaignFormState';
import { boostPreselectPostId, findBoostTarget } from '@/lib/boostPreselect';
import {
  setPendingMockup, peekPendingMockup, takePendingMockup,
  appendProductImage, attachMockupToListedProduct,
} from '@/lib/mockupProductHandoff';
import { canvasPixelSize, buildImageLayer } from '@/lib/aiStudioCanvas';

const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('pickRouteParam', () => {
  it('returns the first non-empty value across aliases', () => {
    expect(pickRouteParam({ id: 'a' }, 'dropId', 'id')).toBe('a');
    expect(pickRouteParam({ dropId: 'b', id: 'a' }, 'dropId', 'id')).toBe('b');
    expect(pickRouteParam({ dropId: '', id: 'a' }, 'dropId', 'id')).toBe('a');
    expect(pickRouteParam({ dropId: ['c', 'd'] }, 'dropId')).toBe('c');
    expect(pickRouteParam({}, 'dropId', 'id')).toBeUndefined();
    expect(pickRouteParam(undefined, 'id')).toBeUndefined();
  });
});

describe('QA-0082 drop notification → drop detail', () => {
  it('drop detail accepts both ?dropId= and the legacy ?id=', () => {
    expect(src('app/buyer-drop-detail.tsx')).toMatch(/pickRouteParam\(routeParams, 'dropId', 'id'\)/);
  });
  it('notifications send ?dropId=', () => {
    const s = src('lib/notificationNavigation.ts');
    expect(s).toContain('/buyer-drop-detail?dropId=');
    expect(s).not.toContain('/buyer-drop-detail?id=');
  });
});

describe('QA-0113 marketing campaign row → design campaign', () => {
  it('maps a saved campaign onto the form', () => {
    const f = adCampaignToFormState({
      headline: 'Fall drop', description: null, ctaKind: 'shop_now' as any, ctaDestinationId: 'p1',
      budgetCents: 5000, durationDays: 14, mediaKind: 'photos',
      mediaObjectPaths: ['/objects/a', '/objects/b'], mediaMimeTypes: ['image/png'], mediaUrls: ['https://x/a'],
    });
    expect(f).toMatchObject({
      headline: 'Fall drop', description: '', ctaKind: 'shop_now', ctaDestId: 'p1',
      budgetCents: 5000, durationDays: 14, mediaKind: 'photos',
      mediaPaths: ['/objects/a', '/objects/b'], mediaMimes: ['image/png', 'image/jpeg'], mediaUris: ['https://x/a', ''],
    });
  });
  it('keeps defaults for missing budget/duration', () => {
    const f = adCampaignToFormState({ budgetCents: 0 } as any);
    expect(f.budgetCents).toBeNull();
    expect(f.durationDays).toBeNull();
    expect(f.mediaPaths).toEqual([]);
  });
  it('design-campaign loads ?campaignId= / ?id= instead of creating a draft', () => {
    const s = src('app/design-campaign.tsx');
    expect(s).toMatch(/pickRouteParam\(params, 'id', 'campaignId'\)/);
    expect(s).toMatch(/existingCampaignId\s*\n?\s*\?\s*await api\.adCampaigns\.get\(existingCampaignId\)\s*\n?\s*:\s*await api\.adCampaigns\.create\(\)/);
  });
});

describe('QA-0126 post analytics → boost', () => {
  it('reads targetType=post&targetId', () => {
    expect(boostPreselectPostId({ targetType: 'post', targetId: 'p9' })).toBe('p9');
    expect(boostPreselectPostId({ postId: 'p8' })).toBe('p8');
    expect(boostPreselectPostId({ targetType: 'product', targetId: 'x' })).toBeUndefined();
    expect(boostPreselectPostId({})).toBeUndefined();
  });
  it('finds the matching eligible target', () => {
    const targets = [{ id: 'a' }, { id: 'p9' }];
    expect(findBoostTarget(targets, 'p9')).toEqual({ id: 'p9' });
    expect(findBoostTarget(targets, 'zz')).toBeNull();
    expect(findBoostTarget(targets, undefined)).toBeNull();
  });
  it('boost preselects and skips to step 1', () => {
    const s = src('app/boost.tsx');
    expect(s).toContain('boostPreselectPostId(params)');
    expect(s).toMatch(/findBoostTarget\(targets, preselectPostId\)/);
    expect(s).toMatch(/if \(match\) \{\s*setSelectedTarget\(match\);\s*setStep\(1\);/);
  });
});

describe('QA-0115 mockup preview → add to product', () => {
  beforeEach(() => setPendingMockup(null));

  it('hands the captured mockup over once, per project', () => {
    setPendingMockup({ projectId: 'proj1', uri: 'data:image/png;base64,AA' });
    expect(peekPendingMockup('other')).toBeNull();
    expect(peekPendingMockup('proj1')?.uri).toBe('data:image/png;base64,AA');
    expect(takePendingMockup('proj1')?.uri).toBe('data:image/png;base64,AA');
    expect(takePendingMockup('proj1')).toBeNull();
  });

  it('appends to the server product images', async () => {
    const api = {
      products: {
        get: vi.fn().mockResolvedValue({ images: ['/objects/old'] }),
        update: vi.fn().mockResolvedValue({}),
        uploadImage: vi.fn(),
      },
    };
    await expect(appendProductImage(api, 'prod1', '/objects/new')).resolves.toEqual(['/objects/old', '/objects/new']);
    expect(api.products.update).toHaveBeenCalledWith('prod1', { images: ['/objects/old', '/objects/new'] });
  });

  it('attaches to a listed product (server + local media)', async () => {
    const api = {
      products: {
        get: vi.fn().mockResolvedValue({ images: [] }),
        update: vi.fn().mockResolvedValue({}),
        uploadImage: vi.fn().mockResolvedValue({ objectPath: '/objects/m' }),
      },
    };
    const updateLocal = vi.fn().mockResolvedValue(undefined);
    await attachMockupToListedProduct(
      { api, updateLocal, now: () => new Date('2026-01-01T00:00:00Z') },
      { id: 'prod1', media: [{ sortOrder: 0 }] },
      'data:image/png;base64,AA',
    );
    expect(api.products.uploadImage).toHaveBeenCalledWith({ uri: 'data:image/png;base64,AA', mimeType: 'image/png' });
    expect(api.products.update).toHaveBeenCalledWith('prod1', { images: ['/objects/m'] });
    expect(updateLocal.mock.calls[0][1].media[1]).toMatchObject({ uri: '/objects/m', isCover: false, sortOrder: 1, type: 'image' });
  });

  it('still patches a local-only product when the server 404s, but surfaces other errors', async () => {
    const notFound = Object.assign(new Error('nf'), { status: 404 });
    const api = {
      products: {
        get: vi.fn().mockRejectedValue(notFound),
        update: vi.fn(),
        uploadImage: vi.fn().mockResolvedValue({ objectPath: '/objects/m' }),
      },
    };
    const updateLocal = vi.fn().mockResolvedValue(undefined);
    await attachMockupToListedProduct({ api, updateLocal }, { id: 'prod_local', media: [] }, 'data:x');
    expect(updateLocal).toHaveBeenCalledTimes(1);
    expect(updateLocal.mock.calls[0][1].media[0]).toMatchObject({ uri: '/objects/m', isCover: true });

    api.products.get.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await expect(attachMockupToListedProduct({ api, updateLocal }, { id: 'p' }, 'data:x')).rejects.toThrow('boom');
  });

  it('screens are wired to the hand-off', () => {
    const preview = src('app/design-mockup-preview.tsx');
    expect(preview).toContain("showActionSheet('Add to Product'");
    expect(preview).not.toMatch(/Alert\.alert\('Add to Product'/);
    expect(preview).toContain('setPendingMockup(');
    expect(src('app/add-product.tsx')).toMatch(/takePendingMockup\(mockupProjectId\)/);
    const products = src('app/(tabs)/products.tsx');
    expect(products).toContain("params.pickForMockup === '1'");
    expect(products).toContain('attachMockupToListedProduct(');
  });
});

describe('QA-0042 AI Studio → design canvas', () => {
  it('converts preset labels to pixels', () => {
    expect(canvasPixelSize('2048 × 2048px')).toEqual({ width: 2048, height: 2048 });
    expect(canvasPixelSize('4096 × 1714px')).toEqual({ width: 4096, height: 1714 });
    expect(canvasPixelSize('210 × 297mm')).toEqual({ width: 2480, height: 3508 });
    expect(canvasPixelSize('6" × 4"')).toEqual({ width: 1800, height: 1200 });
    expect(canvasPixelSize('11" × 8.5"')).toEqual({ width: 3300, height: 2550 });
    expect(canvasPixelSize('nonsense')).toEqual({ width: 1080, height: 1080 });
  });
  it('builds an image layer', () => {
    const l = buildImageLayer({ id: 'l1', name: 'Photo', uri: 'file:///a.jpg', width: 10, height: 20, now: 'n' });
    expect(l).toMatchObject({ id: 'l1', type: 'image', transform: { width: 10, height: 20 }, data: { kind: 'image', uri: 'file:///a.jpg' } });
  });
  it('AI Studio opens canvases by project id only', () => {
    const s = src('app/ai-studio.tsx');
    expect(s).not.toMatch(/pathname: '\/design-canvas'/);
    expect(s).not.toContain('imageUri:');
    expect(s).toContain('createProject(');
    expect((s.match(/\/design-canvas\?id=\$\{proj\.id\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
