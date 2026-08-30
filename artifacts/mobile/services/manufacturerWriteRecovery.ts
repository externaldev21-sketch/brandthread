/** True for the API's optimistic-concurrency response, independent of ApiError formatting. */
export function isStaleManufacturerWrite(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'STALE_WRITE') {
    return true;
  }
  return String(error instanceof Error ? error.message : error).includes('STALE_WRITE');
}