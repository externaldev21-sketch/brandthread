/**
 * Who sees what on Billing (QA-0048 / QA-0049). "Owner access required" is
 * only for a team member the server says is not the owner — never for a
 * failed or still-loading role lookup, and never for the store owner.
 */
export type BillingAccess = 'loading' | 'preview' | 'owner' | 'read_only' | 'locked' | 'retry';

export function billingAccess(input: {
  /** Signed-out seller web preview: show the owner's screen, call no API. */
  isSellerPreview: boolean;
  isLoadingRole: boolean;
  currentRole: string | null;
  roleError: boolean;
}): BillingAccess {
  if (input.isSellerPreview) return 'preview';
  if (input.isLoadingRole) return 'loading';
  if (input.roleError) return 'retry';
  if (input.currentRole === 'owner') return 'owner';
  if (input.currentRole === 'manager') return 'read_only';
  return input.currentRole ? 'locked' : 'retry';
}
