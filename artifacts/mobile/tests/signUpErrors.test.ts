import { describe, expect, it } from 'vitest';
import {
  classifySignUpError,
  existingAccountHeadline,
  findSessionForEmail,
} from '@/lib/signUpErrors';

const exists = (paramName?: string) => ({
  errors: [{ code: 'form_identifier_exists', message: 'That identifier is taken.', ...(paramName ? { meta: { paramName } } : {}) }],
});

describe('classifySignUpError', () => {
  it('only an email collision is "email exists"', () => {
    expect(classifySignUpError(exists('email_address'), 'x')).toEqual({ kind: 'email-exists' });
  });

  it('a taken username is a username field error, never the account-exists screen', () => {
    expect(classifySignUpError(exists('username'), 'x')).toEqual({ kind: 'username-taken', message: 'That username is taken.' });
  });

  it('an unnamed duplicate never guesses that the email exists', () => {
    expect(classifySignUpError(exists(), 'x').kind).toBe('field');
    expect(classifySignUpError(exists('phone_number'), 'x').kind).toBe('field');
  });

  it('a session already on the device is its own outcome, not "account exists"', () => {
    expect(classifySignUpError({ errors: [{ code: 'session_exists' }] }, 'x')).toEqual({ kind: 'signed-in-elsewhere' });
    expect(classifySignUpError({ code: 'identifier_already_signed_in' }, 'x')).toEqual({ kind: 'signed-in-elsewhere' });
  });

  it('anything else keeps the mapped message', () => {
    expect(classifySignUpError({ errors: [{ code: 'form_password_pwned' }] }, 'Pick a stronger password.'))
      .toEqual({ kind: 'field', message: 'Pick a stronger password.' });
  });

  it('reads snake_case meta too', () => {
    expect(classifySignUpError({ errors: [{ code: 'form_identifier_exists', meta: { param_name: 'email_address' } }] }, 'x'))
      .toEqual({ kind: 'email-exists' });
  });
});

describe('findSessionForEmail', () => {
  const sessions = [
    { id: 'sess_a', status: 'active', user: { id: 'user_a', emailAddresses: [{ emailAddress: 'a@x.com' }] } },
    { id: 'sess_b', status: 'ended', user: { id: 'user_b', emailAddresses: [{ emailAddress: 'b@x.com' }] } },
  ];

  it('finds an active session by email, case-insensitively', () => {
    expect(findSessionForEmail(sessions, ' A@X.com ')?.id).toBe('sess_a');
  });

  it('ignores ended sessions and unknown emails', () => {
    expect(findSessionForEmail(sessions, 'b@x.com')).toBeNull();
    expect(findSessionForEmail(sessions, 'new@x.com')).toBeNull();
    expect(findSessionForEmail(null, 'a@x.com')).toBeNull();
  });
});

describe('existingAccountHeadline', () => {
  it('names the role when known', () => {
    expect(existingAccountHeadline('buyer')).toBe('This email already has a buyer account.');
    expect(existingAccountHeadline('seller')).toBe('This email already has a seller account.');
    expect(existingAccountHeadline(null)).toBe('This email already has an account.');
  });
});
