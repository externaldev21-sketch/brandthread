/**
 * Thread — Buyer's home screen.
 * Shows seller-created videos with product tagging, likes, comments, reposting,
 * sharing, and direct product purchasing. Buyer posts do not appear here.
 */
import FeedScreen from '../(tabs)/feed';
import React from 'react';

export default function ThreadScreen() {
  return <FeedScreen showFashionPreview />;
}
