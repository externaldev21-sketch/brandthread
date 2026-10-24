/**
 * "#BT-1042" for headers like "Return · #BT-1042". Some order numbers already
 * carry the "#" (the dispute demo data does), so a leading "#" is stripped
 * before prefixing one: never "##BT-1042".
 */
export function orderRef(orderNumber: string | null | undefined): string {
  const bare = (orderNumber ?? '').trim().replace(/^#+\s*/, '');
  return bare ? `#${bare}` : '';
}
