/**
 * How the delete-account screen lets someone prove it's them (QA-0074).
 * Password accounts type their password. Accounts without one (Sign in with
 * Apple / Google) are never stuck on an emailed code: Apple users can re-run
 * Sign in with Apple on iPhone, and anyone can sign in again (a sign-in from
 * the last 10 minutes counts). The emailed code stays as one more option
 * when the server can send mail.
 */
export type DeletionReauthOptions = { apple: boolean; recentSignIn: boolean; emailCode: boolean };

export type DeletionReauthPlan = {
  mode: 'password' | 'sso';
  /** Already proven by a fresh sign-in: nothing more to do. */
  alreadyConfirmed: boolean;
  showApple: boolean;
  showSignInAgain: boolean;
  showEmailCode: boolean;
};

export function deletionReauthPlan(input: {
  reauth: 'password' | 'email_code' | undefined;
  reauthOptions: DeletionReauthOptions | null | undefined;
  os: string;
}): DeletionReauthPlan {
  if (input.reauth !== 'email_code') {
    return { mode: 'password', alreadyConfirmed: false, showApple: false, showSignInAgain: false, showEmailCode: false };
  }
  // An older server without reauthOptions only knows the emailed code.
  const opts = input.reauthOptions ?? { apple: false, recentSignIn: false, emailCode: true };
  if (opts.recentSignIn) {
    return { mode: 'sso', alreadyConfirmed: true, showApple: false, showSignInAgain: false, showEmailCode: false };
  }
  return {
    mode: 'sso',
    alreadyConfirmed: false,
    showApple: opts.apple && input.os === 'ios',
    showSignInAgain: !!input.reauthOptions,
    showEmailCode: opts.emailCode,
  };
}

export function deletionReauthSatisfied(
  plan: DeletionReauthPlan,
  proof: { password: string; code: string; appleIdentityToken: string | null },
): boolean {
  if (plan.mode === 'password') return proof.password.length > 0;
  return plan.alreadyConfirmed || !!proof.appleIdentityToken || /^\d{6}$/.test(proof.code.trim());
}

/** Where "Sign in again" sends the person, so they land back on this screen. */
export const DELETE_ACCOUNT_REAUTH_ROUTE = '/sign-in?returnTo=%2Fdelete-account';
