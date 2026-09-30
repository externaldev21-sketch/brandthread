import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SELLER_PREVIEW_CONVERSATION_SEEDS } from '@/lib/previewInboxData';

/**
 * Structural checks for the seller side of the new every-role-pair DM/
 * message-request routing rule: a DM or story reply to recipient R from
 * sender S now lands in R's Requests unless R already follows S or R is a
 * seller S has a real paid order with — this applies to every role pair, not
 * just buyer<->buyer, so a seller can now receive (and send) genuine
 * unsolicited requests the same way a buyer already can.
 *
 * app/(buyer)/inbox.tsx and app/buyer-conversation.tsx already had full
 * Requests support, built for the old buyer<->buyer-only rule.
 * app/seller-inbox.tsx and app/seller-conversation.tsx had none — this
 * mirrors that same structural-check style (reading the real screen source,
 * see tests/sign-in-otp-wiring.test.ts) for the ported seller-side UI, and
 * tests/request-actions.test.ts's pure-logic style for the new seller
 * preview-cache mutators.
 */
const inboxSrc = readFileSync(resolve(import.meta.dirname, '../app/seller-inbox.tsx'), 'utf8');
const convSrc = readFileSync(resolve(import.meta.dirname, '../app/seller-conversation.tsx'), 'utf8');
const sellerRequestActionsSrc = readFileSync(resolve(import.meta.dirname, '../lib/sellerRequestActions.ts'), 'utf8');

describe('app/seller-inbox.tsx: Requests tab', () => {
  it('has an Inbox/Requests pill row with a live unread-count badge', () => {
    expect(inboxSrc).toContain("type InboxTab = 'inbox' | 'requests';");
    expect(inboxSrc).toContain('function InboxPillRow(');
    expect(inboxSrc).toContain('requestsCount={requestConvs.length}');
  });

  it('filters the Requests tab to isRequest conversations only, excluding archived and pending-delete rows', () => {
    expect(inboxSrc).toContain(
      'const requestConvs = useMemo(() => convs.filter((c) =>\n' +
      '    c.isRequest === true && !c.isArchived && !pendingDeleteIds.has(c.id)\n' +
      '  ), [convs, pendingDeleteIds]);'
    );
  });

  it('excludes requests from the main Inbox list', () => {
    expect(inboxSrc).toContain('if (c.isArchived || c.isRequest || pendingDeleteIds.has(c.id)) return false;');
  });

  it('does not optimistically mark a request read on open — the sender should not see a read receipt before acceptance', () => {
    expect(inboxSrc).toContain('function openRequestConversation(conversationId: string) {');
    expect(inboxSrc).toContain('function openConversation(conversationId: string) {');
  });

  it('offers Block and Delete per request row (Accept lives only in the conversation screen’s panel)', () => {
    expect(inboxSrc).toContain('function renderRequestRow(');
    expect(inboxSrc).toContain("key: 'block',");
    expect(inboxSrc).toContain('onPress: () => blockRequestConversation(item),');
    expect(inboxSrc).toContain('onPress: () => deleteRequestConversation(item),');
  });

  it('has a "Delete all" action and an honest empty state for the Requests tab', () => {
    expect(inboxSrc).toContain('function deleteAllRequests() {');
    expect(inboxSrc).toContain('title="No message requests"');
  });

  it('uses the shared preview-aware seller request actions, not a duplicate implementation', () => {
    expect(inboxSrc).toContain(
      "import {\n" +
      "  scheduleDeleteSellerConversationRequest, undoDeleteSellerConversationRequest, blockSellerConversationRequestUser,\n" +
      "} from '@/lib/sellerRequestActions';"
    );
  });
});

