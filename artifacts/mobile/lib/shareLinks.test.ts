import { describe, expect, it } from 'vitest';
import {
  SHARE_ORIGIN,
  buildHashtagUrl,
  buildPlaceUrl,
  buildPostUrl,
  buildProductUrl,
  buildProfileUrl,
  buildStoreUrl,
  parseShareLink,
} from './shareLinks';

describe('shareLinks builders', () => {
  it('defaults to the production origin', () => {
    expect(SHARE_ORIGIN).toBe('https://brandthread.app');
  });

  it('builds canonical https urls', () => {
    expect(buildPostUrl('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('https://brandthread.app/p/0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(buildStoreUrl('@NovaGoods')).toBe('https://brandthread.app/store/novagoods');
    expect(buildProductUrl('prod_123456')).toBe('https://brandthread.app/store/product/prod_123456');
    expect(buildProfileUrl('JordanReyes')).toBe('https://brandthread.app/u/jordanreyes');
    expect(buildHashtagUrl('#StreetWear')).toBe('https://brandthread.app/tag/streetwear');
    expect(buildPlaceUrl('place_12345')).toBe('https://brandthread.app/place/place_12345');
  });

  it('never fabricates a url from invalid input', () => {
    expect(buildPostUrl('')).toBeNull();
    expect(buildPostUrl('a/b')).toBeNull();
    expect(buildPostUrl(undefined)).toBeNull();
    expect(buildStoreUrl('bad handle')).toBeNull();
    expect(buildHashtagUrl('no spaces')).toBeNull();
    expect(buildProfileUrl('ab')).toBeNull();
  });
});

describe('parseShareLink', () => {
  it('maps the short /s/ store link and the long /post/ link', () => {
    expect(parseShareLink('https://brandthread.app/s/Atelier')).toEqual({ kind: 'store', handle: 'atelier', href: '/u/atelier' });
    expect(parseShareLink('https://brandthread.app/post/abc123def')?.href).toBe('/buyer-post-viewer?postId=abc123def');
    expect(parseShareLink('/s/a/b')).toBeNull();
  });

  it('maps https links to in-app routes', () => {
    expect(parseShareLink('https://brandthread.app/p/abc123def?utm=x')?.href).toBe('/buyer-post-viewer?postId=abc123def');
    expect(parseShareLink('https://www.brandthread.app/tag/Streetwear')?.href).toBe('/hashtag/streetwear');
    expect(parseShareLink('https://brandthread.app/place/pl_12345')?.href).toBe('/location/pl_12345');
    expect(parseShareLink('https://brandthread.app/u/Jordan_R')?.href).toBe('/u/jordan_r');
    expect(parseShareLink('https://brandthread.app/store/product/prod_123456')?.href).toBe('/product-detail?id=prod_123456');
    expect(parseShareLink('https://brandthread.app/store/novagoods')).toMatchObject({ kind: 'store', href: '/u/novagoods' });
    expect(parseShareLink('https://brandthread.app/c/col1')?.kind).toBe('collection');
    expect(parseShareLink('https://brandthread.app/drops/d1')?.kind).toBe('drop');
  });

  it('maps the custom scheme and bare paths', () => {
    expect(parseShareLink('brandthread://p/abc123def')?.href).toBe('/buyer-post-viewer?postId=abc123def');
    expect(parseShareLink('brandthread:///tag/ootd')?.href).toBe('/hashtag/ootd');
    expect(parseShareLink('/place/pl_12345')?.kind).toBe('place');
  });

  it('rejects foreign hosts, unknown paths and malformed segments', () => {
    expect(parseShareLink('https://evil.example/p/abc123def')).toBeNull();
    expect(parseShareLink('https://brandthread.app.evil.example/p/abc123def')).toBeNull();
    expect(parseShareLink('https://brandthread.app/settings')).toBeNull();
    expect(parseShareLink('https://brandthread.app/p/abc123def/extra')).toBeNull();
    expect(parseShareLink('https://brandthread.app/p/%E0%A4%A')).toBeNull();
    expect(parseShareLink('https://brandthread.app/tag/bad%20tag')).toBeNull();
    expect(parseShareLink('')).toBeNull();
    expect(parseShareLink(null)).toBeNull();
  });

  it('round-trips the builders', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseShareLink(buildPostUrl(id))).toMatchObject({ kind: 'post', id });
    expect(parseShareLink(buildHashtagUrl('ootd'))).toMatchObject({ kind: 'hashtag', tag: 'ootd' });
    expect(parseShareLink(buildStoreUrl('nova'))).toMatchObject({ kind: 'store', handle: 'nova' });
  });
});
