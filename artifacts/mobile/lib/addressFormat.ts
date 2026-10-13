/**
 * How an address reads on the Order review's "Ship to" row (Shop): the name
 * on top, then the whole address on one line,
 *   Jordan Reyes
 *   141 Prince St, New York, NY 10012
 * Nothing is split or dropped: the street line is shown exactly as entered
 * (with the apartment), then city, state and ZIP.
 */
import type { CheckoutAddress } from '@/services/cartTypes';

type Addressish = Partial<Pick<CheckoutAddress, 'firstName' | 'lastName' | 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'country'>>;

const clean = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();

/** "Jordan Reyes", or '' when no name was entered. */
export function addressName(address: Addressish): string {
  return [clean(address.firstName), clean(address.lastName)].filter(Boolean).join(' ');
}

/**
 * "141 Prince St, Apt 4, New York, NY 10012" — or null while the street or
 * city is missing. The country is added only outside the US.
 */
export function addressOneLine(address: Addressish): string | null {
  const line1 = clean(address.line1);
  const city = clean(address.city);
  if (!line1 || !city) return null;
  const stateZip = [clean(address.state), clean(address.postalCode)].filter(Boolean).join(' ');
  const country = clean(address.country).toUpperCase();
  return [line1, clean(address.line2), city, stateZip, country && country !== 'US' ? country : '']
    .filter(Boolean)
    .join(', ');
}
