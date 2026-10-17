/** Helpers for Security → User activity logs (team audit log + sign-ins). */

export type TeamActivityFilter = 'all' | 'session' | 'order' | 'product' | 'team';

export const TEAM_ACTIVITY_FILTERS: { key: TeamActivityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'session', label: 'Sign-ins' },
  { key: 'order', label: 'Orders' },
  { key: 'product', label: 'Products' },
  { key: 'team', label: 'Team' },
];

/** resourceType query param for GET /api/team/activity (undefined = all). */
export function activityResourceType(filter: TeamActivityFilter): string | undefined {
  return filter === 'all' ? undefined : filter;
}

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface TeamMemberLike {
  status?: string;
  online?: boolean;
  isOwner?: boolean;
  lastActiveAt?: string | null;
}

export function memberLastSeenLabel(m: TeamMemberLike, now: number = Date.now()): string {
  if (m.status === 'pending') return 'Invite not accepted yet';
  if (m.online) return 'Active now';
  if (m.isOwner) return 'Store owner';
  const rel = relativeTime(m.lastActiveAt, now);
  return rel ? `Last active ${rel}` : 'Not signed in yet';
}
