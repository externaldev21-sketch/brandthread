/** Account status (strikes) and your own reports — server: api-server lib/accountStatus.ts. */
export type Standing = 'good' | 'at_risk' | 'limit_reached' | 'suspended';

export type Strike = {
  id: string;
  kind: 'community' | 'ip';
  title: string;
  reasonLabel: string;
  issuedAt: string;
  expiresAt: string;
  active: boolean;
};

export type AccountStatus = {
  standing: Standing;
  headline: string;
  activeStrikes: number;
  strikeLimit: number;
  windowDays: number;
  strikes: Strike[];
};

export type MyReport = {
  id: string;
  targetType: string;
  targetLabel: string | null;
  reasonLabel: string;
  status: 'in_review' | 'removed' | 'no_violation';
  statusLabel: string;
  createdAt: string;
  resolvedAt: string | null;
};

/** One line under the headline, in Instagram's Account Status voice. */
export function standingDetail(status: Pick<AccountStatus, 'standing' | 'strikeLimit' | 'windowDays'>): string {
  switch (status.standing) {
    case 'suspended': return 'You can’t post, sell or message until a moderator reinstates your account.';
    case 'limit_reached': return `You have ${status.strikeLimit} active strikes. A moderator will review your account.`;
    case 'at_risk': return `Strikes expire after ${status.windowDays} days. At ${status.strikeLimit}, your account is reviewed for suspension.`;
    default: return 'You haven’t broken any rules. Thanks for keeping Brandthread safe.';
  }
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
