import { describe, expect, it } from 'vitest';

import {
  GROUP_GAP_MS,
  breaksGroup,
  formatDate,
  formatTime,
  groupCornerRadii,
  groupFlags,
  isSeenReceipt,
  lastOwnMessageId,
  messagePreviewText,
  sameSenderClose,
  type GroupableMessage,
  type SeenableMessage,
} from '../lib/chatGrouping';

const BASE_TS = new Date('2026-09-28T12:00:00').getTime();

function msg(fromId: string, tsOffsetMs: number, attachmentType?: string): GroupableMessage {
  return {
    fromId,
    ts: BASE_TS + tsOffsetMs,
    attachment: attachmentType ? { type: attachmentType } : undefined,
  };
}

describe('chatGrouping: sameSenderClose / breaksGroup', () => {
  it('groups two messages from the same sender within the gap threshold', () => {
    const a = msg('alice', 0);
    const b = msg('alice', 60_000); // 1 minute later
    expect(sameSenderClose(a, b)).toBe(true);
  });

  it('does not group messages from different senders', () => {
    const a = msg('alice', 0);
    const b = msg('bob', 1_000);
    expect(sameSenderClose(a, b)).toBe(false);
  });

  it('does not group messages from the same sender once the gap threshold is exceeded', () => {
    const a = msg('alice', 0);
    const b = msg('alice', GROUP_GAP_MS + 1);
    expect(sameSenderClose(a, b)).toBe(false);
  });

  it('groups messages right at the edge of the gap threshold', () => {
    const a = msg('alice', 0);
    const b = msg('alice', GROUP_GAP_MS - 1);
    expect(sameSenderClose(a, b)).toBe(true);
  });

  it('does not group same-sender messages that fall on different calendar days, even within the gap', () => {
    const a: GroupableMessage = { fromId: 'alice', ts: new Date('2026-09-28T23:59:00').getTime() };
    const b: GroupableMessage = { fromId: 'alice', ts: new Date('2026-09-29T00:01:00').getTime() };
    expect(sameSenderClose(a, b)).toBe(false);
  });

  it('treats agent_card / thread_cash / quick_replies / system attachments as always breaking a group', () => {
    for (const type of ['agent_card', 'thread_cash', 'quick_replies', 'system']) {
      expect(breaksGroup(msg('alice', 0, type))).toBe(true);
      expect(sameSenderClose(msg('alice', 0, type), msg('alice', 1_000))).toBe(false);
      expect(sameSenderClose(msg('alice', 0), msg('alice', 1_000, type))).toBe(false);
    }
  });

  it('does not treat an ordinary image/voice/product attachment as group-breaking', () => {
    expect(breaksGroup(msg('alice', 0, 'image'))).toBe(false);
    expect(sameSenderClose(msg('alice', 0, 'image'), msg('alice', 1_000))).toBe(true);
  });
});

describe('chatGrouping: groupFlags', () => {
  it('marks a single message from a sender as both first and last in its group', () => {
    const flags = groupFlags(msg('alice', 0), undefined, undefined);
    expect(flags).toEqual({ isFirstInGroup: true, isLastInGroup: true });
  });

  it('marks the middle message of a three-message run as neither first nor last', () => {
    const a = msg('alice', 0);
    const b = msg('alice', 60_000);
    const c = msg('alice', 120_000);
    expect(groupFlags(a, undefined, b)).toEqual({ isFirstInGroup: true, isLastInGroup: false });
    expect(groupFlags(b, a, c)).toEqual({ isFirstInGroup: false, isLastInGroup: false });
    expect(groupFlags(c, b, undefined)).toEqual({ isFirstInGroup: false, isLastInGroup: true });
  });

  it('a full end-to-end run of alternating senders groups exactly as expected', () => {
    const timeline: GroupableMessage[] = [
      msg('alice', 0),
      msg('alice', 30_000),       // grouped with prev
      msg('bob', 90_000),         // new sender, new group
      msg('alice', 150_000),      // new group again (sender changed)
      msg('alice', GROUP_GAP_MS + 200_000), // too far from prev alice msg -> new group
    ];
    const results = timeline.map((m, i) => groupFlags(m, timeline[i - 1], timeline[i + 1]));
    expect(results).toEqual([
      { isFirstInGroup: true, isLastInGroup: false },  // alice #1
      { isFirstInGroup: false, isLastInGroup: true },  // alice #2 (grouped with #1)
      { isFirstInGroup: true, isLastInGroup: true },   // bob (alone)
      { isFirstInGroup: true, isLastInGroup: true },   // alice #3 (sender changed just before, gap after)
      { isFirstInGroup: true, isLastInGroup: true },   // alice #4 (too far from #3)
    ]);
  });
});

