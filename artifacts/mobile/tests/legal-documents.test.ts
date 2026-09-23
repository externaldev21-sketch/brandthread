import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import {
  IS_DRAFT, LEGAL_DOCUMENTS, LEGAL_DOCUMENT_ORDER, LEGAL_OPEN_ITEMS, LEGAL_VERSION,
} from '../content/legal';
import { hasAcceptedCurrentTerms } from '../lib/legalConsent';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const text = (id: keyof typeof LEGAL_DOCUMENTS) =>
  LEGAL_DOCUMENTS[id].sections.flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.bullets ?? [])]).join('\n');

describe('legal documents (single source)', () => {
  it('defines Terms, Community Guidelines and Privacy Policy with routes', () => {
    expect(LEGAL_DOCUMENT_ORDER).toEqual(['terms', 'guidelines', 'privacy']);
    expect(LEGAL_DOCUMENTS.terms.route).toBe('/terms');
    expect(LEGAL_DOCUMENTS.privacy.route).toBe('/privacy');
    expect(LEGAL_DOCUMENTS.guidelines.route).toBe('/community-guidelines');
    for (const id of LEGAL_DOCUMENT_ORDER) {
      expect(LEGAL_DOCUMENTS[id].sections.length).toBeGreaterThan(5);
    }
  });

  it('is clearly marked as a draft pending legal review', () => {
    expect(IS_DRAFT).toBe(true);
    expect(LEGAL_OPEN_ITEMS.length).toBeGreaterThan(0);
    for (const id of LEGAL_DOCUMENT_ORDER) {
      expect(LEGAL_DOCUMENTS[id].reviewNotice).toMatch(/pending review/i);
    }
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });

  it('covers the marketplace specifics in the Terms', () => {
    const terms = text('terms');
    expect(terms).toMatch(/5% of each marketplace order’s subtotal/);
    expect(terms).toMatch(/released to the seller one order at a time, when the seller adds shipment tracking/);
    expect(terms).toMatch(/If a drop is cancelled, fails to reach production.*full refund/);
    expect(terms).toMatch(/Manufacturers and freelancers/);
    expect(terms).toMatch(/zero tolerance for objectionable content/);
    expect(terms).toMatch(/Settings → Delete account/);
  });

  it('describes moderation and in-app deletion in the Privacy Policy', () => {
    const privacy = text('privacy');
    expect(privacy).toMatch(/Settings → Delete account/);
    expect(privacy).toMatch(/held and shown only to you until a moderator reviews it/);
    expect(privacy).toMatch(/Face ID, Touch ID or fingerprint/);
  });

  it('explains reporting, blocking, muted words and enforcement in the Guidelines', () => {
    const guidelines = text('guidelines');
    for (const phrase of ['Report anything', 'Block anyone', 'Mute words', 'within 24 hours', 'Suspension', 'Permanent ban', 'Appeals']) {
      expect(guidelines).toContain(phrase);
    }
  });

  it('renders every screen from the single source', () => {
    expect(read('app/terms.tsx')).toContain('<LegalDocument docId="terms" />');
    expect(read('app/privacy.tsx')).toContain('<LegalDocument docId="privacy" />');
    expect(read('app/community-guidelines.tsx')).toContain('<LegalDocument docId="guidelines" />');
  });
});

describe('agreement at sign-up', () => {
  it('requires the checkbox before email, Google or Apple sign-up', () => {
    const onboarding = read('app/onboarding.tsx');
    expect((onboarding.match(/<LegalConsent /g) ?? []).length).toBe(3);
    expect((onboarding.match(/if \(!requireConsent\(\)\) return;/g) ?? []).length).toBe(4);
    expect(onboarding).not.toContain('By continuing you agree');
  });

  it('records agreement for every signed-in account', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('<LegalAcceptanceGate />');
    expect(read('components/legal/LegalAcceptanceGate.tsx')).toContain('api.auth.acceptLegal(');
  });

  it('treats only the current (or newer) version as accepted', () => {
    expect(hasAcceptedCurrentTerms(LEGAL_VERSION, LEGAL_VERSION)).toBe(true);
    expect(hasAcceptedCurrentTerms('2026-01-01', '2026-09-23')).toBe(false);
    expect(hasAcceptedCurrentTerms('2026-09-23.2', '2026-09-23')).toBe(true);
    expect(hasAcceptedCurrentTerms(null, LEGAL_VERSION)).toBe(false);
  });
});
