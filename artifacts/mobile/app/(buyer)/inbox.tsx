/**
 * Buyer Messages tab. The whole screen lives in the shared
 * components/inbox/MessagesInbox.tsx, which the seller's Messages screen
 * (app/seller-inbox.tsx) renders too — Dev: the buyer inbox is the
 * reference, the seller side reuses it directly (shared component, not a
 * copy), swapping only seller-specific data.
 */
import React from 'react';
import { MessagesInbox } from '@/components/inbox/MessagesInbox';

export default function InboxScreen() {
  return <MessagesInbox variant="buyer" />;
}
