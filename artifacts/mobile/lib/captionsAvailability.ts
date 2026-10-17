/**
 * Seller-facing copy for the captions editor when the server answers
 * 503 CAPTIONS_UNAVAILABLE. The server adds a `reason`:
 *  - CAPTIONS_NOT_CONFIGURED: the AI transcription keys aren't set on the server
 *  - CAPTIONS_DISABLED: keys exist but the `autoCaptions` flag is off
 */

export interface CaptionsUnavailableCopy {
  title: string;
  message: string;
}

export function isCaptionsUnavailableError(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown } | null | undefined;
  return e?.status === 503 || e?.code === 'CAPTIONS_UNAVAILABLE';
}

function reasonOf(error: unknown): string | null {
  const body = (error as { body?: unknown } | null | undefined)?.body;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed?.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

export function captionsUnavailableCopy(error: unknown): CaptionsUnavailableCopy {
  if (reasonOf(error) === 'CAPTIONS_NOT_CONFIGURED') {
    return {
      title: "Auto captions aren't set up yet",
      message: "Brandthread hasn't connected its transcription service yet. You'll be able to generate captions once it's ready.",
    };
  }
  return {
    title: "Auto captions aren't turned on yet",
    message: "Auto captions aren't available on Brandthread yet. Check back soon.",
  };
}
