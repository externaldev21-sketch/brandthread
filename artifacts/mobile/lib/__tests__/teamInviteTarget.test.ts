import { describe, expect, it } from 'vitest';
import { parseTeamInviteTarget } from '@/lib/teamInviteTarget';

describe('parseTeamInviteTarget', () => {
  it('treats a leading @ as a username, dots included', () => {
    expect(parseTeamInviteTarget('@jane.doe')).toEqual({ ok: true, payload: { username: 'jane.doe' } });
    expect(parseTeamInviteTarget('jane_doe')).toEqual({ ok: true, payload: { username: 'jane_doe' } });
  });
  it('accepts real emails only', () => {
    expect(parseTeamInviteTarget(' jane@studio.co ')).toEqual({ ok: true, payload: { email: 'jane@studio.co' } });
    expect(parseTeamInviteTarget('jane@studio').ok).toBe(false);
    expect(parseTeamInviteTarget('not an email').ok).toBe(false);
  });
});
