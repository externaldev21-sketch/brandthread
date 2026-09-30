/**
 * Carrier-provider switch for in-app shipping labels. Routes import these
 * functions and never a provider directly.
 *
 * Selection (first match wins):
 *  1. SHIPPING_PROVIDER=easypost|shippo  (explicit)
 *  2. SHIPPO_API_KEY set                 -> Shippo, direct API
 *  3. EASYPOST_API_KEY set               -> EasyPost
 *  4. otherwise                          -> Shippo through the Replit connector
 */
import * as shippo from "./shippo";
import * as easypost from "./easypost";

export type ShippingProviderName = "shippo" | "easypost";

export function activeShippingProvider(): ShippingProviderName {
  const explicit = process.env.SHIPPING_PROVIDER?.trim().toLowerCase();
  if (explicit === "easypost") return "easypost";
  if (explicit === "shippo") return "shippo";
  if (process.env.SHIPPO_API_KEY?.trim()) return "shippo";
  if (process.env.EASYPOST_API_KEY?.trim()) return "easypost";
  return "shippo";
}

const impl = () => (activeShippingProvider() === "easypost" ? easypost : shippo);

export const createShipment: typeof shippo.createShipment = (body) => impl().createShipment(body);
export const purchaseTransaction: typeof shippo.purchaseTransaction = (rateId, reference, fileType) =>
  impl().purchaseTransaction(rateId, reference, fileType);
export const findTransaction: typeof shippo.findTransaction = (reference) => impl().findTransaction(reference);
export const refundTransaction: typeof shippo.refundTransaction = (transactionId) => impl().refundTransaction(transactionId);
