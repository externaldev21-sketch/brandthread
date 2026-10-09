import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const previewState = vi.hoisted(() => ({ active: true, demo: true }));
const serviceRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => previewState.active,
  isPreviewDemoMode: () => previewState.demo,
}));
vi.mock('../lib/serviceConfig', () => ({ serviceRequest: serviceRequestMock }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));

import {
  favoriteManufacturer,
  getFavoriteManufacturerIds,
  getManufacturer,
  getRelationships,
  searchManufacturers,
  saveManufacturer,
  unfavoriteManufacturer,
} from '../services/manufacturerService';
import {
  getManufacturerProduct,
  getManufacturerProducts,
} from '../services/manufacturerCatalog';

describe('seller-preview manufacturer fixtures', () => {
  beforeEach(() => {
    serviceRequestMock.mockReset();
    previewState.active = true;
    previewState.demo = true;
  });

  it('serves contract-shaped directory, profile, relationship, and catalog reads without network access', async () => {
    const directory = await searchManufacturers({ query: 'porto', sort: 'rating' });
    const profile = await getManufacturer('preview-mfg-porto-knit');
    const relationships = await getRelationships();
    const products = await getManufacturerProducts('preview-mfg-porto-knit');
    const product = await getManufacturerProduct('preview-mfg-porto-knit', 'preview-mfg-product-porto-crew');

    expect(directory[0]).toMatchObject({ id: 'preview-mfg-porto-knit', name: 'Porto Knit Collective' });
    expect(profile).toMatchObject({ id: 'preview-mfg-porto-knit', isPublicDirectory: true });
    expect(relationships[0]).toMatchObject({ manufacturerId: 'preview-mfg-porto-knit', status: 'connected' });
    expect(products[0]).toMatchObject({ manufacturerId: 'preview-mfg-porto-knit', status: 'active', priceTiers: expect.any(Array) });
    expect(product?.id).toBe('preview-mfg-product-porto-crew');
    expect(serviceRequestMock).not.toHaveBeenCalled();
  });

  it('keeps demo favorites local to the preview session', async () => {
    await unfavoriteManufacturer('preview-mfg-porto-knit');
    expect(await getFavoriteManufacturerIds()).not.toContain('preview-mfg-porto-knit');
    await favoriteManufacturer('preview-mfg-porto-knit');
    const relationship = await saveManufacturer('preview-mfg-porto-knit');

    expect(relationship.status).toBe('connected');
    expect(await getFavoriteManufacturerIds()).toContain('preview-mfg-porto-knit');
    expect(serviceRequestMock).not.toHaveBeenCalled();
  });

  it('returns honest empty reads in fresh preview mode', async () => {
    previewState.demo = false;
    expect(await searchManufacturers({})).toEqual([]);
    expect(await getManufacturer('preview-mfg-porto-knit')).toBeUndefined();
    expect(await getManufacturerProducts('preview-mfg-porto-knit')).toEqual([]);
    expect(serviceRequestMock).not.toHaveBeenCalled();
  });

  it('initializes seller settings and unsupported detail routes without auth-dependent spinners', () => {
    const root = resolve(__dirname, '..');
    const settings = readFileSync(resolve(root, 'app/seller-settings.tsx'), 'utf8');
    const roles = readFileSync(resolve(root, 'contexts/RoleContext.tsx'), 'utf8');
    const messages = readFileSync(resolve(root, 'app/manufacturer-messages.tsx'), 'utf8');
    const bulkEdit = readFileSync(resolve(root, 'app/products-bulk-edit.tsx'), 'utf8');
    const productSeo = readFileSync(resolve(root, 'app/product-seo.tsx'), 'utf8');

    expect(settings.indexOf('if (isSellerDevPreview())')).toBeLessThan(settings.indexOf('api.moderation.me()'));
    expect(roles).toContain('setRoleState(previewRole);');
    expect(roles).toContain('if (previewRole) return;');
    expect(roles).not.toContain("roleKeyForUser('preview')");
    expect(messages).toContain("setLoadError('Manufacturer messaging is unavailable in the signed-out preview.')");
    expect(messages).toContain('setLoading(false);');
    // Bulk edit never calls the API in the preview: demo edits the local
    // preview catalog, fresh shows the empty catalog.
    expect(bulkEdit.indexOf('if (preview) {')).toBeLessThan(bulkEdit.indexOf('api.productBulk.list('));
    expect(bulkEdit).toContain('bulkCatalogFromProducts(getPreviewSellerProducts())');
    expect(bulkEdit).toContain("const next = demo && catalog ? filterLocalCatalog(catalog, debounced, status) : [];");
    expect(productSeo).toContain("setLoadError('Product SEO editing is unavailable in the signed-out preview.')");
  });
});