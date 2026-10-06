/**
 * Seller Messages. Dev's direction: the seller inbox looks and behaves
 * IDENTICALLY to the buyer one, so this route renders the same shared
 * component (components/inbox/MessagesInbox.tsx) with the seller variant —
 * only the data (buyers / orders / products, seller preview ids, seller
 * thread route) is swapped.
 */
import React from 'react';

import { MessagesInbox } from '@/components/inbox/MessagesInbox';

export default function SellerInboxScreen() {
  return <MessagesInbox variant="seller" />;
}
