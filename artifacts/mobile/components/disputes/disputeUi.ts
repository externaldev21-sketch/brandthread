import type { DisputeFileType, DisputeStepState, DisputeTimelineStep } from '@/lib/disputeTypes';

export const DISPUTE_FILE_TYPES: { key: DisputeFileType; label: string }[] = [
  { key: 'receipt', label: 'Receipt' },
  { key: 'shipping_documentation', label: 'Shipping proof' },
  { key: 'customer_communication', label: 'Customer messages' },
  { key: 'customer_signature', label: 'Signature' },
  { key: 'refund_policy', label: 'Refund policy' },
  { key: 'uncategorized_file', label: 'Photos and other' },
];

export function fileTypeLabel(type: string): string {
  return DISPUTE_FILE_TYPES.find((t) => t.key === type)?.label ?? 'File';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'needs_response':
    case 'evidence_needed': return 'Needs response';
    case 'under_review': return 'Under review';
    case 'evidence_submitted': return 'Needs response';
    case 'won': return 'Won';
    case 'lost': return 'Lost';
    case 'closed': return 'Closed';
    default: return 'Open';
  }
}

export function isFinalStatus(status: string): boolean {
  return status === 'won' || status === 'lost' || status === 'closed';
}

/** Whole days until the deadline; negative once past. */
export function daysLeft(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export function dueChipLabel(iso: string | null | undefined, now = Date.now()): string | null {
  const d = daysLeft(iso, now);
  if (d === null) return null;
  if (d < 0) return 'Past due';
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due in 1 day';
  return `Due in ${d} days`;
}

/**
 * Client-side mirror of the server steps, used only for the signed-out
 * preview demo (&demo=1), where there is no API to ask.
 */
export function demoSteps(status: string, createdAt: string, due: string | null): DisputeTimelineStep[] {
  const final = isFinalStatus(status);
  const submitted = status === 'under_review' || status === 'won' || status === 'lost';
  const s = (state: DisputeStepState) => state;
  return [
    { key: 'opened', label: 'Dispute opened', state: s('done'), at: createdAt, detail: null },
    {
      key: 'evidence_due', label: 'Evidence due',
      state: s(submitted ? 'done' : final ? 'skipped' : 'current'),
      at: due, detail: due ? `Due ${shortDateTime(due)}` : null,
    },
    { key: 'submitted', label: 'Evidence submitted', state: s(submitted ? 'done' : final ? 'skipped' : 'upcoming'), at: null, detail: null },
    { key: 'under_review', label: 'Under review', state: s(status === 'under_review' ? 'current' : submitted && final ? 'done' : final ? 'skipped' : 'upcoming'), at: null, detail: null },
    {
      key: 'outcome',
      label: status === 'won' ? 'Won' : status === 'lost' ? 'Lost' : status === 'closed' ? 'Closed' : 'Outcome',
      state: s(final ? 'done' : 'upcoming'), at: null, detail: null,
    },
  ];
}
