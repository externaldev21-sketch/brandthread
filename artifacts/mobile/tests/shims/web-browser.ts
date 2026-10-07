/** Native browser boundary: cancellation is not a successful payment. */
export async function openAuthSessionAsync() {
  return { type: 'cancel' as const };
}
export async function openBrowserAsync() {
  return { type: 'cancel' as const };
}
export function maybeCompleteAuthSession() {}
