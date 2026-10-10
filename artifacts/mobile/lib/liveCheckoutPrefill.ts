/**
 * Live checkout: fill the delivery fields from the buyer's saved default
 * address (Settings → Shipping addresses) so nobody types an address while
 * the stream runs. Only empty fields are filled — anything the buyer typed
 * stays.
 */
export type SavedAddress = {
  recipientName?: string | null;
  street?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  isDefault?: boolean | null;
};

export type DeliveryFields = { name: string; phone: string; street: string; city: string; region: string; postalCode: string };

export function pickDefaultAddress(list: readonly SavedAddress[] | null | undefined): SavedAddress | null {
  if (!list || list.length === 0) return null;
  return list.find((a) => a.isDefault) ?? list[0];
}

export function prefillDelivery(current: DeliveryFields, saved: SavedAddress | null): DeliveryFields {
  if (!saved) return current;
  const street = [saved.street, saved.line2].filter((v) => v && v.trim()).join(', ');
  return {
    name: current.name || saved.recipientName || '',
    phone: current.phone || saved.phone || '',
    street: current.street || street,
    city: current.city || saved.city || '',
    region: current.region || saved.state || '',
    postalCode: current.postalCode || saved.postalCode || '',
  };
}
