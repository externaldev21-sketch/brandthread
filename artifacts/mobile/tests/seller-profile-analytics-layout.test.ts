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
    expect(profileSource).toContain("label: 'My Profile'");
    expect(profileSource).toContain("label: 'Messages'");
    expect(profileSource).not.toContain("label: 'Brand Assets'");
    expect(profileSource).not.toContain("label: 'Add Product'");
    expect(profileSource).not.toContain("label: 'New Campaign'");
  });

  it('keeps only Post, Draft, and Schedule content buttons', () => {
    expect(profileSource).toContain("const CONTENT_TABS = ['Post', 'Draft', 'Schedule']");
    expect(profileSource).not.toContain('Store performance');
  });
});

describe('seller analytics overview layout', () => {
  it('renders the requested ranges, dates, metrics, chart, and source card', () => {
    expect(analyticsSource).toContain("label: '7 Days'");
    expect(analyticsSource).toContain("label: '14 Days'");
    expect(analyticsSource).toContain("label: 'Custom'");
    expect(analyticsSource).toContain('label=\"Start\"');
    expect(analyticsSource).toContain('label=\"End\"');
    expect(analyticsSource).toContain('label=\"Visits\"');
    expect(analyticsSource).toContain('label=\"Revenue\"');
    expect(analyticsSource).toContain('label=\"Leads\"');
    expect(analyticsSource).toContain('Daily Revenue');
    expect(analyticsSource).toContain('Where are my customers from?');
  });

  it('uses zero-safe data and omits fabricated trends and traffic sources', () => {
    expect(analyticsSource).toContain('leads: 0');
    expect(analyticsSource).toContain('setSources([])');
    expect(analyticsSource).toContain('Number.isFinite(changePct)');
    expect(analyticsSource).toContain('No data yet');
    expect(analyticsSource).not.toContain('TikTok');
    expect(analyticsSource).not.toContain('-65%');
  });
});