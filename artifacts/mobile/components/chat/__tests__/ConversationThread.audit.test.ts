/**
 * ConversationThread.tsx is a 4k-line screen with dozens of native/runtime
 * dependencies, so it can't be rendered in the vitest shim environment. These
 * are source-structure checks (last resort, per the audit brief) for defects
 * found by reading it; the pure presence-line helper is extracted from the
 * source and actually executed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = readFileSync(fileURLToPath(new URL('../ConversationThread.tsx', import.meta.url)), 'utf8');

function between(start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `missing: ${start}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(end, a + start.length);
  expect(b, `missing after ${start}: ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

function topLevelFunction(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

describe('ConversationThread load failure', () => {
  it('a 404/403 shows "Conversation not found", not a retryable load failure', () => {
    const catchBlock = between("const status = (e as { status?: number } | null)?.status;", 'finally {');
    expect(catchBlock).toContain('setLoadFailed(status !== 404 && status !== 403)');
    // The old unconditional setLoadFailed(true) right after clobbered it.
    expect(catchBlock).not.toContain('setLoadFailed(true)');
  });
});

describe('ConversationThread refetches never reject unhandled', () => {
  it('the subscribeSocial refetch catches', () => {
    const block = between('const unsub = subscribeSocial(', 'return unsub;');
    expect(block).toContain('getMessages(conv.id).then(setMessages).catch(');
  });
});

describe('ConversationThread sends', () => {
  it('a voice note that was sent is never reported "not sent" because the refresh failed', () => {
    const block = between('async function handleVoiceRecorded(', '// ── Voice playback');
    const sendToAlert = between("await sendMessage(conv.id, '', attachment);", "Alert.alert('Voice message not sent'");
    expect(block).toContain(sendToAlert);
    expect(sendToAlert).not.toContain('getMessages(');
  });

  it('a failed outbox save hands the draft back instead of losing it', () => {
    const block = between('if (userId) {\n      const threadId = conv.id;', 'void flushOutboxNow();\n      return;\n    }\n    setIsSending(true);');
    expect(block).toMatch(/try \{\s*await enqueueOutboxMessage\(userId, threadId,/);
    expect(block).toMatch(/catch \{[\s\S]*setText\(t\); setSelectedAttachment\(att\); setReplyTo\(replyingTo\);[\s\S]*Alert\.alert\('Message not saved'/);
  });

  it('a delete that succeeded is not reported failed when the refresh fails', () => {
    const block = between('deleteMessageForMe(threadId, msg.id)', 'function sheetReport()');
    expect(block).toContain('getMessages(threadId).then(setMessages).catch(');
    expect(block).toContain('deletedForMe: true');
  });
});

describe('ConversationThread search-result focus hold', () => {
  it('holds the stick-to-bottom scrolls on the found message (no boolean in the numeric hold ref)', () => {
    expect(src).not.toContain('focusHoldRef.current = true');
    const found = between('focusPendingRef.current = null;', 'const scrollTimer');
    expect(found).toContain('searchFocusHoldRef.current = true;');
    const sizeChange = between('onContentSizeChange={() => {', 'listScroll.onContentSizeChange();');
    expect(sizeChange).toContain('if (searchFocusHoldRef.current) return;');
  });
});

describe('ConversationThread presence line', () => {
  const js = ts.transpileModule(`${topLevelFunction('timeAgo')}\n${topLevelFunction('statusLineFor')}\nreturn statusLineFor;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const statusLineFor = new Function(js)() as (p: { isOnline?: boolean; lastSeenAt?: string } | null) => string | null;

  it('says "last seen just now", never "last seen now ago"', () => {
    expect(statusLineFor({ lastSeenAt: new Date(Date.now() - 5_000).toISOString() })).toBe('last seen just now');
    expect(statusLineFor({ lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString() })).toBe('last seen 5m ago');
  });
});
