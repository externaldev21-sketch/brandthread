/**
 * The store website setup checklist (My store), copied from Linktree's
 * "Your setup checklist" sheet: five steps, done ones struck through, the
 * first open step expanded with its action and Skip.
 *
 * Pure module so the rules are unit tested.
 */
export type StoreSiteStepId = 'logo_bio' | 'products' | 'socials' | 'design' | 'share';

export interface StoreSiteStep {
  id: StoreSiteStepId;
  title: string;
  /** One line under the expanded step. */
  detail: string;
  action: string;
  done: boolean;
}

export interface StoreSiteChecklistInput {
  hasLogo: boolean;
  bio: string;
  productCount: number;
  socialCount: number;
  /** The seller has saved the Design editor at least once. */
  designSaved: boolean;
  /** The seller has copied or shared their link. */
  linkShared: boolean;
  /** Steps the seller skipped. */
  skipped: readonly StoreSiteStepId[];
}

export function storeSiteChecklist(i: StoreSiteChecklistInput): StoreSiteStep[] {
  const skipped = new Set(i.skipped);
  const steps: StoreSiteStep[] = [];
  const add = (id: StoreSiteStepId, title: string, detail: string, action: string, done: boolean) =>
    steps.push({ id, title, detail, action, done: done || skipped.has(id) });
  add('logo_bio', 'Add your logo and bio', 'Show buyers who you are at the top of your site.', 'Add logo and bio', i.hasLogo && i.bio.trim().length > 0);
  add('products', 'Add your products', 'Products you publish show up on your site.', 'Add a product', i.productCount > 0);
  add('socials', 'Add your socials', 'Link your Instagram, TikTok and more.', 'Add socials', i.socialCount > 0);
  add('design', 'Customize your design', 'Pick a theme, buttons and font for your site.', 'Customize design', i.designSaved);
  add('share', 'Share your link', 'Put your link in your Instagram and TikTok bio.', 'Share link', i.linkShared);
  return steps;
}

export function checklistProgress(steps: readonly StoreSiteStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

/** The step shown expanded: the first one not done. */
export function currentStep(steps: readonly StoreSiteStep[]): StoreSiteStep | null {
  return steps.find((s) => !s.done) ?? null;
}
