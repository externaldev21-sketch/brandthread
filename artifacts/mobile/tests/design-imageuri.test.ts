/**
 * Tests for lib/imageUri — makeDurableUri platform-aware helper.
 *
 * Verifies:
 *  - Data URLs pass through unchanged (all platforms).
 *  - Blob URLs are converted to base64 data URLs on web.
 *  - Remote https:// URLs pass through unchanged on web.
 *  - Native path strings trigger File.copy (mocked).
 *  - Oversized blobs throw with a descriptive error.
 *  - FileReader failures throw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Platform mock (defaults to web; override per-test) ───────────────────────
// Must use a module-level object that is NOT referenced before vi.mock hoisting.
// We use a shared object accessed via the module factory closure.

vi.mock('react-native', () => {
  const platformMock = { OS: 'web' as 'web' | 'ios' | 'android' };
  // Expose on global so tests can mutate it
  (globalThis as Record<string, unknown>).__platformMock = platformMock;
  return { Platform: platformMock };
});

// ─── expo-file-system mock ────────────────────────────────────────────────────

const copySpy = vi.fn().mockResolvedValue(undefined);

vi.mock('expo-file-system', () => {
  const _copySpy = (globalThis as Record<string, unknown>).__copySpy as typeof copySpy;
  return {
    File: class FakeFile {
      uri: string;
      constructor(dirOrUri: string, filename?: string) {
        this.uri = filename ? `${dirOrUri}/${filename}` : dirOrUri;
        (globalThis as Record<string, unknown>).__lastDestUri = this.uri;
      }
      copy(_dest: { uri: string }) {
        // _copySpy may not be set yet during module init; call the live spy
        return ((globalThis as Record<string, unknown>).__copySpy as typeof copySpy)(_dest);
      }
    },
    Paths: { document: '/app/documents' },
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  isDataUrl, isBlobUrl, isRemoteUrl, makeDurableUri, MAX_DATA_URL_BYTES,
} from '../lib/imageUri';

// Wire copySpy into globalThis so the module factory can reach it
(globalThis as Record<string, unknown>).__copySpy = copySpy;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeBlob(size: number): Blob {
  // Create a blob with the given size by filling a Uint8Array
  const buf = new Uint8Array(size);
  return new Blob([buf], { type: 'image/png' });
}

function mockFetchWithBlob(blob: Blob) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(blob),
  } as unknown as Response);
}

function mockFetchFail(status = 404) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    blob: () => Promise.reject(new Error('should not read blob on error')),
  } as unknown as Response);
}

function mockFileReader(result: string | null, errorMode = false) {
  (global as Record<string, unknown>).FileReader = class FakeFileReader {
    result: string | null = null;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      if (errorMode) {
        setTimeout(() => this.onerror?.());
      } else {
        this.result = result;
        setTimeout(() => this.onload?.());
      }
    }
  };
}

// ─── Tests: helper predicates ─────────────────────────────────────────────────

describe('imageUri predicates', () => {
  it('isDataUrl detects data:image/ prefix', () => {
    expect(isDataUrl('data:image/png;base64,abc')).toBe(true);
    expect(isDataUrl('blob:https://example.com/x')).toBe(false);
    expect(isDataUrl('https://cdn.example.com/img.jpg')).toBe(false);
  });

  it('isBlobUrl detects blob: prefix', () => {
    expect(isBlobUrl('blob:https://example.com/abc')).toBe(true);
    expect(isBlobUrl('data:image/png;base64,abc')).toBe(false);
    expect(isBlobUrl('https://example.com/img.jpg')).toBe(false);
  });

  it('isRemoteUrl detects https:// and http://', () => {
    expect(isRemoteUrl('https://cdn.example.com/img.jpg')).toBe(true);
    expect(isRemoteUrl('http://localhost/img.jpg')).toBe(true);
    expect(isRemoteUrl('blob:https://example.com/abc')).toBe(false);
  });
});

// ─── Tests: data URL pass-through ─────────────────────────────────────────────

function getPlatformMock() {
  return (globalThis as Record<string, unknown>).__platformMock as { OS: string };
}
function getLastDestUri() {
  return (globalThis as Record<string, unknown>).__lastDestUri as string;
}

describe('makeDurableUri — data URL passthrough', () => {
  it('returns data URL unchanged on web', async () => {
    getPlatformMock().OS = 'web';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await makeDurableUri(dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('returns data URL unchanged on native', async () => {
    getPlatformMock().OS = 'ios';
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQS=';
    const result = await makeDurableUri(dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('rejects an existing data URL above the persisted byte limit', async () => {
    getPlatformMock().OS = 'web';
    const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(MAX_DATA_URL_BYTES)}`;
    await expect(makeDurableUri(oversizedDataUrl)).rejects.toThrow(/encoded image too large/i);
  });
});

// ─── Tests: web blob URL → base64 data URL ────────────────────────────────────

describe('makeDurableUri — web blob URL conversion', () => {
  beforeEach(() => { getPlatformMock().OS = 'web'; });

  it('converts a small blob URL to a base64 data URL', async () => {
    const blob = makeFakeBlob(100);
    mockFetchWithBlob(blob);
    mockFileReader('data:image/png;base64,FAKE_DATA');

    const result = await makeDurableUri('blob:https://example.com/test-uuid');
    expect(result).toBe('data:image/png;base64,FAKE_DATA');
    expect(global.fetch).toHaveBeenCalledWith('blob:https://example.com/test-uuid');
  });

  it('rejects when base64 expansion exceeds the persisted byte limit', async () => {
    const blob = makeFakeBlob(100);
    mockFetchWithBlob(blob);
    mockFileReader(`data:image/png;base64,${'A'.repeat(MAX_DATA_URL_BYTES)}`);
    await expect(makeDurableUri('blob:https://example.com/expanded')).rejects.toThrow(
      /encoded image too large/i,
    );
  });

  it('rejects blob URL whose resolved blob exceeds MAX_DATA_URL_BYTES', async () => {
    const oversizedBlob = makeFakeBlob(MAX_DATA_URL_BYTES + 1);
    mockFetchWithBlob(oversizedBlob);

    await expect(makeDurableUri('blob:https://example.com/big')).rejects.toThrow(
      /too large/i,
    );
  });

  it('rejects when fetch fails for a blob URL', async () => {
    mockFetchFail(403);
    await expect(makeDurableUri('blob:https://example.com/denied')).rejects.toThrow(
      /could not fetch/i,
    );
  });

  it('rejects when FileReader errors during base64 conversion', async () => {
    const blob = makeFakeBlob(50);
    mockFetchWithBlob(blob);
    mockFileReader(null, /* errorMode */ true);

    await expect(makeDurableUri('blob:https://example.com/bad-read')).rejects.toThrow(
      /FileReader failed/i,
    );
  });
});