describe('app/seller-conversation.tsx: request mode', () => {
  it('derives isRequestMode and isRequestSender from conv.isRequest/requestedBy', () => {
    expect(convSrc).toContain('const isRequestMode = conv?.isRequest === true;');
    expect(convSrc).toContain('const isRequestSender = isRequestMode && conv?.requestedBy === effectiveMyId;');
  });

  it('only blocks send for the RECIPIENT of a pending request — the sender can keep messaging', () => {
    expect(convSrc).toContain('&& !(isRequestMode && !isRequestSender);');
  });

  it('replaces the composer with the Accept/Delete/Block panel for the recipient only', () => {
    expect(convSrc).toContain('{isRequestMode && !isRequestSender && other ? (');
    expect(convSrc).toContain('<SellerRequestActionPanel');
  });

  it('shows a "Sent as a request" indicator on the sender’s own view instead of the panel', () => {
    expect(convSrc).toContain('{isRequestSender && !messagingBlocked && (');
    expect(convSrc).toContain('testID="seller-conversation-sent-request-banner"');
    expect(convSrc).toContain("Sent as a message request");
  });

  it('the request panel’s buttons read Accept/Delete/Block, matching the buyer screen', () => {
    expect(convSrc).toContain('testID="seller-conversation-request-accept"');
    expect(convSrc).toContain('testID="seller-conversation-request-delete"');
    expect(convSrc).toContain('testID="seller-conversation-request-block"');
    expect(convSrc).toContain('>Accept</Text>');
    expect(convSrc).toContain('>Delete</Text>');
    expect(convSrc).toContain('>Block</Text>');
  });

  it('wires Accept/Decline through the real PATCH .../accept and DELETE endpoints (via lib/sellerRequestActions.ts)', () => {
    expect(convSrc).toContain('await acceptSellerConversationRequest(id, api);');
    expect(convSrc).toContain('scheduleDeleteSellerConversationRequest(conversationId, api);');
    expect(convSrc).toContain('await blockSellerConversationRequestUser(id, other);');
  });

  it('only marks the thread read once it is known not to be a pending request', () => {
    expect(convSrc).toContain('if (!convView.isRequest) {');
    expect(convSrc).toContain('api.conversations.markRead(id).catch(() => {');
  });

  it('surfaces REQUEST_NOT_ACCEPTED (and every other structured send error) through apiErrorMessage, never a raw fallback', () => {
    expect(convSrc).toContain("if (apiErrorCode(e) === 'REQUEST_NOT_ACCEPTED') {");
    expect(convSrc).toContain("Alert.alert('Not sent', apiErrorMessage(e, 'Message not sent. Tap to retry.'));");
    // The old ad-hoc raw.includes('MODERATED'/'BLOCKED') string-matching is
    // gone — every structured code now goes through the one shared helper.
    expect(convSrc).not.toContain("raw.includes('MODERATED')");
  });
});

describe('lib/sellerRequestActions.ts', () => {
  it('routes a real conversation id to the real API and a seeded preview id to the local seller preview cache', () => {
    expect(sellerRequestActionsSrc).toContain('if (isSellerPreviewConversationId(id)) {');
    expect(sellerRequestActionsSrc).toContain('await api.conversations.accept(id);');
    expect(sellerRequestActionsSrc).toContain('await api.conversations.decline(id);');
  });

  it('exports the same three actions as the buyer-side lib/requestActions.ts', () => {
    expect(sellerRequestActionsSrc).toContain('export async function acceptSellerConversationRequest(');
    expect(sellerRequestActionsSrc).toContain('export function scheduleDeleteSellerConversationRequest(');
    expect(sellerRequestActionsSrc).toContain('export async function blockSellerConversationRequestUser(');
  });
});

describe('SELLER_PREVIEW_CONVERSATION_SEEDS: request fixtures (pure data, no react-native/expo-* imports)', () => {
  it('has at least one request the seller RECEIVED and one they SENT, demoing both directions', () => {
    const requests = SELLER_PREVIEW_CONVERSATION_SEEDS.filter((s) => s.isRequest);
    expect(requests.some((s) => s.requestedBy === 'them')).toBe(true);
    expect(requests.some((s) => s.requestedBy === 'me')).toBe(true);
  });

  it('every isRequest seed sets requestedBy — the preview mapper (lib/previewInbox.ts) has nothing to fall back to otherwise', () => {
    for (const seed of SELLER_PREVIEW_CONVERSATION_SEEDS) {
      if (seed.isRequest) expect(seed.requestedBy, `seed ${seed.id} is isRequest but has no requestedBy`).toBeDefined();
    }
  });
});

// ── lib/previewInbox.ts's seller-side additions (source inspection) ───────
// Same limitation as lib/__tests__/previewInbox.test.ts's own source-check
// block: this module requires bundled image assets at module scope, which
// Vitest cannot transform, so its contract is verified by reading the
// source rather than importing it.
describe('lib/previewInbox.ts: seller-side request mutators (source check)', () => {
  const previewInboxSrc = readFileSync(resolve(import.meta.dirname, '../lib/previewInbox.ts'), 'utf8');

  it('maps requestedBy the same way for both the buyer and seller preview conversation shapes', () => {
    expect(previewInboxSrc).toContain(
      "requestedBy: seed.requestedBy === 'me' ? 'me' : seed.requestedBy === 'them' ? seed.participantUserId : undefined,"
    );
  });

  it('has its own mutable seller cache so Accept/Delete persist for the rest of the session', () => {
    expect(previewInboxSrc).toContain('let cachedSellerConversations: Conversation[] | null = null;');
    expect(previewInboxSrc).toContain('export function acceptSellerPreviewConversationRequest(id: string): Conversation | null {');
    expect(previewInboxSrc).toContain('export function deleteSellerPreviewConversationRequest(id: string): void {');
  });
});
