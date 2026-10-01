/**
 * Who is looking at a profile, and what that person may see — one pure table
 * shared by every profile screen (seller owner tab, seller-as-seen-by-others,
 * buyer owner tab, buyer-as-seen-by-others).
 *
 * The mode is decided ONLY by `viewerId === ownerId` (Instagram's own-profile
 * vs other-profile rule), never by route or a route param. The one exception
 * is the owner's "View as visitor" preview, which can only ever *downgrade*
 * an owner to the visitor view — a param can never upgrade a visitor.
 *
 * The capability table is the UI half of the privacy rule; the server half is
 * the allow-listed public payloads in api-server/src/lib/publicProfile.ts.
 */

export type ProfileRole = 'seller' | 'buyer';
export type ProfileMode = 'owner' | 'visitor';

export function resolveProfileMode(opts: {
  viewerId: string | null | undefined;
  ownerId: string | null | undefined;
  /** The owner's "View as visitor" preview. Ignored unless the viewer really is the owner. */
  previewAsVisitor?: boolean;
}): ProfileMode {
  const { viewerId, ownerId, previewAsVisitor } = opts;
  if (!viewerId || !ownerId || viewerId !== ownerId) return 'visitor';
  return previewAsVisitor ? 'visitor' : 'owner';
}

export interface ProfileCapabilities {
  // ── Shown to everyone ──
  showIdentity: true;
  showCounts: true;
  showHighlights: true;
  showPostsTab: true;
  showTaggedTab: true;
  // ── Seller storefront ──
  /** Products tab (seller profiles only). */
  showProductsTab: boolean;
  /** "Buy now" / "Add to cart" on products (visitors). */
  canBuy: boolean;
  /** Edit affordances on the product grid instead of Buy (owner). */
  canEditProducts: boolean;
  // ── Visitor actions ──
  showFollow: boolean;
  showMessage: boolean;
  /** The "..." menu holds Share / Report / Block for a visitor. */
  showVisitorMenu: boolean;
  // ── Owner-only ──
  showPlanChip: boolean;
  showDashboard: boolean;
  showEditProfile: boolean;
  showInbox: boolean;
  showInsights: boolean;
  showDrafts: boolean;
  /** Saved / Liked / Orders tabs, Thread Cash, activity, settings and account switcher. */
  showPrivateBuyerData: boolean;
  showViewAsVisitor: boolean;
  showShare: boolean;
}

export function profileCapabilities(role: ProfileRole, mode: ProfileMode): ProfileCapabilities {
  const owner = mode === 'owner';
  const seller = role === 'seller';
  return {
    showIdentity: true,
    showCounts: true,
    showHighlights: true,
    showPostsTab: true,
    showTaggedTab: true,
    showProductsTab: seller,
    canBuy: seller && !owner,
    canEditProducts: seller && owner,
    showFollow: !owner,
    showMessage: !owner,
    showVisitorMenu: !owner,
    showPlanChip: seller && owner,
    showDashboard: seller && owner,
    showEditProfile: owner,
    showInbox: owner,
    showInsights: seller && owner,
    showDrafts: owner,
    showPrivateBuyerData: !seller && owner,
    showViewAsVisitor: owner,
    showShare: true,
  };
}

/** Params that request the owner's visitor preview. */
export function isVisitorPreviewParam(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v === '1' || v === 'true';
}

/** Route for the owner's "View as visitor" preview of their own profile. */
export function viewAsVisitorHref(role: ProfileRole, ownerId: string): string {
  return role === 'seller'
    ? `/seller-profile?id=${encodeURIComponent(ownerId)}&asVisitor=1`
    : `/buyer-other-profile?userId=${encodeURIComponent(ownerId)}&asVisitor=1`;
}

// ─── Owner-only plan chip (never rendered for visitors; see showPlanChip) ─────

export interface PlanInfo { planId: string | null; status: string | null }

export function hasPaidPlan(plan: PlanInfo | null | undefined): boolean {
  return !!(plan?.planId || plan?.status === 'active');
}

export function planChipLabel(plan: PlanInfo | null | undefined): string {
  if (plan?.planId) return `${plan.planId.charAt(0).toUpperCase()}${plan.planId.slice(1)} Plan`;
  return plan?.status === 'active' ? 'Active Plan' : 'Free Plan';
}
