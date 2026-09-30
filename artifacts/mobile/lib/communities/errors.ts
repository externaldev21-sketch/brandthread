/**
 * Turns anything a community call can throw into calm, human copy.
 * The server's own message is preferred (it is already written in tone);
 * ApiError wraps it as "API 403: …", which this strips.
 */
export interface CommunityErrorInfo {
  message: string;
  code?: string;
  status?: number;
  authRequired: boolean;
}

export function describeCommunityError(err: unknown, fallback = 'Something went wrong. Try again in a moment.'): CommunityErrorInfo {
  const e = err as { name?: string; message?: string; code?: string; status?: number } | null | undefined;
  if (e?.name === 'CommunityAuthRequiredError') {
    return { message: 'Sign in to join groups.', authRequired: true };
  }
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const raw = typeof e?.message === 'string' ? e.message.replace(/^API \d+:\s*/, '').trim() : '';
  let message = raw;
  if (code === 'BANNED') message = "You can't join this group.";
  else if (code === 'PRIVATE') message = 'This group is invite-only. Ask a member for the invite link.';
  else if (status === 429 && code !== 'GROUP_LIMIT') message = 'Slow down a little, then try again.';
  else if (status === 401) return { message: 'Sign in to join groups.', code, status, authRequired: true };
  // Anything that looks like raw JSON / a stack is not calm copy.
  if (!message || message.startsWith('{') || message.length > 200) message = fallback;
  return { message, code, status, authRequired: false };
}

/** True when the failure is the device being offline / the API unreachable. */
export function isNetworkFailure(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null | undefined;
  return e?.status === undefined && /network|fetch|failed to|timed out/i.test(String(e?.message ?? ''));
}
