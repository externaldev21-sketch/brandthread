/**
 * Sample freelancer jobs for the `&demo=1` web preview only (screenshots and
 * design review of the BT-446 delivery flow). Never used outside
 * isPreviewDemoMode(); actions in demo mode change this local copy only.
 */
import type { FreelancerJob } from '@/lib/api';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function job(partial: Partial<FreelancerJob> & Pick<FreelancerJob, 'id' | 'title' | 'status'>): FreelancerJob {
  const now = Date.now();
  return {
    freelancerId: 'demo-freelancer',
    sellerId: 'demo-seller',
    description: '',
    agreedPriceCents: 40_000,
    paymentStatus: 'paid',
    platformFeeCents: 2_000,
    freelancerPayoutCents: 38_000,
    completedAt: null,
    createdAt: new Date(now - 6 * DAY).toISOString(),
    updatedAt: new Date(now - HOUR).toISOString(),
    revisionCount: 0,
    revisionsLeft: 3,
    ...partial,
  };
}

export function demoFreelancerJobs(): { isFreelancer: boolean; asHirer: FreelancerJob[]; asFreelancer: FreelancerJob[] } {
  const now = Date.now();
  return {
    isFreelancer: true,
    asHirer: [
      job({
        id: 'demo-h1',
        title: 'Logo refresh for the fall drop',
        description: 'Two lockups and a monogram, black and white.',
        status: 'delivered',
        role: 'hirer',
        freelancerName: 'Maya Chen',
        serviceType: 'branding',
        deliveredAt: new Date(now - 20 * HOUR).toISOString(),
        deliveryNote: 'Final logo files and the monogram are in the shared folder. The lockups come in black, white and silver.',
        autoReleaseAt: new Date(now + 2 * DAY + 4 * HOUR).toISOString(),
      }),
      job({
        id: 'demo-h2',
        title: 'Lookbook copy',
        status: 'in_progress',
        role: 'hirer',
        freelancerName: 'Jordan Ellis',
        serviceType: 'copywriting',
        agreedPriceCents: 15_000,
        freelancerPayoutCents: 14_250,
        deliveredAt: new Date(now - 2 * DAY).toISOString(),
        revisionCount: 1,
        revisionsLeft: 2,
        revisionNote: 'Shorter captions, one line each.',
      }),
      job({
        id: 'demo-h3',
        title: 'Product photos, 12 looks',
        status: 'disputed',
        role: 'hirer',
        freelancerName: 'Theo Park',
        serviceType: 'photography',
        agreedPriceCents: 60_000,
        freelancerPayoutCents: 57_000,
        deliveredAt: new Date(now - 3 * DAY).toISOString(),
        disputedAt: new Date(now - DAY).toISOString(),
        disputeReason: 'Only 6 of the 12 looks were delivered.',
      }),
    ],
    asFreelancer: [
      job({
        id: 'demo-f1',
        title: 'Drop teaser edit',
        status: 'in_progress',
        role: 'freelancer',
        hirerName: 'Northside Studio',
        agreedPriceCents: 25_000,
        freelancerPayoutCents: 23_750,
        deliveredAt: new Date(now - DAY).toISOString(),
        revisionCount: 1,
        revisionsLeft: 2,
        revisionNote: 'Cut it to 15 seconds and end on the logo.',
      }),
      job({
        id: 'demo-f2',
        title: 'Brand guidelines',
        status: 'delivered',
        role: 'freelancer',
        hirerName: 'Atelier Rue',
        deliveredAt: new Date(now - 6 * HOUR).toISOString(),
        deliveryNote: 'Guidelines PDF with type, color and logo usage.',
        autoReleaseAt: new Date(now + 2 * DAY + 18 * HOUR).toISOString(),
      }),
      job({
        id: 'demo-f3',
        title: 'Hang tag design',
        status: 'completed',
        role: 'freelancer',
        hirerName: 'Atelier Rue',
        agreedPriceCents: 12_000,
        freelancerPayoutCents: 11_400,
        completedAt: new Date(now - 4 * DAY).toISOString(),
      }),
    ],
  };
}

/** Local-only transition for demo mode (no API call). */
export function applyDemoAction(
  j: FreelancerJob,
  action: 'deliver' | 'approve' | 'revision' | 'dispute',
  text: string,
): FreelancerJob {
  const now = new Date();
  switch (action) {
    case 'deliver':
      return { ...j, status: 'delivered', deliveredAt: now.toISOString(), deliveryNote: text || null, autoReleaseAt: new Date(now.getTime() + 3 * DAY).toISOString() };
    case 'approve':
      return { ...j, status: 'completed', completedAt: now.toISOString(), autoReleaseAt: null, approvedBy: 'hirer' };
    case 'revision': {
      const count = (j.revisionCount ?? 0) + 1;
      return { ...j, status: 'in_progress', revisionCount: count, revisionsLeft: Math.max(0, 3 - count), revisionNote: text, autoReleaseAt: null };
    }
    case 'dispute':
      return { ...j, status: 'disputed', disputedAt: now.toISOString(), disputeReason: text, autoReleaseAt: null };
  }
}
