/**
 * Seller 1:1 chat thread. Dev's direction: identical to the buyer thread,
 * so this route renders the same shared screen
 * (components/chat/ConversationThread.tsx) as the seller variant — only the
 * seller's own data (buyer, orders, own store, seller preview threads and
 * request actions) is swapped in.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function SellerConversationScreen() {
  return <ConversationThread variant="seller" />;
}
