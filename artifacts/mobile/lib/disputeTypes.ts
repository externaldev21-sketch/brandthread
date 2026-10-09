/** Shapes returned by /api/disputes (see api-server routes/disputes.ts). */

export type DisputeStepState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface DisputeTimelineStep {
  key: 'opened' | 'evidence_due' | 'submitted' | 'under_review' | 'outcome';
  label: string;
  state: DisputeStepState;
  at: string | null;
  detail: string | null;
}

export interface DisputeTimeline {
  status: string;
  evidenceDeadline: string | null;
  steps: DisputeTimelineStep[];
  events: Array<{ id: string; kind: string; occurredAt: string; payload?: Record<string, unknown> }>;
  stripe: {
    status: string;
    evidenceDueBy: string | null;
    submissionCount: number;
    pastDue: boolean;
    hasEvidence: boolean;
  } | null;
}

/** Each type is the Stripe evidence field the file is sent under. */
export type DisputeFileType =
  | 'receipt'
  | 'shipping_documentation'
  | 'customer_communication'
  | 'customer_signature'
  | 'refund_policy'
  | 'uncategorized_file';

export interface DisputeEvidenceFile {
  id: string;
  evidenceType: DisputeFileType | string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DisputeListItem {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  evidenceDeadline: string | null;
  evidenceSubmittedAt: string | null;
  createdAt: string;
}
