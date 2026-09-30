/**
 * Brandthread AI Tools — shared result-slot shape
 *
 * One generation request in a batch (one reference photo, one shot, ...).
 * Shared between every AI tool that generates N images at once and shows
 * them in a grid with per-tile progress/failure/retry.
 */
export type AiResultStatus = 'generating' | 'done' | 'failed';

export interface AiResultSlot {
  /** Stable key — usually the slot's index in the request batch. */
  id: number;
  status: AiResultStatus;
  /** The "before" image this result was generated from (reference/product photo), for a Before/After toggle. */
  sourceUri?: string;
  /** The generated "after" image, once done. */
  imageUri?: string;
  error?: string;
  /** Short label under the tile, e.g. "Reference 1" or "Shot 1". */
  label: string;
}
