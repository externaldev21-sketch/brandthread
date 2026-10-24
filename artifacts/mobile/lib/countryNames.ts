/**
 * ISO 3166-1 alpha-2 code → English country name, for analytics rows that the
 * API reports by code ("US", "PT"). `Intl.DisplayNames` isn't reliable on
 * Hermes, so this is a static map of the countries traffic realistically
 * comes from; an unknown code falls back to the code itself.
 */
const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates', AR: 'Argentina', AT: 'Austria', AU: 'Australia', BD: 'Bangladesh',
  BE: 'Belgium', BG: 'Bulgaria', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland', CL: 'Chile',
  CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia', EG: 'Egypt',
  ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom', GH: 'Ghana', GR: 'Greece',
  GT: 'Guatemala', HK: 'Hong Kong', HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland',
  IL: 'Israel', IN: 'India', IS: 'Iceland', IT: 'Italy', JM: 'Jamaica', JO: 'Jordan', JP: 'Japan',
  KE: 'Kenya', KR: 'South Korea', KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LK: 'Sri Lanka',
  LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', MA: 'Morocco', MT: 'Malta', MX: 'Mexico',
  MY: 'Malaysia', NG: 'Nigeria', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NZ: 'New Zealand',
  OM: 'Oman', PA: 'Panama', PE: 'Peru', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland',
  PR: 'Puerto Rico', PT: 'Portugal', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia',
  SA: 'Saudi Arabia', SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', TH: 'Thailand',
  TN: 'Tunisia', TR: 'Türkiye', TT: 'Trinidad and Tobago', TW: 'Taiwan', UA: 'Ukraine', UG: 'Uganda',
  US: 'United States', UY: 'Uruguay', VE: 'Venezuela', VN: 'Vietnam', ZA: 'South Africa',
};

/** "US" → "United States"; unknown or non-code input is returned trimmed as-is. */
export function countryName(code: string | null | undefined): string {
  const raw = (code ?? '').trim();
  if (!raw) return 'Unknown';
  return COUNTRY_NAMES[raw.toUpperCase()] ?? raw;
}
