export const TERMINAL_ORDER_STATUSES = new Set([
  "delivered",
  "approved",
  "rejected",
  "cancelled",
  // Kept for previously persisted orders created before the shared contract.
  "complete",
  "completed",
]);

export function isTerminalOrderStatus(status: string): boolean {
  return TERMINAL_ORDER_STATUSES.has(status);
}