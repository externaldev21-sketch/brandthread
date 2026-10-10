/**
 * `error?.message ?? fallback` for a `catch (e: unknown)` binding.
 *
 * Same result as the untyped `(e: any) => e?.message ?? fallback` it
 * replaces: the error's own message whenever it has one (an empty string
 * included), otherwise the fallback.
 */
export function errorMessageOr(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return message === null || message === undefined ? fallback : String(message);
}