// ─── Tests: web remote URL pass-through ───────────────────────────────────────

describe('makeDurableUri — web remote URL passthrough', () => {
  beforeEach(() => { getPlatformMock().OS = 'web'; });

  it('returns remote https:// URL unchanged without fetching', async () => {
    global.fetch = vi.fn();
    const url = 'https://cdn.example.com/assets/img.jpg';
    const result = await makeDurableUri(url);
    expect(result).toBe(url);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Tests: native file copy ───────────────────────────────────────────────────

describe('makeDurableUri — native file copy', () => {
  beforeEach(() => {
    getPlatformMock().OS = 'ios';
    copySpy.mockClear();
    (globalThis as Record<string, unknown>).__lastDestUri = '';
  });

  it('copies a native picker URI to Paths.document and returns the dest URI', async () => {
    const pickerUri = '/var/tmp/picker-tmp/photo_0123.jpeg';
    copySpy.mockResolvedValueOnce(undefined);

    const result = await makeDurableUri(pickerUri, 'jpg');
    // Result should be the destination URI under /app/documents
    expect(result).toContain('/app/documents/');
    expect(result).toContain('.jpeg');
    expect(copySpy).toHaveBeenCalledTimes(1);
  });

  it('propagates File.copy errors upward', async () => {
    copySpy.mockRejectedValueOnce(new Error('ENOSPC: no space left'));
    await expect(makeDurableUri('/tmp/photo.jpg')).rejects.toThrow('ENOSPC');
  });

  it('uses the file extension from the picker URI', async () => {
    copySpy.mockResolvedValueOnce(undefined);
    await makeDurableUri('/tmp/photo.png');
    expect(getLastDestUri()).toMatch(/\.png$/);
  });

  it('does not call fetch on native for any URI type', async () => {
    global.fetch = vi.fn();
    copySpy.mockResolvedValueOnce(undefined);
    await makeDurableUri('/tmp/photo.jpg');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
