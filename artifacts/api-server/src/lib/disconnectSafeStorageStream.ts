import { PassThrough, type Readable } from "node:stream";

/**
 * Do not let an HTTP client's cancellation destroy a GCS read stream before
 * its lazy request has connected. With Node 24 the SDK's later onResponse
 * pipeline can otherwise throw ERR_STREAM_UNABLE_TO_PIPE outside our await.
 *
 * The relay preserves backpressure during a live response. On disconnect it
 * detaches and drains the already-requested object/range without buffering it;
 * the SDK owns its source lifetime. Genuine storage errors still propagate.
 */
export function disconnectSafeStorageStream(source: Readable): PassThrough {
  const relay = new PassThrough();
  source.once("error", error => {
    if (!relay.destroyed) relay.destroy(error);
  });
  relay.once("close", () => {
    source.unpipe(relay);
    if (!source.destroyed && !source.readableEnded) source.resume();
  });
  source.pipe(relay);
  return relay;
}
