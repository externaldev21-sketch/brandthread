import { describe, expect, it } from 'vitest';
import { fromServerBrandAsset, isDeviceLocalUri, toServerBrandAsset } from '../brandAssetsSync';

const base = { id: 'a', name: 'A', tags: [], createdAt: '2026-10-01T00:00:00.000Z' };

describe('brand asset server mapping', () => {
  it('never sends a device-local image URI', () => {
    expect(isDeviceLocalUri('file:///var/mobile/logo.png')).toBe(true);
    expect(isDeviceLocalUri('data:image/png;base64,xx')).toBe(true);
    expect(isDeviceLocalUri('https://cdn.example.com/x.png')).toBe(false);
    expect(() => toServerBrandAsset({ ...base, type: 'logo', uri: 'file:///var/logo.png' })).toThrow(/uploaded/);
  });

  it('sends uploaded images by object path and drops the signed uri', () => {
    const out = toServerBrandAsset({ ...base, type: 'logo', objectPath: '/objects/uploads/1', uri: 'https://signed' });
    expect(out).toEqual({ ...base, type: 'logo', objectPath: '/objects/uploads/1' });
  });

  it('keeps colors and fonts without an image', () => {
    expect(toServerBrandAsset({ ...base, type: 'color', color: '#000000' }).color).toBe('#000000');
    expect(toServerBrandAsset({ ...base, type: 'font', fontFamily: 'Inter' }).fontFamily).toBe('Inter');
  });

  it('maps a server row back with its display uri', () => {
    const a = fromServerBrandAsset({ ...base, type: 'logo', objectPath: '/objects/x', uri: 'https://signed' });
    expect(a.uri).toBe('https://signed');
    expect(a.objectPath).toBe('/objects/x');
  });
});
