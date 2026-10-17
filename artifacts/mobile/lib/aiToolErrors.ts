/**
 * Human error text for the AI design tools (Upload Sketch, Edit with Prompt).
 * Server errors (ApiError) go through apiErrorMessage, which hides raw
 * "API 4xx" wire text and 5xx details; local errors thrown before the request
 * (e.g. "Each reference image must be under 8MB.") are already written for
 * people and are shown as-is.
 */
import { ApiError } from './networkNotice';
import { apiErrorMessage } from './freelancer';

export function aiToolErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 402 || err.code === 'plan_required' || err.code === 'PLAN_REQUIRED') {
      return 'This AI tool needs the Growth plan.';
    }
    return apiErrorMessage(err, fallback);
  }
  if (err instanceof Error && err.message && !/^API \d{3}/.test(err.message)) return err.message;
  return fallback;
}
