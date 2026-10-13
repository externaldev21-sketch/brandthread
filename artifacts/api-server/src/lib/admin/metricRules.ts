/** Thresholds for the admin metrics, kept free of DB imports so they unit-test in Node. */

export const SELLER_RISK_THRESHOLD = 0.02; // flag above a 2% refund or chargeback rate
export const INACTIVE_SELLER_DAYS = 14;

/** Rates and the >2% flag for one seller's counts. */
export function sellerRiskRates(orders: number, refundedOrders: number, chargebacks: number) {
  const refundRate = orders > 0 ? refundedOrders / orders : 0;
  const chargebackRate = orders > 0 ? chargebacks / orders : 0;
  return {
    refundRate, chargebackRate,
    flagged: refundRate > SELLER_RISK_THRESHOLD || chargebackRate > SELLER_RISK_THRESHOLD,
  };
}
