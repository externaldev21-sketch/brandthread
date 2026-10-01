import type { DisputeEvidenceFile, DisputeListItem } from '@/lib/disputeTypes';

/** Shown only with ?bt_preview=seller&demo=1 and no signed-in account. */
export function demoDisputes(now = Date.now()): DisputeListItem[] {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  return [
    {
      id: 'demo-1', orderId: null, orderNumber: '#BT-1042', amount: 148, currency: 'usd',
      reason: 'product_not_received', status: 'needs_response', evidenceDeadline: iso(now + 6 * day),
      evidenceSubmittedAt: null, createdAt: iso(now - 2 * day),
    },
    {
      id: 'demo-2', orderId: null, orderNumber: '#BT-1017', amount: 62, currency: 'usd',
      reason: 'fraudulent', status: 'under_review', evidenceDeadline: iso(now - 4 * day),
      evidenceSubmittedAt: iso(now - 5 * day), createdAt: iso(now - 12 * day),
    },
    {
      id: 'demo-3', orderId: null, orderNumber: '#BT-0988', amount: 89, currency: 'usd',
      reason: 'product_unacceptable', status: 'won', evidenceDeadline: null,
      evidenceSubmittedAt: iso(now - 30 * day), createdAt: iso(now - 40 * day),
    },
    {
      id: 'demo-4', orderId: null, orderNumber: '#BT-0961', amount: 210, currency: 'usd',
      reason: 'general', status: 'lost', evidenceDeadline: null,
      evidenceSubmittedAt: null, createdAt: iso(now - 60 * day),
    },
  ];
}

const CLAIMS: Record<string, string> = {
  product_not_received: 'Customer claims the product was not received.',
  fraudulent: 'Customer reports this as an unauthorized charge.',
  product_unacceptable: 'Customer claims the product was defective or not as described.',
  general: 'Customer filed a general dispute.',
};

/** Detail data for a demo row. Only used with ?bt_preview=seller&demo=1 and no signed-in account. */
export function demoDisputeDetail(id: string, now = Date.now()) {
  const item = demoDisputes(now).find((d) => d.id === id);
  if (!item) return null;
  const files: DisputeEvidenceFile[] =
    id === 'demo-1' ? [] : [{
      id: `${id}-file`, evidenceType: 'receipt', fileName: 'receipt.pdf', contentType: 'application/pdf',
      sizeBytes: 184_320, uploadedAt: item.evidenceSubmittedAt ?? item.createdAt,
    }];
  return {
    item,
    claim: CLAIMS[item.reason ?? ''] ?? 'Customer filed a dispute.',
    files,
    order: {
      orderNumber: item.orderNumber ?? '',
      createdAt: new Date(new Date(item.createdAt).getTime() - 8 * 86_400_000).toISOString(),
      totalCents: Math.round(item.amount * 100),
    },
  };
}
