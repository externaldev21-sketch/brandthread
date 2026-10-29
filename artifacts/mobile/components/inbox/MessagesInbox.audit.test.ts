import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GET /api/conversations (api-server routes/conversations.ts) returns every
 * participant, the viewer included, and the conversation's creator is
 * inserted first. The inbox row/search/long-press must therefore name the
 * OTHER person, not blindly `participants[0]` (which is the viewer on every
 * thread they started).
 */
const src = readFileSync(resolve(__dirname, 'MessagesInbox.tsx'), 'utf8');

// Pure helper under test, evaluated from the source (importing the whole
// screen pulls in the full app graph).
function loadCounterpart(): (conv: { participants: { userId: string; name: string }[] }, viewer: string | null) => { userId: string; name: string } | undefined {
  const m = src.match(/export function inboxCounterpart\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error('inboxCounterpart not found');
  // eslint-disable-next-line no-new-func
  return new Function('conv', 'viewerId', 'MY_USER_ID', m[1]).bind(null) as never;
}

describe('MessagesInbox counterpart', () => {
  const counterpart = loadCounterpart();
  const call = (conv: { participants: { userId: string; name: string }[] }, viewer: string | null) =>
    (counterpart as unknown as (c: unknown, v: unknown, me: string) => { userId: string } | undefined)(conv, viewer, 'me');

  it('skips the signed-in viewer even when the server lists them first (creator order)', () => {
    const conv = { participants: [{ userId: 'u_buyer', name: 'Me' }, { userId: 'u_seller', name: 'Atelier' }] };
    expect(call(conv, 'u_buyer')?.userId).toBe('u_seller');
  });

  it('keeps a single-participant preview row', () => {
    expect(call({ participants: [{ userId: 'p1', name: 'Preview' }] }, null)?.userId).toBe('p1');
  });

  it('skips the legacy local "me" id', () => {
    expect(call({ participants: [{ userId: 'me', name: 'Me' }, { userId: 'p2', name: 'Other' }] }, null)?.userId).toBe('p2');
  });

  it('every row, the Requests search and the long-press menu use it (no raw participants[0])', () => {
    expect(src).toContain(': inboxCounterpart(conv, userId));');
    expect(src).not.toMatch(/getParticipant\(conv\)/);
    expect(src).toContain('const other = participantOf(conv);');
  });
});

describe('MessagesInbox snackbar timer', () => {
  it('clears the pending snackbar auto-hide timer on unmount', () => {
    expect(src).toContain('useEffect(() => () => { if (snackbarTimer.current) clearTimeout(snackbarTimer.current); }, []);');
  });
});