describe('chatGrouping: groupCornerRadii', () => {
  const FULL = 18;
  const TIGHT = 6;

  it('a standalone (first=last) bubble gets every corner fully rounded, both own and received', () => {
    expect(groupCornerRadii(true, true, true, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: FULL, borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL, borderBottomLeftRadius: FULL,
    });
    expect(groupCornerRadii(false, true, true, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: FULL, borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL, borderBottomLeftRadius: FULL,
    });
  });

  it('a received (left-aligned) bubble in the middle of a group tightens its left-side corners', () => {
    expect(groupCornerRadii(false, false, false, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: TIGHT, borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL, borderBottomLeftRadius: TIGHT,
    });
  });

  it('an own (right-aligned) bubble in the middle of a group tightens its right-side corners', () => {
    expect(groupCornerRadii(true, false, false, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: FULL, borderTopRightRadius: TIGHT,
      borderBottomRightRadius: TIGHT, borderBottomLeftRadius: FULL,
    });
  });

  it('the first bubble of a received group only tightens its bottom (shared-with-next) corner', () => {
    expect(groupCornerRadii(false, true, false, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: FULL, borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL, borderBottomLeftRadius: TIGHT,
    });
  });

  it('the last bubble of a received group only tightens its top (shared-with-prev) corner', () => {
    expect(groupCornerRadii(false, false, true, FULL, TIGHT)).toEqual({
      borderTopLeftRadius: TIGHT, borderTopRightRadius: FULL,
      borderBottomRightRadius: FULL, borderBottomLeftRadius: FULL,
    });
  });
});

describe('chatGrouping: formatDate / formatTime', () => {
  it('labels a timestamp on the same calendar day as "Today"', () => {
    expect(formatDate(Date.now())).toBe('Today');
  });

  it('formats a time as 12-hour h:mm AM/PM', () => {
    const ts = new Date('2026-09-28T09:05:00').getTime();
    expect(formatTime(ts)).toBe('9:05 AM');
    const pm = new Date('2026-09-28T21:45:00').getTime();
    expect(formatTime(pm)).toBe('9:45 PM');
  });
});

describe('chatGrouping: seen receipts (real readAt-derived, conversation-level granularity)', () => {
  const conv: SeenableMessage[] = [
    { id: 'm1', fromId: 'me', ts: BASE_TS },
    { id: 'm2', fromId: 'them', ts: BASE_TS + 1000 },
    { id: 'm3', fromId: 'me', ts: BASE_TS + 2000 },
    { id: 'm4', fromId: 'me', ts: BASE_TS + 3000 },
  ];

  it('lastOwnMessageId finds the most recent message from me, ignoring interleaved messages from the other participant', () => {
    expect(lastOwnMessageId(conv, 'me')).toBe('m4');
  });

  it('returns null when I have no messages in the thread', () => {
    expect(lastOwnMessageId([{ id: 'x', fromId: 'them', ts: BASE_TS }], 'me')).toBeNull();
  });

  it('shows "Seen" only for my most recent message, and only once the other participant has read it', () => {
    const lastId = lastOwnMessageId(conv, 'me');
    const unread = { ...conv[3], readAt: undefined };
    const read = { ...conv[3], readAt: '2026-09-28T12:05:00.000Z' };
    expect(isSeenReceipt(unread, 'me', lastId)).toBe(false);
    expect(isSeenReceipt(read, 'me', lastId)).toBe(true);
  });

  it('never shows "Seen" for an earlier own message even if it happens to carry a readAt', () => {
    const earlierButRead = { ...conv[2], readAt: '2026-09-28T12:05:00.000Z' }; // m3, not the last own message
    const lastId = lastOwnMessageId(conv, 'me');
    expect(isSeenReceipt(earlierButRead, 'me', lastId)).toBe(false);
  });

  it('never shows "Seen" under a message that is not mine', () => {
    const theirs = { ...conv[1], readAt: '2026-09-28T12:05:00.000Z' };
    expect(isSeenReceipt(theirs, 'me', 'm2')).toBe(false);
  });
});

// ─── messagePreviewText (swipe-to-reply quote / banner text) ─────────────────

describe('chatGrouping: messagePreviewText', () => {
  it('uses the message text when present', () => {
    expect(messagePreviewText({ text: 'Hey, is this still available?' })).toBe('Hey, is this still available?');
  });

  it('trims whitespace-only text and falls through to the attachment', () => {
    expect(messagePreviewText({ text: '   ', attachment: { title: 'Sculpted Wool Coat' } }))
      .toBe('Sculpted Wool Coat');
  });

  it('falls back to the attachment title when there is no text', () => {
    expect(messagePreviewText({ text: '', attachment: { title: 'Sculpted Wool Coat' } }))
      .toBe('Sculpted Wool Coat');
  });

  it('falls back to a type-specific label when the attachment has no title', () => {
    expect(messagePreviewText({ text: '', attachment: { type: 'voice' } })).toBe('Voice message');
    expect(messagePreviewText({ text: '', attachment: { type: 'image' } })).toBe('Photo');
    expect(messagePreviewText({ text: '', attachment: { type: 'video' } })).toBe('Video');
    expect(messagePreviewText({ text: '', attachment: { type: 'product' } })).toBe('Product');
  });

  it('falls back to a neutral "Message" with neither text nor attachment', () => {
    expect(messagePreviewText({})).toBe('Message');
  });
});
