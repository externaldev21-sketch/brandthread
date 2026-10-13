import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, Platform: { OS: 'ios' } }));

import {
  getMyPins, isPinLimitError, pinPost, pinPostWithReplacePrompt, unpinPost, MAX_PINS,
} from '@/services/postPinService';

const limitError = () => Object.assign(new Error('409'), {
  status: 409,
  body: JSON.stringify({ code: 'PIN_LIMIT', max: 3, pinned: ['a', 'b', 'c'] }),
});

describe('postPinService', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('calls the pin endpoints', async () => {
    serviceRequest.mockResolvedValue({ pinned: true, pins: ['p'] });
    await pinPost('p');
    expect(serviceRequest).toHaveBeenLastCalledWith('/api/posts/p/pin', { method: 'POST', body: '{}' }, false);
    await pinPost('p', { replaceOldest: true });
    expect(serviceRequest).toHaveBeenLastCalledWith('/api/posts/p/pin', { method: 'POST', body: '{"replaceOldest":true}' }, false);
    await unpinPost('p');
    expect(serviceRequest).toHaveBeenLastCalledWith('/api/posts/p/pin', { method: 'DELETE' });
    serviceRequest.mockResolvedValue({ max: 3, pins: [{ postId: 'x' }, { postId: 'y' }] });
    expect(await getMyPins()).toEqual(['x', 'y']);
    expect(MAX_PINS).toBe(3);
  });

  it('recognises the 3-pin limit error only', () => {
    expect(isPinLimitError(limitError())).toBe(true);
    expect(isPinLimitError(Object.assign(new Error(), { status: 409, body: '{"code":"OTHER"}' }))).toBe(false);
    expect(isPinLimitError(Object.assign(new Error(), { status: 500, body: '{"code":"PIN_LIMIT"}' }))).toBe(false);
    expect(isPinLimitError(new Error('x'))).toBe(false);
  });
});

describe('pinPostWithReplacePrompt', () => {
  it('pins directly under the limit without asking', async () => {
    const pin = vi.fn().mockResolvedValue({ pinned: true, pins: ['p'] });
    const confirm = vi.fn();
    expect(await pinPostWithReplacePrompt('p', confirm, pin)).toEqual({ pinned: true, pins: ['p'] });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('at the limit asks, then replaces the oldest when confirmed', async () => {
    const pin = vi.fn().mockRejectedValueOnce(limitError()).mockResolvedValueOnce({ pinned: true, replaced: 'a', pins: ['p', 'c', 'b'] });
    const confirm = vi.fn().mockResolvedValue(true);
    const result = await pinPostWithReplacePrompt('p', confirm, pin);
    expect(result?.replaced).toBe('a');
    expect(pin).toHaveBeenLastCalledWith('p', { replaceOldest: true });
  });

  it('does nothing when the replace prompt is cancelled', async () => {
    const pin = vi.fn().mockRejectedValueOnce(limitError());
    expect(await pinPostWithReplacePrompt('p', vi.fn().mockResolvedValue(false), pin)).toBeNull();
    expect(pin).toHaveBeenCalledTimes(1);
  });

  it('rethrows other failures', async () => {
    const pin = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(pinPostWithReplacePrompt('p', vi.fn(), pin)).rejects.toThrow('offline');
  });
});
