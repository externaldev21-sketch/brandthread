/**
 * Source-structure test (ConversationThread can't render under the shim; see
 * ConversationThread.audit.test.ts). After a Thread Cash send, the chat
 * message is posted and then the thread is refreshed. A failed REFRESH after a
 * successful sendMessage was reported as "Sent, but the chat message failed",
 * though the chat message had been posted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = readFileSync(fileURLToPath(new URL('../ConversationThread.tsx', import.meta.url)), 'utf8');

describe('ConversationThread Thread Cash onSent', () => {
  it('only reports the chat message failed when sendMessage itself fails', () => {
    const start = src.indexOf("id: `local-thread-cash-${transferId}`");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('}}\n                />', start));
    const sendToAlert = block.slice(block.indexOf("await sendMessage(conv.id, '', attachment);"), block.indexOf("Alert.alert('Sent, but the chat message failed'"));
    expect(sendToAlert).toContain("await sendMessage(conv.id, '', attachment);");
    expect(sendToAlert).not.toContain('getMessages(');
    // The refresh still happens, and its failure is swallowed (next poll catches up).
    expect(block).toMatch(/getMessages\(conv\.id\)[\s\S]*catch/);
  });
});
