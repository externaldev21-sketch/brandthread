import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * "Seller messages = buyer messages" (Dev's override): the buyer Messages
 * screens are the reference, and the seller side renders the SAME shared
 * components — not a copy — with only seller data swapped in. The buyer
 * routes keep rendering the buyer variant exactly as before.
 */
describe('both sides render the one shared inbox and thread', () => {
  it('inbox routes are thin wrappers around MessagesInbox', () => {
    expect(read('app/(buyer)/inbox.tsx')).toContain('<MessagesInbox variant="buyer" />');
    expect(read('app/seller-inbox.tsx')).toContain('<MessagesInbox variant="seller" />');
  });

  it('thread routes are thin wrappers around ConversationThread', () => {
    expect(read('app/buyer-conversation.tsx')).toContain('<ConversationThread variant="buyer" />');
    expect(read('app/seller-conversation.tsx')).toContain('<ConversationThread variant="seller" />');
  });

  it('the old seller-only screens are gone (no second implementation to drift)', () => {
    expect(read('app/seller-inbox.tsx').split('\n').length).toBeLessThan(20);
    expect(read('app/seller-conversation.tsx').split('\n').length).toBeLessThan(20);
  });
});

describe('MessagesInbox seller variant', () => {
  const src = read('components/inbox/MessagesInbox.tsx');

  it('defaults to the buyer variant', () => {
    expect(src).toContain("export function MessagesInbox({ variant = 'buyer' }");
  });

  it('pushed from Profile: same header plus a bare back arrow, no compose-a-new-DM entry', () => {
    expect(src).toContain('onBack={isSeller ? () => goBackOr(router) : undefined}');
    expect(src).toContain("{ name: 'plus', onPress: () => openInboxComposeMenu(router), accessibilityLabel: 'Create or join a group', testID: 'inbox-header-compose' }");
    // The buyer "+" is unchanged.
    expect(src).toContain("{ name: 'plus', onPress: () => openInboxComposeMenu(router, openCompose), accessibilityLabel: 'New message or group', testID: 'inbox-header-compose' }");
  });

  it('the other participant is whoever is not me; buyer_to_buyer threads stay out of the seller inbox', () => {
    expect(src).toContain('? (conv.participants.find(p => p.userId !== userId) ?? conv.participants[0])');
    expect(src).toContain("c.type !== 'buyer_to_buyer'");
  });

  it('seller empty state: same layout, seller copy, no button; no filter pill, no Suggested', () => {
    expect(src).toContain('>No messages yet</Text>');
    expect(src).toContain('Messages from buyers show up here');
    expect(src).toContain('onFilterPress={isSeller ? undefined : openFilterMenu}');
    expect(src).toContain('if (isSeller || suggestedLoading || suggestedPeople.length === 0) return null;');
  });

  it('keeps the seller first-run tip', () => {
    expect(src).toContain("id={isSeller ? 'seller-inbox' : 'buyer-inbox'}");
    expect(src).toContain('gesture={isSeller ? SELLER_INBOX_GESTURE : BUYER_INBOX_GESTURE}');
  });
});

describe('TabPageHeader back arrow is additive', () => {
  const src = read('components/layout/TabPageHeader.tsx');
  it('renders the arrow only when onBack is passed', () => {
    expect(src).toContain('onBack?: () => void;');
    expect(src).toContain('{onBack ? (');
    expect(src).toContain('<Feather name="arrow-left" size={ICON.md} color={theme.text} />');
  });
});

describe('ConversationThread seller variant', () => {
  const src = read('components/chat/ConversationThread.tsx');

  it('defaults to the buyer variant', () => {
    expect(src).toContain("export function ConversationThread({ variant = 'buyer' }");
  });

  it('seller preview threads and data come from the seller seeds', () => {
    expect(src).toContain('const isPreviewId = (id: string) => (isSeller ? isSellerPreviewConversationId(id) : isPreviewConversationId(id));');
    expect(src).toContain('loadedConv = isSeller ? getSellerPreviewConversation(params.id) : getPreviewConversation(params.id);');
    expect(src).toContain('const seeded = isSeller ? getSellerPreviewMessages(loadedConv.id) : getPreviewMessages(loadedConv.id);');
  });

  it('the counterpart is whoever is not me', () => {
    expect(src).toContain('? (conv?.participants.find((p) => p.userId !== myId && p.userId !== MY_USER_ID) ?? conv?.participants[0] ?? null)');
  });

  it('chat details, theme picker and calls carry the seller role; buyer stays buyer', () => {
    expect(src).toContain("id: conv.id, role: isSeller ? 'seller' : 'buyer',");
    expect(src).toContain("id: conv.id, role: isSeller ? 'seller' : 'buyer', openTheme: '1',");
    expect(src).toContain("surface: isSeller ? 'seller' : 'buyer',");
  });

  it('order cards open the seller order detail; the buyer keeps its own routes', () => {
    expect(src).toContain("router.push((orderId ? '/order-detail?id=' + orderId : '/(tabs)/orders') as never);");
    expect(src).toContain("router.push(('/buyer-order-detail?id=' + orderId) as never);");
  });

  it('the store attach sheet lists the seller\'s OWN store, plus the linked order', () => {
    expect(src).toContain("const storeOwnerId = isSeller ? (userId ?? '') : sellerUserId;");
    expect(src).toContain("{isSeller ? 'Share from your store' : `Share from ${displayName}'s store`}");
    expect(src).toContain('testID="conversation-attach-linked-order"');
  });

  it('"Orders from <buyer>" lives in the options sheet, loaded from the real scoped endpoint (seeds in preview)', () => {
    expect(src).toContain("...(isSeller ? [{ text: `Orders from ${participant.name}`, onPress: openBuyerOrders }] : []),");
    expect(src).toContain('const rows = await api.orders.listForBuyer(participant.userId);');
    expect(src).toContain('setBuyerOrders(getSellerPreviewBuyerOrders(conv.id));');
  });

  it('a preview seller thread never calls the store APIs', () => {
    expect(src.match(/if \(isSeller && conv && isPreviewId\(conv\.id\)\) return;/g)?.length).toBe(2);
  });

  it('moderation-removed messages show the removal line on the seller side', () => {
    expect(src).toContain("const removedByModeration = isSeller && (msg as { removedByModeration?: boolean }).removedByModeration === true;");
    expect(src).toContain('{REMOVED_MESSAGE_TEXT}');
  });
});
