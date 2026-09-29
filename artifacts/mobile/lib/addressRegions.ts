/** Options for checkout's State and Country pickers. Values are what the server and Stripe take (USPS / ISO 3166-1 codes). */
import type { PickerOption } from '@/components/checkout/CheckoutPrimitives';

export const US_STATES: PickerOption[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([value, label]) => ({ value, label }));

export const COUNTRIES: PickerOption[] = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['IT', 'Italy'], ['ES', 'Spain'],
  ['PT', 'Portugal'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['SG', 'Singapore'], ['HK', 'Hong Kong'], ['AE', 'United Arab Emirates'],
  ['MX', 'Mexico'], ['BR', 'Brazil'],
].map(([value, label]) => ({ value, label }));

/** A US state typed as a name ("New York") or code ("ny") → its code; anything else unchanged. */
export function normalizeUsState(input: string): string {
  const trimmed = input.trim();
  const match = US_STATES.find(state => state.value === trimmed.toUpperCase() || state.label.toLowerCase() === trimmed.toLowerCase());
  return match ? match.value : trimmed;
}
