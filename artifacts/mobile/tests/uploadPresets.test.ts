import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_UPLOAD_PRESETS,
  fitWithin,
  prepareImageBase64ForUpload,
  presetForUploadPath,
} from '@/lib/imageUploadPrep';
import {
  SINGLE_SHOT_MAX_BYTES,
  isRetryableUploadError,
  sessionProgress,
  uploadBackoffMs,
  uploadResumeKey,
  uploadStrategy,
  withUploadRetry,
} from '@/lib/resumableUpload';
import { UploadAbortedError } from '@/lib/createPost/chunkedUpload';

describe('presetForUploadPath', () => {
  it('maps every upload route to its preset', () => {
    expect(presetForUploadPath('/api/seller/profile/avatar/upload')).toBe('avatar');
    expect(presetForUploadPath('/api/seller/profile/logo/upload')).toBe('logo');
    expect(presetForUploadPath('/api/seller/profile/banner/upload')).toBe('banner');
    expect(presetForUploadPath('/api/products/images')).toBe('product');
    expect(presetForUploadPath('/api/sample-orders/abc/images/upload')).toBe('product');
    expect(presetForUploadPath('/api/posts/photo-slides')).toBe('post');
    expect(presetForUploadPath('/api/manufacturers/threads/t1/attachments')).toBe('message');
    expect(presetForUploadPath('/api/reviews/photos')).toBe('evidence');
    expect(presetForUploadPath('/api/returns/evidence')).toBe('evidence');
    expect(presetForUploadPath('/api/disputes/d1/evidence/upload?type=photo&filename=a.png')).toBe('evidence');
    expect(presetForUploadPath('/api/manufacturers/me/photos')).toBe('evidence');
    expect(presetForUploadPath('/api/manufacturers/orders/o1/updates/photo')).toBe('evidence');
    expect(presetForUploadPath('/api/something/new')).toBe('default');
  });

  it('caps avatars at 1080, messages at 1600 and everything else at 2048', () => {
    expect(IMAGE_UPLOAD_PRESETS.avatar.maxEdge).toBe(1080);
    expect(IMAGE_UPLOAD_PRESETS.message.maxEdge).toBe(1600);
    for (const kind of ['banner', 'product', 'post', 'evidence', 'default'] as const) {
      expect(IMAGE_UPLOAD_PRESETS[kind].maxEdge).toBe(2048);
    }
    for (const preset of Object.values(IMAGE_UPLOAD_PRESETS)) expect(preset.quality).toBeCloseTo(0.8);
  });

  it('size math per preset: 12MP photo → avatar 1080 long edge, never upscales small images', () => {
    expect(fitWithin(4032, 3024, IMAGE_UPLOAD_PRESETS.avatar.maxEdge)).toEqual({ width: 1080, height: 810 });
    expect(fitWithin(1170, 2532, IMAGE_UPLOAD_PRESETS.message.maxEdge)).toEqual({ width: 739, height: 1600 });
    expect(fitWithin(800, 600, IMAGE_UPLOAD_PRESETS.avatar.maxEdge)).toEqual({ width: 800, height: 600 });
  });
});

describe('prepareImageBase64ForUpload', () => {
  it('falls back to the picker bytes when compression is unavailable', async () => {
    expect(await prepareImageBase64ForUpload({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', base64: 'AAAA' }, 'message'))
      .toEqual({ base64: 'AAAA', mimeType: 'image/jpeg' });
    expect(await prepareImageBase64ForUpload({ uri: 'file:///a.heic', mimeType: 'image/heic', base64: 'BBBB' }, 'message', 'image/jpeg'))
      .toEqual({ base64: 'BBBB', mimeType: 'image/jpeg' });
    expect(await prepareImageBase64ForUpload({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, 'message')).toBeNull();
  });
});

describe('upload strategy', () => {
  it('sends small files in one request and large ones through a resumable session', () => {
    expect(uploadStrategy(1)).toBe('single');
    expect(uploadStrategy(SINGLE_SHOT_MAX_BYTES)).toBe('single');
    expect(uploadStrategy(SINGLE_SHOT_MAX_BYTES + 1)).toBe('session');
  });

  it('retries network and transient errors only', () => {
    expect(isRetryableUploadError(Object.assign(new Error('net'), { status: 0 }))).toBe(true);
    expect(isRetryableUploadError(new TypeError('Network request failed'))).toBe(true);
    expect(isRetryableUploadError({ status: 503 })).toBe(true);
    expect(isRetryableUploadError({ status: 429 })).toBe(true);
    expect(isRetryableUploadError({ status: 400 })).toBe(false);
    expect(isRetryableUploadError({ status: 422 })).toBe(false);
    expect(isRetryableUploadError(new UploadAbortedError())).toBe(false);
    expect(isRetryableUploadError(null)).toBe(false);
  });

  it('backs off exponentially with a cap', () => {
    expect([0, 1, 2, 3, 10].map(uploadBackoffMs)).toEqual([800, 1600, 3200, 6400, 8000]);
  });

  it('withUploadRetry retries then succeeds, and gives up on permanent errors', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await expect(withUploadRetry(async () => {
      calls += 1;
      if (calls < 3) throw { status: 503 };
      return 'ok';
    }, { sleep })).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(2);

    let permanent = 0;
    await expect(withUploadRetry(async () => { permanent += 1; throw { status: 400 }; }, { sleep })).rejects.toEqual({ status: 400 });
    expect(permanent).toBe(1);

    let always = 0;
    await expect(withUploadRetry(async () => { always += 1; throw { status: 0 }; }, { sleep, retries: 2 })).rejects.toEqual({ status: 0 });
    expect(always).toBe(3);
  });

  it('keys resume state per route and file, and scales session progress below 100%', () => {
    expect(uploadResumeKey('/api/x?y=1', 'file:///v.mp4', 10, 'video/mp4')).toBe('session|/api/x|file:///v.mp4|10|video/mp4');
    expect(sessionProgress(0)).toBe(0);
    expect(sessionProgress(1)).toBeCloseTo(0.97);
    expect(sessionProgress(2)).toBeCloseTo(0.97);
    expect(sessionProgress(Number.NaN)).toBe(0);
  });
});
