// Buyer's Feed — same as the shared feed but without the brand stories strip
import FeedScreen from '../(tabs)/feed';
import React from 'react';

export default function BuyerFeed() {
  return <FeedScreen showStories={false} />;
}
