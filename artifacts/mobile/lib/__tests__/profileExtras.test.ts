import { describe, expect, it } from 'vitest';
import {
  personalDetailsPatch,
  profileQrUrl,
  profileSaveErrorMessage,
  publicStyleBadgeLabel,
  styleBadgeForServer,
  styleBadgeFromServer,
} from '../profileExtras';

const saved = { name: 'Ava Reyes', username: 'ava', pronouns: 'she/her' };

describe('personalDetailsPatch', () => {
  it('sends nothing when nothing changed (no username cooldown hit)', () => {
    expect(personalDetailsPatch({ ...saved, username: '@AVA ' }, saved)).toEqual({});
  });

  it('sends only changed fields, normalized; name also sets displayName', () => {
    expect(personalDetailsPatch({ name: ' Ava  R ', username: 'Ava_2', pronouns: '' }, saved)).toEqual({
      name: 'Ava R', displayName: 'Ava R', username: 'ava_2', pronouns: '',
    });
  });

  it('never sends a blank name or username', () => {
    expect(personalDetailsPatch({ name: ' ', username: '', pronouns: 'she/her' }, saved)).toEqual({});
  });
});

describe('profileQrUrl', () => {
  it('builds the canonical link only for a valid saved handle', () => {
    expect(profileQrUrl('Ava_2')).toBe('https://brandthread.app/u/ava_2');
    expect(profileQrUrl(null)).toBeNull();
    expect(profileQrUrl('ab')).toBeNull();
    expect(profileQrUrl('bad handle!')).toBeNull();
  });
});

describe('profileSaveErrorMessage', () => {
  it('maps taken and cooldown to the username field', () => {
    expect(profileSaveErrorMessage({ status: 409, code: 'USERNAME_TAKEN', body: '{}' }))
      .toEqual({ field: 'username', message: 'That username is already taken.' });
    const cooldown = profileSaveErrorMessage(
      { status: 429, code: 'USERNAME_COOLDOWN', body: JSON.stringify({ code: 'USERNAME_COOLDOWN', nextChangeAt: '2026-11-01T00:00:00.000Z' }) },
      new Date('2026-10-17T00:00:00.000Z'),
    );
    expect(cooldown.field).toBe('username');
    expect(cooldown.message).toMatch(/You can change your username again on .* \(15 days\)\./);
  });

  it('treats an error without a status as a network failure', () => {
    expect(profileSaveErrorMessage(new TypeError('Network request failed')).message).toMatch(/connection/);
  });

  it('surfaces a 400 validation message', () => {
    expect(profileSaveErrorMessage({ status: 400, body: JSON.stringify({ error: 'Username cannot contain spaces.' }) }))
      .toEqual({ field: 'username', message: 'Username cannot contain spaces.' });
  });
});

describe('style badge', () => {
  it('reads a server badge and rejects malformed ones', () => {
    expect(styleBadgeFromServer({ label: 'Y2K', emoji: '✨', enabled: false })).toEqual({ label: 'Y2K', emoji: '✨', enabled: false });
    expect(styleBadgeFromServer(null)).toBeNull();
    expect(styleBadgeFromServer({ label: '', emoji: '✨', enabled: true })).toBeNull();
  });

  it('clamps to server limits on save', () => {
    expect(styleBadgeForServer({ label: ` ${'x'.repeat(30)} `, emoji: ' ✨ ', enabled: true }))
      .toEqual({ label: 'x'.repeat(24), emoji: '✨', enabled: true });
  });

  it('formats the public pill', () => {
    expect(publicStyleBadgeLabel({ label: 'Y2K', emoji: '✨' })).toBe('✨ Y2K');
    expect(publicStyleBadgeLabel({ label: 'Y2K', emoji: '' })).toBe('Y2K');
    expect(publicStyleBadgeLabel(null)).toBeNull();
  });
});
