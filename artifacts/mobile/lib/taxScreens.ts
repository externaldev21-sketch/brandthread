/**
 * Shared bits of the Taxes and duties screens (app/tax-regions.tsx,
 * app/tax-region-add.tsx, app/tax-head-office.tsx).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { isSellerDevPreview } from '@/lib/devPreview';
import type { TaxRegistrationsInfo } from '@/lib/taxRegistrationsView';

const TOAST_MS = 2500;

/** Only with &demo=1 on the signed-out web preview. */
export const DEMO_TAX_REGISTRATIONS: TaxRegistrationsInfo = {
  connected: true,
  providerConfigured: true,
  headOffice: { line1: '1 Market St', line2: null, city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' },
  registrations: [
    { id: 'taxreg_ca', code: 'US-CA', country: 'US', state: 'CA', name: 'California', status: 'active', activeFrom: '2026-01-01T00:00:00.000Z', expiresAt: null },
    { id: 'taxreg_ny', code: 'US-NY', country: 'US', state: 'NY', name: 'New York', status: 'active', activeFrom: '2026-03-01T00:00:00.000Z', expiresAt: null },
    { id: 'taxreg_tx', code: 'US-TX', country: 'US', state: 'TX', name: 'Texas', status: 'scheduled', activeFrom: '2026-11-01T00:00:00.000Z', expiresAt: null },
    { id: 'taxreg_gb', code: 'GB', country: 'GB', state: null, name: 'United Kingdom', status: 'active', activeFrom: '2026-02-01T00:00:00.000Z', expiresAt: null },
  ],
  regions: [
    { code: 'US-CA', country: 'US', state: 'CA', name: 'California' },
    { code: 'US-FL', country: 'US', state: 'FL', name: 'Florida' },
    { code: 'US-IL', country: 'US', state: 'IL', name: 'Illinois' },
    { code: 'US-NY', country: 'US', state: 'NY', name: 'New York' },
    { code: 'US-TX', country: 'US', state: 'TX', name: 'Texas' },
    { code: 'US-WA', country: 'US', state: 'WA', name: 'Washington' },
    { code: 'AU', country: 'AU', state: null, name: 'Australia' },
    { code: 'CA', country: 'CA', state: null, name: 'Canada' },
    { code: 'GB', country: 'GB', state: null, name: 'United Kingdom' },
  ],
};

/** Signed-out web preview: never call the API; fake data only with &demo=1. */
export function useTaxPreview() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const previewMode = isSellerDevPreview();
  return (previewMode && !userId) || (previewMode && (!isLoaded || !isSignedIn));
}

export function useScreenToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { message, show, hide: () => setMessage(null) };
}

