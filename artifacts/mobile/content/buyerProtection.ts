/**
 * Buyer protection copy — no new wording. The heading reuses the app's
 * existing "Purchase protection · Brandthread protected" label (buyer
 * settings), and the body is quoted verbatim from the Terms of Service in
 * content/legal.ts, the single legal source of truth.
 */
import { LEGAL_DOCUMENTS } from './legal';

export const BUYER_PROTECTION_TITLE = 'Purchase protection';
export const BUYER_PROTECTION_STATUS = 'Brandthread protected';

function termsBullet(sectionTitle: string, match: string): string | null {
  const section = LEGAL_DOCUMENTS.terms.sections.find((candidate) => candidate.title === sectionTitle);
  const bullet = section?.bullets?.find((text) => text.includes(match)) ?? null;
  // Never surface an unresolved [OWNER/COUNSEL: …] drafting placeholder to buyers.
  return bullet && !bullet.includes('[') ? bullet : null;
}

/** The Terms lines the buyer protection note quotes. */
export function buyerProtectionLines({ preorder = false }: { preorder?: boolean } = {}): string[] {
  const lines = [termsBullet('Buying on Brandthread', 'return, exchange, cancellation')];
  if (preorder) lines.push(termsBullet('Preorders and drops', 'held by Brandthread'));
  return lines.filter((line): line is string => !!line);
}
