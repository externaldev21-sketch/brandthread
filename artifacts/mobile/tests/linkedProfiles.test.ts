import { describe, expect, it } from 'vitest';
import {
  addProfileLabel, otherRole, parseStartProfileError, previewLinkedProfiles, profilesMissingFromDevice, roleExistsMessage, sessionForProfile,
} from '@/lib/linkedProfiles';
import type { LinkedProfile } from '@/lib/api';

const profile = (over: Partial<LinkedProfile>): LinkedProfile => ({
  clerkId: 'user_x', role: 'buyer', username: 'x', displayName: 'X', avatarUrl: null,
  onboardingComplete: true, isLogin: false, isCurrent: false, pendingDeletion: false, ...over,
});

describe('linked profiles (one login = one buyer + one seller)', () => {
  it('names the add action for the other role', () => {
    expect(otherRole('buyer')).toBe('seller');
    expect(otherRole('seller')).toBe('buyer');
    expect(otherRole(null)).toBe('seller');
    expect(addProfileLabel('seller')).toBe('Start selling');
    expect(addProfileLabel('buyer')).toBe('Shop as a buyer');
  });

  it('uses Dev\'s copy when the role already exists, with the profile to switch to', () => {
    expect(roleExistsMessage('seller')).toBe('This email already has a seller account.');
    expect(roleExistsMessage('buyer')).toBe('This email already has a buyer account.');
    const err = { status: 409, code: 'PROFILE_ROLE_EXISTS', body: JSON.stringify({ code: 'PROFILE_ROLE_EXISTS', profileClerkId: 'user_seller' }) };
    expect(parseStartProfileError(err, 'seller')).toEqual({ kind: 'exists', role: 'seller', profileClerkId: 'user_seller' });
    expect(parseStartProfileError({ status: 409, code: 'FINISH_SETUP' }, 'seller')).toEqual({ kind: 'finish-setup' });
    expect(parseStartProfileError({ status: 502, message: 'boom' }, 'buyer').kind).toBe('error');
  });

  it('lists same-login profiles that are not signed in on this device', () => {
    const profiles = [
      profile({ clerkId: 'user_buyer', isCurrent: true }),
      profile({ clerkId: 'user_seller', role: 'seller' }),
      profile({ clerkId: 'user_gone', role: 'seller', pendingDeletion: true }),
    ];
    expect(profilesMissingFromDevice(profiles, [{ id: 'sess_b', status: 'active', user: { id: 'user_buyer' } }]).map((p) => p.clerkId))
      .toEqual(['user_seller']);
    expect(profilesMissingFromDevice(profiles, [
      { id: 'sess_b', status: 'active', user: { id: 'user_buyer' } },
      { id: 'sess_s', status: 'active', user: { id: 'user_seller' } },
    ])).toEqual([]);
  });

  it('reuses a signed-in session on this device instead of signing in again', () => {
    const sessions = [
      { id: 'sess_old', status: 'ended', user: { id: 'user_seller' } },
      { id: 'sess_live', status: 'active', user: { id: 'user_seller' } },
    ];
    expect(sessionForProfile(sessions, 'user_seller')?.id).toBe('sess_live');
    expect(sessionForProfile(sessions, 'user_none')).toBeNull();
  });

  it('preview: fresh offers the other role, demo=1 shows both profiles', () => {
    const identity = { username: 'preview_studio', brandName: 'Preview Studio' };
    expect(previewLinkedProfiles('buyer', false, identity).canAdd).toEqual({ buyer: false, seller: true });
    const demo = previewLinkedProfiles('buyer', true, identity);
    expect(demo.profiles.map((p) => p.username)).toEqual(['ava', 'preview_studio']);
    expect(demo.canAdd).toEqual({ buyer: false, seller: false });
  });
});
