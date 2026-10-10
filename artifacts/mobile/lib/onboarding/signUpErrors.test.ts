import { describe, expect, it } from 'vitest';
import { classifySignUpCreateError, existingAccountCopy, identifierTakenMessage } from './signUpErrors';

const clerk = (code: string, paramName?: string) => ({ errors: [{ code, message: 'x', meta: paramName ? { paramName } : {} }] });

describe('classifySignUpCreateError (Dev P0: new email must never read as "already has an account")', () => {
  it('only a taken email_address that matches the typed email is "email-exists"', () => {
    expect(classifySignUpCreateError(clerk('form_identifier_exists', 'email_address'), 'a@b.com', ' A@B.com ')).toEqual({ kind: 'email-exists' });
  });

  it('a taken username or other identifier is never treated as the email existing', () => {
    expect(classifySignUpCreateError(clerk('form_identifier_exists', 'username'), 'new@b.com', 'new@b.com')).toEqual({ kind: 'other' });
    expect(classifySignUpCreateError(clerk('form_identifier_exists'), 'new@b.com', 'new@b.com')).toEqual({ kind: 'other' });
  });

  it('a stale error for an email the person has since changed is ignored', () => {
    expect(classifySignUpCreateError(clerk('form_identifier_exists', 'email_address'), 'old@b.com', 'new@b.com')).toEqual({ kind: 'other' });
  });

  it('a session already on the device is a stale session, not an existing email', () => {
    expect(classifySignUpCreateError(clerk('session_exists'), 'new@b.com', 'new@b.com')).toEqual({ kind: 'stale-session' });
    expect(classifySignUpCreateError(clerk('identifier_already_signed_in'), 'new@b.com', 'new@b.com')).toEqual({ kind: 'stale-session' });
  });

  it('generic "exists"/"session" wording without the right code does not become email-exists', () => {
    const generic = { errors: [{ code: 'unknown', message: 'Account already exists for this session' }] };
    expect(classifySignUpCreateError(generic, 'new@b.com', 'new@b.com')).toEqual({ kind: 'other' });
    expect(classifySignUpCreateError(new Error('already exists'), 'new@b.com', 'new@b.com')).toEqual({ kind: 'other' });
    expect(classifySignUpCreateError(null, 'new@b.com', 'new@b.com')).toEqual({ kind: 'other' });
  });
});

describe('identifierTakenMessage / existingAccountCopy', () => {
  it('names the field that is actually taken', () => {
    expect(identifierTakenMessage(clerk('form_identifier_exists', 'username'))).toBe('That username is taken. Try another.');
    expect(identifierTakenMessage(clerk('form_code_incorrect'))).toBeNull();
  });

  it("uses Dev's copy for the real case", () => {
    expect(existingAccountCopy('buyer')).toBe('This email already has a buyer account.');
    expect(existingAccountCopy('seller')).toBe('This email already has a seller account.');
    expect(existingAccountCopy(null)).toBe('This email already has an account.');
  });
});
