/**
 * Seller launch checklist — the ordered steps a seller completes to open their
 * store, each with a done flag derived from real account state. Pure so the
 * route and the unit tests share one definition.
 */

export const LAUNCH_STEP_IDS = [
  "name_handle",
  "logo_banner",
  "accent",
  "socials",
  "first_product",
  "shipping",
  "preview",
  "publish",
  "payouts",
] as const;

export type LaunchStepId = (typeof LAUNCH_STEP_IDS)[number];

export interface LaunchChecklistInput {
  brandName: string | null;
  username: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  storeAccentColor: string | null;
  socialLinks: Record<string, unknown> | null;
  productCount: number;
  /** At least one shipping zone or shipping rate exists. */
  shippingConfigured: boolean;
  storePreviewedAt: Date | null;
  storePublished: boolean;
  stripeAccountStatus: string | null;
}

export interface LaunchStep {
  id: LaunchStepId;
  done: boolean;
}

export interface LaunchChecklist {
  steps: LaunchStep[];
  doneCount: number;
  total: number;
  complete: boolean;
}

const filled = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const hasSocial = (links: Record<string, unknown> | null): boolean =>
  !!links && (filled(links.instagram) || filled(links.tiktok));

export function deriveLaunchChecklist(input: LaunchChecklistInput): LaunchChecklist {
  const done: Record<LaunchStepId, boolean> = {
    name_handle: filled(input.brandName) && filled(input.username),
    logo_banner: filled(input.logoUrl) && filled(input.bannerUrl),
    accent: filled(input.storeAccentColor),
    socials: hasSocial(input.socialLinks),
    first_product: input.productCount > 0,
    shipping: input.shippingConfigured,
    preview: input.storePreviewedAt != null,
    publish: input.storePublished,
    payouts: input.stripeAccountStatus === "active",
  };
  const steps = LAUNCH_STEP_IDS.map((id) => ({ id, done: done[id] }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}
