/** Shapes returned by the affiliate / creator program API (all money in integer cents). */
export type AffiliateStats = {
  clicks: number;
  orders: number;
  revenueCents: number;
  earnedCents: number;
  pendingCents: number;
  payableCents: number;
  paidCents: number;
};

export type CreatorPayoutStatus = {
  available: boolean;
  reason: string | null;
  connected: boolean;
  ready: boolean;
};

export type CreatorBrand = {
  id: string;
  sellerId: string;
  status: 'invited' | 'pending' | 'active' | 'paused';
  code: string;
  brandName: string;
  brandUsername: string | null;
  brandImageUrl: string | null;
  programEnabled: boolean;
  commissionPercent: number;
  buyerDiscountPercent: number;
  windowDays: number;
  holdDays: number;
  minPayoutCents: number;
  shareLink: string | null;
  stats: AffiliateStats;
};

export type CreatorOverview = {
  brands: CreatorBrand[];
  totals: AffiliateStats;
  payout: CreatorPayoutStatus;
};

export type CreatorPayout = {
  id: string;
  sellerId: string;
  brandName: string;
  amountCents: number;
  state: 'processing' | 'paid' | 'failed';
  failureCode: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type BrandProgramInfo = {
  sellerId: string;
  brandName: string;
  username: string | null;
  imageUrl: string | null;
  program: {
    enabled: boolean;
    commissionPercent: number;
    buyerDiscountPercent: number;
    windowDays: number;
    autoApprove: boolean;
  };
  mine: { id: string; status: string } | null;
  isOwnBrand: boolean;
};

export type SellerProgram = {
  enabled: boolean;
  commissionPercent: number;
  buyerDiscountPercent: number;
  windowDays: number;
  holdDays: number;
  minPayoutCents: number;
  autoApprove: boolean;
};

export type SellerCreator = {
  id: string;
  creatorId: string;
  status: 'invited' | 'pending' | 'active' | 'paused' | 'removed';
  origin: 'invite' | 'apply';
  code: string;
  commissionPercent: number;
  hasOverride: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  stats: AffiliateStats;
};

export type SellerAffiliateOverview = {
  program: SellerProgram;
  creators: SellerCreator[];
  totals: AffiliateStats;
  programLink: string;
  payoutsAvailable: boolean;
};
