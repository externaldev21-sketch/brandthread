// Buyer Feed — same full-screen Spotlight feed with buyerMode=true,
// which prepends the High Demand page as the first full-screen item.
import React from 'react';
import FeedScreen from '../(tabs)/feed';

export default function BuyerFeed() {
  return <FeedScreen buyerMode={true} />;
}
