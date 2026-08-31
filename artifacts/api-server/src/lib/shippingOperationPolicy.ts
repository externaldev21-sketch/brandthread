export function mayResumePurchase(orderStatus: string, openLabelStatus?: string) {
  return openLabelStatus === "purchasing"
    || ["pending", "processing", "fulfilled"].includes(orderStatus);
}

export function mayReclaimVoid(status: string, updatedAt: Date | string, nowMs: number, leaseMs = 30_000) {
  return status === "void_pending" && nowMs - new Date(updatedAt).valueOf() >= leaseMs;
}

export function isPendingProviderPurchase(status: string) {
  return ["QUEUED", "WAITING", "PENDING"].includes(status);
}