import { describe, expect, it } from 'vitest';
import { lookbookPreviewHref, parseStoreLayout, resolveStoreLayout } from './storeLayout';

describe('parseStoreLayout', () => {
  it('only lookbook switches the page; anything else is grid', () => {
    expect(parseStoreLayout('lookbook')).toBe('lookbook');
    for (const v of ['grid', undefined, null, 'Lookbook', 1]) expect(parseStoreLayout(v)).toBe('grid');
  });
});

describe('resolveStoreLayout', () => {
  it('visitors see the saved layout', () => {
    expect(resolveStoreLayout({ saved: 'lookbook', isOwner: false })).toBe('lookbook');
    expect(resolveStoreLayout({ saved: 'grid', isOwner: false })).toBe('grid');
    expect(resolveStoreLayout({ saved: undefined, isOwner: false })).toBe('grid');
  });

  it('owners always get the regular page', () => {
    expect(resolveStoreLayout({ saved: 'lookbook', isOwner: true })).toBe('grid');
    expect(resolveStoreLayout({ saved: 'lookbook', isOwner: true, previewLookbook: true })).toBe('grid');
  });

  it("the owner's preview forces lookbook; a visitor can switch back to the full page", () => {
    expect(resolveStoreLayout({ saved: 'grid', isOwner: false, previewLookbook: true })).toBe('lookbook');
    expect(resolveStoreLayout({ saved: 'lookbook', isOwner: false, visitorChoseGrid: true })).toBe('grid');
  });

  it('builds the preview route', () => {
    expect(lookbookPreviewHref('user_1')).toBe('/seller-profile?id=user_1&asVisitor=1&lookbook=1');
  });
});
