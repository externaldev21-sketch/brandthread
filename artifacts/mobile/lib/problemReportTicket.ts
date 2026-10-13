import type { AppDiagnostics } from '@/lib/appDiagnostics';
import { PROBLEM_TYPE_OPTIONS, type BuyerProblemType } from '@/services/cartTypes';

/**
 * Turns a "Report a problem" submission into a support ticket
 * (POST /api/support/tickets) so it actually reaches the team, with the
 * app/device details attached automatically.
 */
export function buildProblemReportTicket(input: {
  type: BuyerProblemType;
  description: string;
  contactedSeller: boolean;
  orderId?: string;
  orderNumber?: string;
  email: string;
  name: string;
  diagnostics: AppDiagnostics;
}) {
  const label = PROBLEM_TYPE_OPTIONS.find((o) => o.key === input.type)?.label ?? 'Problem';
  const lines = [input.description.trim()];
  if (input.orderNumber || input.orderId) {
    lines.push('', `Order: ${input.orderNumber ?? input.orderId}`);
    lines.push(`Contacted seller: ${input.contactedSeller ? 'Yes' : 'No'}`);
  }
  return {
    subject: input.orderNumber ? `${label} · Order ${input.orderNumber}` : label,
    body: lines.join('\n'),
    // Order problems go to the general queue; app problems are bugs.
    category: input.orderId ? 'general' : 'bug',
    email: input.email,
    name: input.name,
    diagnostics: { ...input.diagnostics, ...(input.orderId ? { orderId: input.orderId } : {}) },
  };
}
