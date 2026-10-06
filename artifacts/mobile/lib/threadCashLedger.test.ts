import { describe, expect, it } from 'vitest';
import { demoLedger, groupLedgerByMonth, ledgerLabel, LEDGER_FILTERS } from './threadCashLedger';

describe('threadCashLedger', () => {
  it('labels known sources and falls back to Adjustment', () => {
    expect(ledgerLabel('expiry')).toBe('Expired');
    expect(ledgerLabel('mystery')).toBe('Adjustment');
  });

  it('groups newest-first rows by calendar month', () => {
    const rows = demoLedger(null).rows;
    const groups = groupLedgerByMonth(rows);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(rows.length);
    expect(new Set(groups.map((g) => g.title)).size).toBe(groups.length);
  });

  it('demo filter narrows by kind and offers all/earned/spent/expired', () => {
    expect(LEDGER_FILTERS.map((f) => f.label)).toEqual(['All', 'Earned', 'Spent', 'Expired']);
    expect(demoLedger('expired').rows.every((r) => r.kind === 'expired')).toBe(true);
  });
});
