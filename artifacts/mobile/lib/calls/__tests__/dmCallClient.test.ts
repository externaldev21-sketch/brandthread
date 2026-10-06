import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.test' }));
import {
  endReasonForStatus, endedSubtitle, logEntryFromDto, sessionPatchFromDto, startFailureMessage, type DmCallDto,
} from '../dmCallClient';
import { callSocketUrl, parseCallEvent } from '../callEvents';

const dto = (patch: Partial<DmCallDto> = {}): DmCallDto => ({
  id: 'call-1', conversationId: 'conv-1', mode: 'video', status: 'ringing', direction: 'outgoing',
  callerId: 'me', calleeId: 'them', peer: { id: 'them', name: 'Ava Stone', initials: 'AS', color: '#222', avatarUrl: null },
  createdAt: '2026-10-06T10:00:00.000Z', answeredAt: null, endedAt: null, durationSec: null, endReason: null, ...patch,
});

describe('sessionPatchFromDto', () => {
  it('ringing reads outgoing for the caller and incoming for the callee', () => {
    expect(sessionPatchFromDto(dto())).toEqual({ status: 'outgoing' });
    expect(sessionPatchFromDto(dto({ direction: 'incoming' }))).toEqual({ status: 'incoming' });
  });

  it('accepted is connected on both sides, timed from the server answer', () => {
    expect(sessionPatchFromDto(dto({ status: 'accepted', answeredAt: '2026-10-06T10:00:05.000Z' })))
      .toEqual({ status: 'connected', connectedAt: Date.parse('2026-10-06T10:00:05.000Z') });
  });

  it('terminal statuses end the call with the matching reason', () => {
    expect(sessionPatchFromDto(dto({ status: 'declined', endedAt: '2026-10-06T10:00:03.000Z' })))
      .toMatchObject({ status: 'ended', endReason: 'declined' });
    expect(endReasonForStatus('missed')).toBe('missed');
    expect(endReasonForStatus('cancelled')).toBe('cancelled');
    expect(endReasonForStatus('ended')).toBe('hangup');
    expect(endReasonForStatus('failed')).toBe('failed');
  });
});

describe('logEntryFromDto', () => {
  it('skips calls still in progress', () => {
    expect(logEntryFromDto(dto())).toBeNull();
  });

  it('marks a missed / caller-cancelled call as missed only for the callee', () => {
    expect(logEntryFromDto(dto({ status: 'missed', direction: 'incoming' }))?.missed).toBe(true);
    expect(logEntryFromDto(dto({ status: 'cancelled', direction: 'incoming' }))?.missed).toBe(true);
    expect(logEntryFromDto(dto({ status: 'missed', direction: 'outgoing' }))?.missed).toBe(false);
  });

  it('carries the server duration of a connected call', () => {
    expect(logEntryFromDto(dto({ status: 'ended', answeredAt: '2026-10-06T10:00:05.000Z', durationSec: 42 })))
      .toMatchObject({ durationSec: 42, reason: 'hangup', startedAt: Date.parse('2026-10-06T10:00:05.000Z') });
  });
});

describe('copy', () => {
  it('explains why a call could not be placed', () => {
    expect(startFailureMessage('CALLEE_BUSY')).toBe('They’re on another call.');
    expect(startFailureMessage('CALLING_NOT_CONFIGURED')).toMatch(/isn’t available/);
    expect(startFailureMessage(undefined)).toMatch(/couldn’t be placed/);
  });

  it('says what happened on the ended screen', () => {
    expect(endedSubtitle({ direction: 'outgoing', endReason: 'missed' })).toBe('No answer');
    expect(endedSubtitle({ direction: 'outgoing', endReason: 'declined' })).toBe('Declined');
    expect(endedSubtitle({ direction: 'incoming', endReason: 'cancelled' })).toBe('Missed call');
    expect(endedSubtitle({ direction: 'outgoing', endReason: 'hangup', connectedAt: 1 })).toBe('Call ended');
    expect(endedSubtitle({ direction: 'outgoing', endReason: 'failed', failureMessage: 'Sign in to call.' })).toBe('Sign in to call.');
  });
});

describe('call events socket', () => {
  it('parses call events and rejects anything else', () => {
    expect(parseCallEvent(JSON.stringify({ type: 'call.incoming', call: dto() }))?.type).toBe('call.incoming');
    expect(parseCallEvent({ type: 'call.updated', call: dto({ status: 'accepted' }) })?.call.status).toBe('accepted');
    expect(parseCallEvent('{"type":"other"}')).toBeNull();
    expect(parseCallEvent('not json')).toBeNull();
    expect(parseCallEvent({ type: 'call.updated', call: { id: 1 } })).toBeNull();
  });

  it('builds the authenticated socket URL from the API base', () => {
    expect(callSocketUrl('tok en', 'https://api.example.com')).toBe('wss://api.example.com/ws/calls?token=tok%20en');
  });
});
