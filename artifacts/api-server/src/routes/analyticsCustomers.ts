type DbRow = Record<string, unknown>;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

export function buildCustomerAnalyticsResponse(
  topRows: readonly DbRow[],
  statsRows: readonly DbRow[],
) {
  const stats = statsRows[0] ?? {};
  const totalCustomers = numberValue(stats.total_customers);
  const repeatCustomers = numberValue(stats.repeat_customers);

  return {
    topCustomers: topRows.map((row) => ({
      buyerId:      typeof row.buyer_id === "string" ? row.buyer_id : null,
      customerId:   typeof row.customer_id === "string" ? row.customer_id : null,
      name:         stringValue(row.name, "Customer"),
      email:        stringValue(row.email),
      orderCount:   numberValue(row.order_count),
      totalCents:   numberValue(row.total_cents),
      lastOrderAt:  dateValue(row.last_order_at),
      firstOrderAt: dateValue(row.first_order_at),
    })),
    stats: {
      totalCustomers,
      repeatCustomers,
      repeatRate: totalCustomers > 0
        ? Math.round((repeatCustomers / totalCustomers) * 100)
        : 0,
      avgOrdersPerCustomer: numberValue(stats.avg_orders_per_customer),
    },
  };
}