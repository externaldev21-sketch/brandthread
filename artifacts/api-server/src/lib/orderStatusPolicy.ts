export function buildOrderStatusUpdate(status: string, reason?: string, notes?: string) {
  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "cancelled") {
    update.cancellationReason = reason;
    update.cancellationNotes = notes?.trim() || null;
  }
  return update;
}

export function orderStatusTransitionConflict(currentStatus: string) {
  return currentStatus === "label_purchasing"
    ? "A shipping label purchase is in progress"
    : null;
}