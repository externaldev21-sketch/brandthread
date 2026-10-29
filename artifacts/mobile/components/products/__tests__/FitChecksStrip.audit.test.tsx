/**
 * The strip belongs to one product: when the page moves to a different
 * product, the previous product's fit checks must not stay on screen.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const productFitChecks = vi.fn();
vi.mock('@/services/fitsService', () => ({ fitsService: { productFitChecks: (...a: unknown[]) => productFitChecks(...a) } }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { border: '#222', muted: '#999', surface: '#111', text: '#fff' } }),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));

import { FitChecksStrip } from '../FitChecksStrip';

const A = '11111111-1111-4111-8111-111111111111';

describe('FitChecksStrip', () => {
  it('drops the previous product\'s fit checks when the product changes', async () => {
    productFitChecks.mockResolvedValueOnce({
      fitChecks: [{ postId: 'p1', thumbnailUrl: null, author: { username: 'ann' } }],
    });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<FitChecksStrip productId={A} productName="Tee" />); });
    expect(r.root.findAll((n) => n.props.testID === 'product-fit-checks').length).toBeGreaterThan(0);

    // A product the endpoint can't serve (not a UUID): nothing is fetched,
    // and nothing of product A may remain.
    await act(async () => { r.update(<FitChecksStrip productId="preview-product-01" productName="Coat" />); });
    expect(r.toJSON()).toBeNull();
  });
});
