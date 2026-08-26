import { describe, expect, it } from "vitest";
import { buildCustomerAnalyticsResponse } from "./analyticsCustomers";

describe("buildCustomerAnalyticsResponse", () => {
  it("preserves customer history IDs and maps ranked spend from query-result rows", () => {
    const response = buildCustomerAnalyticsResponse(
      [
        {
          buyer_id: "buyer_123",
          customer_id: "customer-uuid-1",
          name: "Alex Morgan",
          email: "alex@example.com",
          order_count: 3,
          total_cents: 24500,
          last_order_at: "2026-08-20T12:00:00.000Z",
          first_order_at: "2026-07-01T12:00:00.000Z",
        },
      ],
      [
        {
          total_customers: 4,
          repeat_customers: 2,
          avg_orders_per_customer: "1.75",
        },
      ],
    );

    expect(response).toEqual({
      topCustomers: [
        {
          buyerId: "buyer_123",
          customerId: "customer-uuid-1",
          name: "Alex Morgan",
          email: "alex@example.com",
          orderCount: 3,
          totalCents: 24500,
          lastOrderAt: "2026-08-20T12:00:00.000Z",
          firstOrderAt: "2026-07-01T12:00:00.000Z",
        },
      ],
      stats: {
        totalCustomers: 4,
        repeatCustomers: 2,
        repeatRate: 50,
        avgOrdersPerCustomer: 1.75,
      },
    });
  });
});