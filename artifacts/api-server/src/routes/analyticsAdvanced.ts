/**
 * Advanced analytics (Brandthread Pro): customer cohorts, lifetime value and
 * average order value by month. Pure shaping lives here so it can be tested
 * without a database; the route in analytics.ts runs the queries.
 */
type DbRow = Record<string, unknown>;

export const ADVANCED_MONTHS = 6;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** The last `count` calendar months (UTC) ending at `now`, oldest first, as "YYYY-MM". */
export function lastMonthKeys(now: Date, count = ADVANCED_MONTHS): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function buildAdvancedAnalyticsResponse(
  cohortRows: readonly DbRow[],
  monthRows: readonly DbRow[],
  lifetimeRows: readonly DbRow[],
  now: Date = new Date(),
) {
  const months = lastMonthKeys(now);
  const cohortByMonth = new Map(cohortRows.map((r) => [String(r.cohort), r]));
  const orderByMonth = new Map(monthRows.map((r) => [String(r.month), r]));
  const life = lifetimeRows[0] ?? {};
  const totalCustomers = num(life.customers);

  return {
    months,
    cohorts: months.map((month) => {
      const row = cohortByMonth.get(month);
      const customers = num(row?.customers);
      const repeatCustomers = num(row?.repeat_customers);
      return {
        month,
        customers,
        repeatCustomers,
        repeatRate: customers > 0 ? Math.round((repeatCustomers / customers) * 100) : 0,
        revenueCents: num(row?.revenue_cents),
      };
    }),
    orderValue: months.map((month) => {
      const row = orderByMonth.get(month);
      const orders = num(row?.orders);
      const revenueCents = num(row?.revenue_cents);
      return {
        month,
        orders,
        revenueCents,
        averageOrderCents: orders > 0 ? Math.round(revenueCents / orders) : 0,
      };
    }),
    lifetime: {
      customers: totalCustomers,
      revenueCents: num(life.revenue_cents),
      // Average revenue per customer across their whole history, integer cents.
      averageLifetimeValueCents: totalCustomers > 0 ? Math.round(num(life.revenue_cents) / totalCustomers) : 0,
    },
  };
}
