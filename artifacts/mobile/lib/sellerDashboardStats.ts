export function deriveOrderStats(rows: any[]) {
  return {
    newOrders: rows.filter((order) => order.status === 'new' || order.status === 'pending').length,
    toProcess: rows.filter((order) => order.status === 'processing').length,
    // The production orders API uses "fulfilled" for packed orders awaiting shipment.
    readyToShip: rows.filter((order) => order.status === 'ready_to_ship' || order.status === 'fulfilled').length,
  };
}

export function deriveInventoryStats(rows: any[]) {
  return {
    lowStockCount: rows.filter((item) => {
      const stock = Number(item.stock ?? item.onHand ?? item.available ?? 0);
      const threshold = Number(item.lowStockThreshold ?? 0);
      return stock > 0 && stock <= threshold;
    }).length,
    outOfStockCount: rows.filter((item) => Number(item.stock ?? item.onHand ?? item.available ?? 0) <= 0).length,
    incomingCount: rows.filter((item) => Number(item.incoming ?? 0) > 0).length,
    delayedCount: rows.filter((item) => item.incomingStatus === 'delayed' || item.status === 'delayed').length,
  };
}

export function deriveHubStats(quotes: any[], samples: any[], threads: any[]) {
  return {
    activeQuotes: quotes.filter((quote) => !['declined', 'cancelled', 'accepted'].includes(String(quote.status))).length,
    samplesNeedingReview: samples.filter((sample) => sample.status === 'review_needed' || sample.status === 'delivered').length,
    activeProduction: samples.filter((sample) =>
      ['processing', 'cut_and_sew', 'packing'].includes(String(sample.status)),
    ).length,
    unreadMessages: threads.reduce((total, thread) => total + Number(thread.unreadCount ?? 0), 0),
  };
}
