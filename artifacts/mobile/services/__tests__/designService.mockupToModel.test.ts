/**
 * Unit tests for generateMockupToModel and retryMockupToModelRef in designService.
 *
 * These tests exercise the service logic in isolation by mocking all
 * React Native, Expo, and AsyncStorage dependencies so they run in Node/vitest.
 *
 * Covers:
 * - Required mockup gating (missing → throws)
 * - Required references gating (missing / empty → throws)
 * - Max 5 references enforced
 * - One output per reference, stable ordering
 * - Partial failure surfaced via errors array
 * - Retry: single reference retried by refIndex
 * - No mock fallback: API errors propagate; no fabricated results
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock heavy native/RN dependencies before any real imports ────────────────

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
    getAllKeys: () => Promise.resolve([]),
    multiRemove: () => Promise.resolve(),
  },
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => `test-uuid-${Math.random()}`,
}));

vi.mock('@/lib/designExportPolicy', () => ({
  masterUploadMetadata: () => ({ mimeType: 'image/png', width: 100, height: 100, format: 'png', lossless: true }),
}));

vi.mock('@/lib/imageDimensions', () => ({
  getImageDimensions: () => Promise.resolve({ width: 100, height: 100 }),
}));

vi.mock('@/lib/designCloudImageCache', () => ({
  cacheDesignCloudImage: (_: any, objectPath: string) => Promise.resolve(objectPath),
  readRetainedDesignUploadAsset: () => Promise.resolve(new ArrayBuffer(0)),
  removeRetainedDesignUploadAsset: () => Promise.resolve(),
  retainDesignUploadAsset: (uri: string) => Promise.resolve(uri),
}));

vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; }
  },
  reportNetworkError: () => {},
  dismissNetworkNotice: () => {},
}));

vi.mock('@/lib/api', () => ({
  storeContextHeaders: () => ({}),
  versionApiPath: (p: string) => p,
}));

// ─── Mock serviceRequest ──────────────────────────────────────────────────────

const mockServiceRequest = vi.fn();

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: (...args: any[]) => mockServiceRequest(...args),
  configureServices: () => {},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; }
  },
}));

// ─── PNG helpers ──────────────────────────────────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePngDataUrl(content: string): string {
  const payload = Buffer.from(content, 'utf8');
  const full = Buffer.concat([PNG_SIG, payload]);
  return `data:image/png;base64,${full.toString('base64')}`;
}

// ─── Stub global fetch + FileReader for imageUriToDataUrl ─────────────────────

// Make fetch return a blob-like for file:// URIs
function setupFetchBlob(uriContentMap: Record<string, string>) {
  (global as any).fetch = vi.fn(async (uri: string) => {
    const key = Object.keys(uriContentMap).find(k => uri.includes(k)) ?? uri;
    const content = uriContentMap[key] ?? 'default';
    const buf = Buffer.concat([PNG_SIG, Buffer.from(content, 'utf8')]);
    const size = buf.length;
    return {
      ok: true,
      blob: async () => ({
        size,
        type: 'image/png',
        slice: () => ({ type: 'image/png' }),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }),
    };
  });

  // FileReader that base64-encodes the blob
  (global as any).FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: any) {
      blob.arrayBuffer().then((buf: ArrayBuffer) => {
        const b64 = Buffer.from(buf).toString('base64');
        this.result = `data:image/png;base64,${b64}`;
        this.onload?.();
      });
    }
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateMockupToModel', () => {
  let generateMockupToModel: typeof import('../designService')['generateMockupToModel'];
  let retryMockupToModelRef: typeof import('../designService')['retryMockupToModelRef'];

  beforeEach(async () => {
    mockServiceRequest.mockReset();
    setupFetchBlob({ mockup: 'mockup-content', 'ref-0': 'ref0-content', 'ref-1': 'ref1-content', 'ref-2': 'ref2-content' });
    const mod = await import('../designService');
    generateMockupToModel = mod.generateMockupToModel;
    retryMockupToModelRef = mod.retryMockupToModelRef;
  });

  it('throws when mockupUri is missing', async () => {
    await expect(
      generateMockupToModel({ mockupUri: '', referenceUris: ['file://ref-0'] }),
    ).rejects.toThrow(/mockup/i);
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  it('throws when referenceUris is empty', async () => {
    await expect(
      generateMockupToModel({ mockupUri: 'file://mockup', referenceUris: [] }),
    ).rejects.toThrow(/reference/i);
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  it('throws when referenceUris exceeds 5', async () => {
    const refs = Array.from({ length: 6 }, (_, i) => `file://ref-${i}`);
    await expect(
      generateMockupToModel({ mockupUri: 'file://mockup', referenceUris: refs }),
    ).rejects.toThrow(/5/);
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  it('calls serviceRequest with mockup + all references, returns one result per ref', async () => {
    mockServiceRequest.mockResolvedValueOnce({
      results: [
        { refIndex: 0, b64_json: 'aaaa' },
        { refIndex: 1, b64_json: 'bbbb' },
        { refIndex: 2, b64_json: 'cccc' },
      ],
      errors: [],
    });

    const refs = ['file://ref-0', 'file://ref-1', 'file://ref-2'];
    const result = await generateMockupToModel({ mockupUri: 'file://mockup', referenceUris: refs });

    expect(mockServiceRequest).toHaveBeenCalledTimes(1);
    const [path, options] = mockServiceRequest.mock.calls[0] as [string, any];
    expect(path).toContain('mockup-to-model');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(typeof body.mockup).toBe('string');
    expect(body.mockup).toMatch(/^data:image\/png;base64,/);
    expect(Array.isArray(body.references)).toBe(true);
    expect(body.references).toHaveLength(3);

    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({ refIndex: 0, imageUri: 'data:image/png;base64,aaaa' });
    expect(result.results[1]).toMatchObject({ refIndex: 1, imageUri: 'data:image/png;base64,bbbb' });
    expect(result.results[2]).toMatchObject({ refIndex: 2, imageUri: 'data:image/png;base64,cccc' });
    expect(result.errors).toHaveLength(0);
  });

  it('surfaces partial failures from the API in errors array', async () => {
    mockServiceRequest.mockResolvedValueOnce({
      results: [{ refIndex: 0, b64_json: 'aaaa' }],
      errors: [{ refIndex: 1, error: 'Generation failed', retryable: true }],
    });

    const result = await generateMockupToModel({
      mockupUri: 'file://mockup',
      referenceUris: ['file://ref-0', 'file://ref-1'],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].refIndex).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].refIndex).toBe(1);
    expect(result.errors[0].retryable).toBe(true);
  });

  it('propagates API errors without fabricating fallback results', async () => {
    mockServiceRequest.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      generateMockupToModel({ mockupUri: 'file://mockup', referenceUris: ['file://ref-0'] }),
    ).rejects.toThrow('Network error');
  });

  it('accepts exactly 5 references and passes all to the API', async () => {
    mockServiceRequest.mockResolvedValueOnce({
      results: Array.from({ length: 5 }, (_, i) => ({ refIndex: i, b64_json: `img${i}` })),
      errors: [],
    });

    const refs = Array.from({ length: 5 }, (_, i) => `file://ref-${i}`);
    const result = await generateMockupToModel({ mockupUri: 'file://mockup', referenceUris: refs });
    expect(result.results).toHaveLength(5);

    const body = JSON.parse(mockServiceRequest.mock.calls[0][1].body);
    expect(body.references).toHaveLength(5);
  });

  it('preserves empty errors array when API omits it', async () => {
    mockServiceRequest.mockResolvedValueOnce({
      results: [{ refIndex: 0, b64_json: 'aaaa' }],
      // no errors field
    });

    const result = await generateMockupToModel({
      mockupUri: 'file://mockup',
      referenceUris: ['file://ref-0'],
    });
    expect(result.errors).toEqual([]);
  });
});

describe('retryMockupToModelRef', () => {
  let retryMockupToModelRef: typeof import('../designService')['retryMockupToModelRef'];

  beforeEach(async () => {
    mockServiceRequest.mockReset();
    setupFetchBlob({ mockup: 'mockup-content', 'ref-2': 'ref2-content' });
    const mod = await import('../designService');
    retryMockupToModelRef = mod.retryMockupToModelRef;
  });

  it('calls the retry endpoint with mockup, reference, and refIndex', async () => {
    mockServiceRequest.mockResolvedValueOnce({ refIndex: 2, b64_json: 'retry-result' });

    const result = await retryMockupToModelRef({
      mockupUri: 'file://mockup',
      referenceUri: 'file://ref-2',
      refIndex: 2,
    });

    expect(mockServiceRequest).toHaveBeenCalledTimes(1);
    const [path, options] = mockServiceRequest.mock.calls[0] as [string, any];
    expect(path).toContain('mockup-to-model/retry');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.refIndex).toBe(2);
    expect(typeof body.mockup).toBe('string');
    expect(typeof body.reference).toBe('string');

    expect(result.refIndex).toBe(2);
    expect(result.imageUri).toBe('data:image/png;base64,retry-result');
  });

  it('propagates retry API errors without fabricating result', async () => {
    mockServiceRequest.mockRejectedValueOnce(new Error('Retry failed'));

    await expect(
      retryMockupToModelRef({
        mockupUri: 'file://mockup',
        referenceUri: 'file://ref-0',
        refIndex: 0,
      }),
    ).rejects.toThrow('Retry failed');
  });
});
