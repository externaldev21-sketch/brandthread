/**
 * Child process that runs background-removal inference (lib/bgRemoval/segmenter.ts).
 * Forked on demand by lib/bgRemoval/index.ts so the model's multi-GB memory peak
 * lives outside the API server: if the machine runs short, only this child dies
 * and the request gets a retryable error.
 */
import { removeBackground } from "./lib/bgRemoval/segmenter";

// build.mjs imports this bundle to prefetch the model file.
export { bgModelName, ensureBgModel } from "./lib/bgRemoval/segmenter";

interface Job { id: number; image: Uint8Array }

if (process.send) process.on("message", (msg: Job) => {
  removeBackground(Buffer.from(msg.image))
    .then((r) => process.send?.({ id: msg.id, ok: true, png: r.png, width: r.width, height: r.height, coverage: r.coverage, model: r.model }))
    .catch((err: unknown) => process.send?.({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
});
