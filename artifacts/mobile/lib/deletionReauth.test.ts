import { describe, expect, it } from 'vitest';
import { deletionReauthPlan, deletionReauthSatisfied } from './deletionReauth';

const none = { password: '', code: '', appleIdentityToken: null };

describe('delete-account re-authentication (QA-0074)', () => {
  it('keeps the password for password accounts', () => {
    const plan = deletionReauthPlan({ reauth: 'password', reauthOptions: null, os: 'ios' });
    expect(plan.mode).toBe('password');
    expect(deletionReauthSatisfied(plan, none)).toBe(false);
    expect(deletionReauthSatisfied(plan, { ...none, password: 'x' })).toBe(true);
  });

  it('never leaves an Apple user stuck on email when mail is down', () => {
    const plan = deletionReauthPlan({ reauth: 'email_code', reauthOptions: { apple: true, recentSignIn: false, emailCode: false }, os: 'ios' });
    expect(plan).toMatchObject({ showApple: true, showSignInAgain: true, showEmailCode: false });
    expect(deletionReauthSatisfied(plan, { ...none, appleIdentityToken: 'tok' })).toBe(true);
  });

  it('offers sign-in-again to Google users and on Android', () => {
    const plan = deletionReauthPlan({ reauth: 'email_code', reauthOptions: { apple: true, recentSignIn: false, emailCode: true }, os: 'android' });
    expect(plan).toMatchObject({ showApple: false, showSignInAgain: true, showEmailCode: true });
    expect(deletionReauthSatisfied(plan, { ...none, code: '123456' })).toBe(true);
    expect(deletionReauthSatisfied(plan, none)).toBe(false);
  });

  it('needs nothing more right after signing in again', () => {
    const plan = deletionReauthPlan({ reauth: 'email_code', reauthOptions: { apple: false, recentSignIn: true, emailCode: false }, os: 'ios' });
    expect(plan.alreadyConfirmed).toBe(true);
    expect(deletionReauthSatisfied(plan, none)).toBe(true);
  });

  it('falls back to the emailed code against an older server', () => {
    const plan = deletionReauthPlan({ reauth: 'email_code', reauthOptions: undefined, os: 'ios' });
    expect(plan).toMatchObject({ showApple: false, showSignInAgain: false, showEmailCode: true });
  });
});
