/**
 * "Shopping from this live" context. Pure module (no React Native imports) so
 * checkout code can read it. The server re-verifies the stream is live at
 * checkout; this only carries the stream id to the discount validation.
 */


export interface LiveCheckoutContext {
  streamId: string;
  sellerId: string;
  /** Code the viewer tapped in the live; applied when checkout opens. */
  code: string | null;
  at: number;
}

const CONTEXT_TTL_MS = 4 * 60 * 60 * 1000;
let liveCheckoutContext: LiveCheckoutContext | null = null;

export function setLiveCheckoutContext(ctx: { streamId: string; sellerId: string; code?: string | null }): void {
  const keepCode = liveCheckoutContext?.streamId === ctx.streamId ? liveCheckoutContext.code : null;
  liveCheckoutContext = {
    streamId: ctx.streamId,
    sellerId: ctx.sellerId,
    code: ctx.code === undefined ? keepCode : ctx.code,
    at: Date.now(),
  };
}

/** The live the buyer is shopping from, only if it matches this seller and is fresh. */
export function getLiveCheckoutContext(sellerId?: string | null, now: number = Date.now()): LiveCheckoutContext | null {
  const ctx = liveCheckoutContext;
  if (!ctx || now - ctx.at > CONTEXT_TTL_MS) return null;
  if (sellerId && ctx.sellerId !== sellerId) return null;
  return ctx;
}

export function clearLiveCheckoutContext(): void {
  liveCheckoutContext = null;
}

