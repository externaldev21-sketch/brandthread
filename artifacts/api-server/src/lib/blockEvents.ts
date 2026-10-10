/**
 * "Someone just blocked someone" — raised by POST /api/social/block after the
 * block row is written, so features that keep live state between two people
 * can react without social.ts importing them. routes/call.ts listens and ends
 * any ringing / accepted DM call between the pair (lib/callPolicy.ts).
 */
type BlockListener = (blockerId: string, blockedId: string) => Promise<unknown> | unknown;

const listeners = new Set<BlockListener>();

export function onUserBlocked(listener: BlockListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Runs every listener; a failing listener never fails the block. */
export async function emitUserBlocked(blockerId: string, blockedId: string): Promise<void> {
  await Promise.all([...listeners].map(async (listener) => {
    try {
      await listener(blockerId, blockedId);
    } catch {
      /* listeners log their own failures */
    }
  }));
}
