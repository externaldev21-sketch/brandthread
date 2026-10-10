/**
 * Buyer 1:1 chat thread. The screen itself lives in
 * components/chat/ConversationThread.tsx, shared with the seller side
 * (app/seller-conversation.tsx) so both sides of a DM look and behave the
 * same; this route renders it unchanged as the buyer variant.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function BuyerConversationScreen() {
  return <ConversationThread variant="buyer" />;
}
