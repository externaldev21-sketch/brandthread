/** Client-side search + filter for the team Roles screen. */
export interface RoleRow {
  key?: string;
  name: string;
  group?: string;
  description?: string;
  permissions?: readonly string[];
  staffCount?: number;
  pendingCount?: number;
}

export type RoleFilter = 'all' | 'organization' | 'store' | 'has_members' | 'empty';

export const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'organization', label: 'Organization' },
  { key: 'store', label: 'Store' },
  { key: 'has_members', label: 'Has members' },
  { key: 'empty', label: 'No members' },
];

export function roleFilterLabel(filter: RoleFilter): string {
  return ROLE_FILTERS.find(f => f.key === filter)?.label ?? 'All';
}

export function filterRoles<T extends RoleRow>(roles: T[], query: string, filter: RoleFilter): T[] {
  const q = query.trim().toLowerCase();
  return roles.filter(role => {
    const members = (role.staffCount ?? 0) + (role.pendingCount ?? 0);
    if (filter === 'organization' && (role.group ?? '').toLowerCase() !== 'organization') return false;
    if (filter === 'store' && (role.group ?? '').toLowerCase() !== 'store') return false;
    if (filter === 'has_members' && members === 0) return false;
    if (filter === 'empty' && members > 0) return false;
    if (!q) return true;
    const haystack = [role.name, role.group, role.description, ...(role.permissions ?? [])]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

const PERMISSION_LABELS: Record<string, string> = {
  '*': 'Everything, including billing and team',
  products: 'Products',
  orders: 'Orders',
  inventory: 'Inventory',
  analytics: 'Analytics',
  customers: 'Customers',
  marketing: 'Marketing',
  payouts: 'Payouts',
  team: 'Team',
};

export function permissionSummary(permissions: readonly string[] | undefined): string {
  if (!permissions || permissions.length === 0) return '';
  return permissions.map(p => PERMISSION_LABELS[p] ?? p).join(', ');
}
