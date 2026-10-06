import { describe, expect, it } from 'vitest';
import { firstParam, initialsFromName, resolveConversationParticipant } from '@/lib/conversationParticipant';
import { AVATAR_NEUTRAL_PALETTE } from '@/lib/avatarColors';

describe('resolveConversationParticipant', () => {
  it('returns null when neither params nor conversation name anyone', () => {
    expect(resolveConversationParticipant({})).toBeNull();
    expect(resolveConversationParticipant({ participantName: '  ' }, { userId: 'u1' })).toBeNull();
  });

  it('prefers URL params and derives initials + a neutral color when missing', () => {
    const p = resolveConversationParticipant({ participantName: 'Rae Kim', participantUserId: 'u-rae' })!;
    expect(p.name).toBe('Rae Kim');
    expect(p.initials).toBe('RK');
    expect(AVATAR_NEUTRAL_PALETTE).toContain(p.color as (typeof AVATAR_NEUTRAL_PALETTE)[number]);
    expect(p.avatarUri).toBeNull();
  });

  it('fills gaps from the loaded conversation participant', () => {
    const p = resolveConversationParticipant(
      { participantName: '' },
      { userId: 'u2', name: 'Orison', handle: '@orison', initials: 'OR', color: '#333338', avatarUri: 'https://x/y.png', nickname: 'O' },
    )!;
    expect(p).toEqual({
      userId: 'u2', name: 'Orison', handle: '@orison', initials: 'OR', color: '#333338',
      avatarUri: 'https://x/y.png', nickname: 'O',
    });
  });
});

describe('initialsFromName / firstParam', () => {
  it('takes up to two initials', () => {
    expect(initialsFromName('maison vela studio')).toBe('MV');
    expect(initialsFromName('orison')).toBe('O');
    expect(initialsFromName('   ')).toBe('?');
  });
  it('normalizes route params', () => {
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam('')).toBeNull();
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam(' c1 ')).toBe('c1');
  });
});
