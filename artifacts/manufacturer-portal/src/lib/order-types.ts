export type OrderCardSnapshot = {
  id: string;
  orderType: "sample" | "bulk" | string;
  title: string;
  description: string | null;
  quantity: number;
  priceCents: number;
  currency: string;
  status: string;
  issuedBy: string;
  carrier: string | null;
  trackingNumber: string | null;
  paymentReviewState: string;
  manufacturerPayoutReady: boolean;
  revision: number;
  updatedAt: string;
};

export type TimelineStep = {
  stage: string;
  label: string;
  description: string;
  state: "done" | "current" | "upcoming";
  at: string | null;
};

export type OrderTimeline = {
  viewerRole: "seller" | "manufacturer";
  order: OrderCardSnapshot;
  manufacturer?: { id: string; businessName: string; country: string; timeZone: string | null };
  steps: TimelineStep[];
  events: Array<{ id: string; actorRole: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  createdAt: string;
  paidAt: string | null;
  tracking: { carrier: string | null; carrierName: string | null; trackingNumber: string | null; url: string | null };
};

export type ConnectStatus = {
  connected: boolean;
  ready: boolean;
  status: "not_started" | "pending" | "restricted" | "active";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  recovery: string | null;
  country?: string | null;
  payoutCurrency?: string | null;
  accountType?: "full" | "recipient" | null;
  countryProblem?: string | null;
};
