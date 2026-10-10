import { describe, expect, it } from 'vitest';
import { checklistProgress, currentStep, storeSiteChecklist, type StoreSiteChecklistInput } from './storeSiteChecklist';

const fresh: StoreSiteChecklistInput = { hasLogo: false, bio: '', productCount: 0, socialCount: 0, designSaved: false, linkShared: false, skipped: [] };

describe('store website checklist', () => {
  it('has Linktree’s five steps for the store, in order', () => {
    expect(storeSiteChecklist(fresh).map((s) => s.title)).toEqual([
      'Add your logo and bio', 'Add your products', 'Add your socials', 'Customize your design', 'Share your link',
    ]);
  });
  it('starts at zero for a fresh store and expands the first step', () => {
    const steps = storeSiteChecklist(fresh);
    expect(checklistProgress(steps)).toEqual({ done: 0, total: 5, complete: false });
    expect(currentStep(steps)?.id).toBe('logo_bio');
  });
  it('needs both a logo and a bio for the first step', () => {
    expect(storeSiteChecklist({ ...fresh, hasLogo: true }).find((s) => s.id === 'logo_bio')?.done).toBe(false);
    expect(storeSiteChecklist({ ...fresh, hasLogo: true, bio: 'Knitwear' }).find((s) => s.id === 'logo_bio')?.done).toBe(true);
  });
  it('counts real data and skips, and finishes when everything is done', () => {
    const steps = storeSiteChecklist({ hasLogo: true, bio: 'x', productCount: 3, socialCount: 1, designSaved: true, linkShared: false, skipped: ['share'] });
    expect(checklistProgress(steps).complete).toBe(true);
    expect(currentStep(steps)).toBeNull();
  });
  it('moves on to the next open step', () => {
    const steps = storeSiteChecklist({ ...fresh, hasLogo: true, bio: 'x', productCount: 2 });
    expect(currentStep(steps)?.id).toBe('socials');
    expect(checklistProgress(steps).done).toBe(2);
  });
});
