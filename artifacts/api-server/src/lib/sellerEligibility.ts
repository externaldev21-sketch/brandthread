/**
 * The sole definition of a public seller verification badge.  `users.verified`
 * is deliberately not sufficient: it is a legacy prerequisite alongside the
 * server-owned identity result, standing, and policy state.
 */
export type SellerEligibilityInput = {
  verified?: boolean | null;
  verificationStatus?: string | null;
  activeStanding?: boolean | null;
  policyRestricted?: boolean | null;
};

export function deriveSellerVerified(seller: SellerEligibilityInput): boolean {
  return seller.verified === true
    && seller.verificationStatus === "verified"
    && seller.activeStanding === true
    && seller.policyRestricted !== true;
}