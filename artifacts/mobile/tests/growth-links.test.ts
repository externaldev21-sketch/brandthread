import { describe, expect, it, vi } from 'vitest';
import { formatRate, metaPixelError, normalizeUrlInput, tiktokPixelError } from '@/lib/growthValidation';

describe('growth client validation', () => {
  it('validates pixel ids like the server', () => {
    expect(metaPixelError('')).toBeNull();
    expect(metaPixelError('1234567890123456')).toBeNull();
    expect(metaPixelError('abc')).not.toBeNull();
    expect(metaPixelError('123");alert(1);//')).not.toBeNull();
    expect(tiktokPixelError('c4abcd1234567890abcd')).toBeNull();
    expect(tiktokPixelError('<script>')).not.toBeNull();
  });
  it('normalises link input', () => {
    expect(normalizeUrlInput('yourbrand.com/x')).toBe('https://yourbrand.com/x');
    expect(normalizeUrlInput('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(normalizeUrlInput('javascript:alert(1)')).toBeNull();
    expect(normalizeUrlInput('not a url')).toBeNull();
  });
  it('formats rates', () => {
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(0.256)).toBe('26%');
    expect(formatRate(0.042)).toBe('4.2%');
  });
});

describe('growthService in the seller dev preview', () => {
  it('never hits the network', async () => {
    vi.resetModules();
    const serviceRequest = vi.fn();
    vi.doMock('@/lib/serviceConfig', () => ({ serviceRequest }));
    vi.doMock('@/lib/devPreview', () => ({ isSellerDevPreview: () => true, isPreviewDemoMode: () => false }));
    const svc = await import('@/services/growthService');
    expect(await svc.listLinks()).toEqual([]);
    const l = await svc.createLink({ label: 'x', destinationType: 'store', destinationRef: null, utmSource: 'a', utmMedium: 'b', utmCampaign: '' });
    expect((await svc.listLinks())[0].id).toBe(l.id);
    await svc.saveBio({ displayName: 'N' });
    expect((await svc.getBio()).displayName).toBe('N');
    await svc.getPixels(); await svc.getBioStats(); await svc.getDestinations();
    expect(serviceRequest).not.toHaveBeenCalled();
  });
});
