import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activityHref } from './activity';
import {
  REFERRAL_GET_CENTS, REFERRAL_GIVE_CENTS, REFERRAL_HEADLINE, REFERRAL_STEPS, REFERRAL_TIMING_SHORT,
  referralInviteePath, referralStatusLabel,
} from './referralCopy';

describe('referral copy', () => {
  it('says give $10 / get $10 and matches the server reward', () => {
    expect(REFERRAL_HEADLINE).toBe('Give $10. Get $10.');
    expect(REFERRAL_GIVE_CENTS).toBe(1000);
    expect(REFERRAL_GET_CENTS).toBe(1000);
    const policy = readFileSync(join(__dirname, '../../api-server/src/lib/referrals/policy.ts'), 'utf8');
    expect(policy).toContain('REFERRAL_INVITEE_REWARD_CENTS = 1000');
    expect(policy).toContain('REFERRAL_INVITER_REWARD_CENTS = 1000');
    expect(policy).toContain('REFERRAL_MIN_ORDER_CENTS = 1000');
  });

  it('uses the same timing on every surface', () => {
    expect(REFERRAL_TIMING_SHORT).toContain('first order of $10 or more');
    expect(REFERRAL_STEPS[1].body).toContain('$10 or more');
    expect(readFileSync(join(__dirname, '../app/loyalty.tsx'), 'utf8')).toContain('first order of $10 or more');
  });

  it('labels every status', () => {
    expect(referralStatusLabel('pending')).toBe('Waiting for first order');
    expect(referralStatusLabel('rewarded')).toBe('You earned $10');
  });

  it('builds a safe onboarding path', () => {
    expect(referralInviteePath('ab-c234')).toBe('/onboarding?referralCode=ABC234');
  });

  it('routes referral notifications', () => {
    const base = { id: '', category: 'social', title: '', body: '', isRead: true, createdAt: '' };
    expect(activityHref({ ...base, type: 'referral_joined', targetType: 'referral', targetId: 'u1' })).toBe('/buyer-invite');
    expect(activityHref({ ...base, type: 'referral_reward', targetType: 'thread_cash_transfer', targetId: 'u1' })).toBe('/thread-cash');
  });
});
