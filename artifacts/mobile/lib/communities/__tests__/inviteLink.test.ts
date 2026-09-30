import { describe, expect, it } from 'vitest';
import { inviteUrlForCode, parseInviteCode } from '../inviteLink';
import { validateGroupDescription, validateGroupName } from '../validation';
import { describeCommunityError } from '../errors';

describe('parseInviteCode', () => {
  it('parses a bare code', () => {
    expect(parseInviteCode('  Abc123xy ')).toBe('abc123xy');
  });
  it('parses web and deep links', () => {
    expect(parseInviteCode('https://brandthread.app/community-join?code=abc123xy')).toBe('abc123xy');
    expect(parseInviteCode('https://brandthread.app/community-join?g=1&code=ABC123XY#x')).toBe('abc123xy');
    expect(parseInviteCode('mobile://community-join?code=zz99zz99')).toBe('zz99zz99');
  });
  it('falls back to a trailing path segment', () => {
    expect(parseInviteCode('https://brandthread.app/join/abc123xy')).toBe('abc123xy');
  });
  it('rejects junk', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('hi')).toBeNull();
    expect(parseInviteCode('not a code!')).toBeNull();
    expect(parseInviteCode('https://example.com/')).toBeNull();
  });
  it('builds a url', () => {
    expect(inviteUrlForCode('abc123xy')).toBe('https://brandthread.app/community-join?code=abc123xy');
  });
});

describe('validation', () => {
  it('checks names', () => {
    expect(validateGroupName('ab')).toMatch(/at least 3/);
    expect(validateGroupName('  abc ')).toBeNull();
    expect(validateGroupName('x'.repeat(41))).toMatch(/up to 40/);
  });
  it('checks descriptions', () => {
    expect(validateGroupDescription('')).toBeNull();
    expect(validateGroupDescription('x'.repeat(161))).toMatch(/160/);
  });
});

describe('describeCommunityError', () => {
  it('strips the API prefix', () => {
    const e = Object.assign(new Error("API 422: That name is reserved. Pick another."), { status: 422, code: 'NAME_RESERVED' });
    expect(describeCommunityError(e).message).toBe('That name is reserved. Pick another.');
  });
  it('flags auth-required', () => {
    const e = new Error('x'); e.name = 'CommunityAuthRequiredError';
    expect(describeCommunityError(e).authRequired).toBe(true);
  });
  it('handles banned and rate limit', () => {
    expect(describeCommunityError(Object.assign(new Error('API 403: x'), { status: 403, code: 'BANNED' })).message).toMatch(/can't join/);
    expect(describeCommunityError(Object.assign(new Error('API 429: Too many'), { status: 429 })).message).toMatch(/Slow down/);
  });
  it('falls back for raw json', () => {
    expect(describeCommunityError(new Error('{"a":1}'), 'Nope').message).toBe('Nope');
  });
});
