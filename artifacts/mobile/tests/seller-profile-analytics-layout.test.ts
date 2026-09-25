import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const profileSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/profile.tsx'),
  'utf8',
);
const analyticsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/analytics.tsx'),
  'utf8',
);

describe('seller profile action layout', () => {
  it('keeps only My Profile and Messages in the quick-action row', () => {
    expect(profileSource).toContain("label: 'My Profile',    route: '/edit-profile'");
    expect(profileSource).toContain("label: 'Messages'");
    expect(profileSource).not.toContain("label: 'Brand Assets'");
    expect(profileSource).not.toContain("label: 'Add Product'");
    expect(profileSource).not.toContain("label: 'New Campaign'");
  });

  it('keeps only Post, Draft, and Schedule content buttons', () => {
    expect(profileSource).toContain("const CONTENT_TABS = ['Post', 'Draft', 'Schedule']");
    expect(profileSource).not.toContain('Store performance');
  });

  it('keeps post creation in the top action and out of the content grid', () => {
    expect(profileSource).toContain('accessibilityLabel="Create Post"');
    expect(profileSource).not.toContain('accessibilityLabel="Create post"');
    expect(profileSource).not.toContain('Share something with');
    expect(profileSource).toContain("'No posts yet. Create your first post!'");
  });
});

describe('seller analytics overview layout', () => {
  // The "14 Days"/"Custom" ranges and the "Leads"/"Traffic sources" cards
  // were non-functional stubs (always empty, no backing API) and were
  // removed as a P0 fix — see docs/polish/punch-list.md, Seller Analytics.
  // Only the working 7-day range ships now.
  it('renders only the working 7-day range, real metrics, and the chart', () => {
    expect(analyticsSource).not.toContain("label: '14 Days'");
    expect(analyticsSource).not.toContain("label: 'Custom'");
    expect(analyticsSource).not.toContain('label="Leads"');
    expect(analyticsSource).toContain('Last 7 days');
    expect(analyticsSource).toContain('label="Visits"');
    expect(analyticsSource).toContain('label="Revenue"');
    expect(analyticsSource).toContain('Daily Revenue');
  });

  it('uses zero-safe data and omits fabricated trends and traffic sources', () => {
    expect(analyticsSource).toContain('Number.isFinite(changePct)');
    expect(analyticsSource).not.toContain('TikTok');
    expect(analyticsSource).not.toContain('-65%');
  });
});