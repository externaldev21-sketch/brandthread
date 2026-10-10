import { describe, expect, it, vi } from 'vitest';
import {
  EvidenceUploadError, chooseRefundRoute, refundErrorMessage, submitRefundRequest, uploadEvidencePhotos,
} from './refundRequestFlow';

describe('chooseRefundRoute', () => {
  it('cancels orders that have not shipped', () => {
    expect(chooseRefundRoute({ status: 'new' })).toBe('cancel');
    expect(chooseRefundRoute({ status: 'processing' })).toBe('cancel');
    expect(chooseRefundRoute({ status: 'ready_to_ship', trackingNumber: '  ' })).toBe('cancel');
  });

  it('sends shipped, delivered and tracked orders through returns', () => {
    expect(chooseRefundRoute({ status: 'shipped' })).toBe('return');
    expect(chooseRefundRoute({ status: 'delivered' })).toBe('return');
    expect(chooseRefundRoute({ status: 'new', trackingNumber: '1Z999' })).toBe('return');
  });

  it('closes cancelled, refunded and disputed orders', () => {
    expect(chooseRefundRoute({ status: 'cancelled' })).toBe('closed');
    expect(chooseRefundRoute({ status: 'refunded' })).toBe('closed');
    expect(chooseRefundRoute({ status: 'disputed' })).toBe('closed');
  });
});

describe('uploadEvidencePhotos', () => {
  it('uploads each photo and returns object paths in order, reporting state', async () => {
    const upload = vi.fn(async ({ uri }: { uri: string }) => ({ objectPath: `/objects/returns/u/${uri.slice(-1)}` }));
    const changes: Array<[string, unknown]> = [];
    const paths = await uploadEvidencePhotos(
      [{ uri: 'file:///a' }, { uri: 'file:///b' }],
      upload,
      (uri, patch) => changes.push([uri, patch.state]),
    );
    expect(paths).toEqual(['/objects/returns/u/a', '/objects/returns/u/b']);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(changes).toContainEqual(['file:///a', 'uploading']);
    expect(changes).toContainEqual(['file:///b', 'uploaded']);
  });

  it('never re-uploads a photo that already has an object path', async () => {
    const upload = vi.fn();
    const paths = await uploadEvidencePhotos(
      [{ uri: 'file:///a', objectPath: '/objects/returns/u/a' }, { uri: '/objects/returns/u/b' }],
      upload,
    );
    expect(paths).toEqual(['/objects/returns/u/a', '/objects/returns/u/b']);
    expect(upload).not.toHaveBeenCalled();
  });

  it('marks a failed photo and throws, keeping the others', async () => {
    const changes: Array<[string, unknown]> = [];
    const upload = vi.fn(async ({ uri }: { uri: string }) => {
      if (uri.endsWith('b')) throw new Error('500');
      return { objectPath: '/objects/returns/u/a' };
    });
    await expect(uploadEvidencePhotos([{ uri: 'file:///a' }, { uri: 'file:///b' }], upload, (uri, p) => changes.push([uri, p.state])))
      .rejects.toBeInstanceOf(EvidenceUploadError);
    expect(changes).toContainEqual(['file:///a', 'uploaded']);
    expect(changes).toContainEqual(['file:///b', 'failed']);
  });
});

describe('submitRefundRequest', () => {
  const deps = () => ({
    uploadEvidence: vi.fn(async () => ({ objectPath: '/objects/returns/u/x' })),
    createReturn: vi.fn(async () => ({})),
    cancelOrder: vi.fn(async () => ({ cancelled: true, refunded: true })),
  });

  it('cancels a pre-shipment order without uploading or creating a return', async () => {
    const d = deps();
    const result = await submitRefundRequest(
      { order: { id: 'o1', status: 'processing' }, reason: 'Other', description: 'x', photos: [{ uri: 'file:///a' }] },
      d,
    );
    expect(result).toEqual({ kind: 'cancel', refunded: true });
    expect(d.cancelOrder).toHaveBeenCalledWith('o1');
    expect(d.uploadEvidence).not.toHaveBeenCalled();
    expect(d.createReturn).not.toHaveBeenCalled();
  });

  it('uploads photos first and sends their object paths, never file:// URIs', async () => {
    const d = deps();
    await submitRefundRequest(
      { order: { id: 'o2', status: 'delivered' }, reason: 'Item damaged', description: 'Cracked', photos: [{ uri: 'file:///a' }] },
      d,
    );
    expect(d.createReturn).toHaveBeenCalledWith({
      orderId: 'o2', reason: 'Item damaged', notes: 'Cracked', resolutionRequested: 'refund',
      evidenceUrls: ['/objects/returns/u/x'],
    });
  });

  it('does not create the return when a photo fails to upload', async () => {
    const d = deps();
    d.uploadEvidence.mockRejectedValueOnce(new Error('boom'));
    await expect(submitRefundRequest(
      { order: { id: 'o3', status: 'shipped' }, reason: 'Other', description: 'x', photos: [{ uri: 'file:///a' }] },
      d,
    )).rejects.toBeInstanceOf(EvidenceUploadError);
    expect(d.createReturn).not.toHaveBeenCalled();
  });
});

describe('refundErrorMessage', () => {
  it("prefers the server's detail, then error, then the fallback", () => {
    expect(refundErrorMessage({ body: JSON.stringify({ error: 'Order cannot be cancelled', detail: 'Orders can only be cancelled through day 21.' }) }, 'f'))
      .toBe('Orders can only be cancelled through day 21.');
    expect(refundErrorMessage({ body: JSON.stringify({ error: 'Nope' }) }, 'f')).toBe('Nope');
    expect(refundErrorMessage(new Error('x'), 'f')).toBe('f');
  });
});
