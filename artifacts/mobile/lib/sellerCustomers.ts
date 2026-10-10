/**
 * Seller Customers list helpers (app/customers.tsx, app/customer-orders.tsx).
 *
 * Row layout follows Shopify iOS "Customers": name, location, then
 * "<amount spent> • <n> orders" — pure string building so it's testable.
 */
import { formatCents } from './money';

export type CustomerSort = 'recent' | 'spend' | 'name';

export const CUSTOMER_SORT_OPTIONS: { id: CustomerSort; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'spend', label: 'Amount spent' },
  { id: 'name', label: 'Name A-Z' },
];

export interface CustomerAddress {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface SellerCustomer {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  /** The API stores address as JSON ({ street, city, state, zip, country }). */
  address?: CustomerAddress | string | null;
  tags?: string[];
  notes?: string | null;
  orderCount?: number;
  totalSpentCents?: number;
  createdAt: string;
}

/** "Austin, TX" / "Singapore" / null — never the street line. */
export function customerLocation(address: SellerCustomer['address']): string | null {
  if (!address) return null;
  if (typeof address === 'string') return address.trim() || null;
  const parts = [address.city, address.state || address.country]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function ordersLabel(count: number): string {
  return `${count} order${count === 1 ? '' : 's'}`;
}

/** Shopify row line: "$174.93 • 2 orders". */
export function customerSpendLine(c: Pick<SellerCustomer, 'orderCount' | 'totalSpentCents'>): string {
  return `${formatCents(c.totalSpentCents ?? 0)} • ${ordersLabel(c.orderCount ?? 0)}`;
}

export function sortCustomers<T extends SellerCustomer>(list: T[], sort: CustomerSort): T[] {
  const out = [...list];
  switch (sort) {
    case 'spend':
      return out.sort((a, b) => (b.totalSpentCents ?? 0) - (a.totalSpentCents ?? 0));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'recent':
    default:
      return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

/** Same match the API's ?search= does (name or email, case-insensitive). */
export function matchesCustomerSearch(c: Pick<SellerCustomer, 'name' | 'email'>, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term);
}
