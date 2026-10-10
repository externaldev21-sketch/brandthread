/**
 * Chunked, resumable upload for long videos (POST /api/posts/uploads …).
 *
 * The file is cut into server-sized chunks that are PUT independently
 * (2 in flight, each retried with backoff). Progress is real: bytes that
 * have actually left the device, reported per XHR progress event. If a chunk
 * fails for good, or the app restarts, calling again with the same
 * `resumeKey` asks the server which chunks it already holds and sends only
 * the rest.
 *
 * Transport-agnostic so the retry/resume logic is unit-testable; lib/api.ts
 * supplies the authenticated HTTP transport.
 */
export interface ChunkedTransport<R = { objectPath: string; contentType: string; size: number }> {
  start(meta: { contentType: string; size: number }): Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  /** Rejects with `{ status: 404 }` when the session no longer exists. */
  status(uploadId: string): Promise<{ received: number[]; chunkSize: number; totalChunks: number }>;
  putChunk(uploadId: string, index: number, chunk: Blob, onBytes: (loaded: number) => void): Promise<void>;
  complete(uploadId: string): Promise<R>;
}

export interface ResumeStore {
  get(key: string): Promise<string | null>;
  set(key: string, uploadId: string | null): Promise<void>;
}

export interface ChunkedUploadOptions<R = { objectPath: string; contentType: string; size: number }> {
  transport: ChunkedTransport<R>;
  blob: Blob;
  contentType: string;
  resumeKey?: string;
  resumeStore?: ResumeStore;
  /** 0–1, monotonic. */
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
  concurrency?: number;
  retries?: number;
  backoffMs?: (attempt: number) => number;
}

export class UploadAbortedError extends Error {
  constructor() { super('Upload cancelled'); }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function uploadChunked<R = { objectPath: string; contentType: string; size: number }>(opts: ChunkedUploadOptions<R>): Promise<R> {
  const { transport, blob, contentType, resumeKey, resumeStore, onProgress, signal } = opts;
  const concurrency = opts.concurrency ?? 2;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? ((attempt: number) => 600 * 2 ** attempt);

  let session: { uploadId: string; chunkSize: number; totalChunks: number } | null = null;
  let received = new Set<number>();

  const savedId = resumeKey && resumeStore ? await resumeStore.get(resumeKey) : null;
  if (savedId) {
    try {
      const state = await transport.status(savedId);
      session = { uploadId: savedId, chunkSize: state.chunkSize, totalChunks: state.totalChunks };
      received = new Set(state.received);
    } catch {
      if (resumeKey && resumeStore) await resumeStore.set(resumeKey, null);
    }
  }
  if (!session) {
    session = await transport.start({ contentType, size: blob.size });
    if (resumeKey && resumeStore) await resumeStore.set(resumeKey, session.uploadId);
  }
  const { uploadId, chunkSize, totalChunks } = session;

  const chunkLength = (index: number) => Math.min(chunkSize, blob.size - index * chunkSize);
  const inFlight = new Map<number, number>();
  let doneBytes = [...received].reduce((sum, index) => sum + chunkLength(index), 0);
  let lastReported = 0;
  const report = () => {
    const sent = doneBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
    lastReported = Math.max(lastReported, Math.min(1, sent / blob.size));
    onProgress?.(lastReported);
  };
  report();

  const pending: number[] = [];
  for (let i = 0; i < totalChunks; i += 1) if (!received.has(i)) pending.push(i);

  async function sendChunk(index: number) {
    const chunk = blob.slice(index * chunkSize, index * chunkSize + chunkLength(index));
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new UploadAbortedError();
      try {
        inFlight.set(index, 0);
        await transport.putChunk(uploadId, index, chunk, (loaded) => { inFlight.set(index, loaded); report(); });
        inFlight.delete(index);
        doneBytes += chunkLength(index);
        report();
        return;
      } catch (error) {
        inFlight.delete(index);
        if (attempt >= retries) throw error;
        await sleep(backoff(attempt));
      }
    }
  }

  async function worker() {
    for (;;) {
      const next = pending.shift();
      if (next === undefined) return;
      await sendChunk(next);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

  if (signal?.aborted) throw new UploadAbortedError();
  const result = await transport.complete(uploadId);
  if (resumeKey && resumeStore) await resumeStore.set(resumeKey, null);
  onProgress?.(1);
  return result;
}
