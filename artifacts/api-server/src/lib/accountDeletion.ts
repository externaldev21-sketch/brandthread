/** The destructive endpoint deliberately accepts no aliases or whitespace. */
export function hasDeletionConfirmation(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { confirmation?: unknown }).confirmation === "DELETE";
}