import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ demo: false }));
vi.mock('./devPreview', () => ({
  isPreviewDemoMode: () => flags.demo,
  isSellerDevPreview: () => flags.demo,
  isBuyerDevPreview: () => false,
}));

import { loadPreviewSellerOrder, savePreviewSellerOrder } from './previewOrderEdits';
import { previewSellerOrders } from './previewSellerOrders';

describe('loadPreviewSellerOrder (audit)', () => {
  beforeEach(() => { flags.demo = false; });

  const generatedId = () => previewSellerOrders(new Date(), 5)[0]!.id;

  it('never returns a generated demo order outside the &demo=1 preview', () => {
    const id = generatedId();
    expect(id.startsWith('preview-demo-order-')).toBe(true);
    expect(loadPreviewSellerOrder(id)).toBeNull();
  });

  it('returns it (and the session edits) inside the demo preview', () => {
    flags.demo = true;
    const id = generatedId();
    const order = loadPreviewSellerOrder(id);
    expect(order?.id).toBe(id);
    savePreviewSellerOrder({ ...order!, id, status: 'shipped' });
    expect(loadPreviewSellerOrder(id)?.status).toBe('shipped');
    // The edit stays invisible once the session is no longer the demo preview.
    flags.demo = false;
    expect(loadPreviewSellerOrder(id)).toBeNull();
  });
});
