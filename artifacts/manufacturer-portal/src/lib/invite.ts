const INVITE_KEY = "bt:manufacturer-invite";

/** Keeps a seller's invite token across the Clerk sign-up redirect. */
export function rememberInvite(token: string | null) {
  try {
    if (token) window.localStorage.setItem(INVITE_KEY, token);
  } catch { /* storage unavailable: the query string still carries it */ }
}

export function pendingInvite(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("invite");
  if (fromQuery) return fromQuery;
  try {
    return window.localStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    window.localStorage.removeItem(INVITE_KEY);
  } catch { /* ignore */ }
}
