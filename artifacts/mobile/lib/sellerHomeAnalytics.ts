export type SellerHomeAnalytics = {
  range: string;
  totalCents: number;
  orderCount: number;
  visitorCount: number;
  toFulfill: number;
  toCapture: number;
  buckets: Array<{ bucket: string; totalCents: number; orderCount: number }>;
};

export type SellerHomeAnalyticsSnapshot = {
  key: string;
  data: SellerHomeAnalytics;
};

export function zeroSellerHomeAnalytics(range: string): SellerHomeAnalytics {
  return {
    range,
    totalCents: 0,
    orderCount: 0,
    visitorCount: 0,
    toFulfill: 0,
    toCapture: 0,
    buckets: [],
  };
}

export function sellerHomeAnalyticsKey(userId: string, range: string): string {
  return `${userId}:${range}`;
}

export function selectSellerHomeAnalytics(
  snapshot: SellerHomeAnalyticsSnapshot | null,
  userId: string | null | undefined,
  range: string,
): SellerHomeAnalytics | null {
  if (!userId) return zeroSellerHomeAnalytics(range);
  const key = sellerHomeAnalyticsKey(userId, range);
  return snapshot?.key === key ? snapshot.data : null;
}