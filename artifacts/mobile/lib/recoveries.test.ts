import { describe, expect, it } from 'vitest';
import { applicationLabel, pausedRowCaption, recoveryStatusLabel, signedBalance } from './recoveries';

describe('recoveries view model', () => {
  it('shows a negative balance with a real minus sign', () => {
    expect(signedBalance(-4210)).toBe('−$42.10');
    expect(signedBalance(1200)).toBe('$12.00');
  });
  it('labels statuses and applications in plain words', () => {
    expect(recoveryStatusLabel('open')).toBe('Recovering');
    expect(recoveryStatusLabel('reinstated')).toBe('Reversed');
    expect(applicationLabel({ source: 'release_netting', orderNumber: '1042' })).toBe('Kept from order #1042 payout');
    expect(applicationLabel({ source: 'transfer_reversal', orderNumber: null })).toBe('Pulled back from the order payout');
  });
  it('captions the paused row with the amount owed', () => {
    expect(pausedRowCaption(4210)).toBe('$42.10 chargeback being recovered from upcoming payouts');
  });
});
