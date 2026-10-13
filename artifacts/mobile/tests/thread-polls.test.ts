import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));

import {
  cleanPollDraft, emptyPollDraft, formatPollLength, formatTimeLeft, formatVotes, joinMinutes, splitMinutes,
} from '@/lib/postPolls';
import { attachThreadPoll } from '@/lib/createPost/attachPoll';
import { __resetPollStore, getPolls, savePostPoll, voteInPoll } from '@/services/postPollService';

describe('poll draft rules', () => {
  it('starts with two empty choices and a 1 day length', () => {
    expect(emptyPollDraft()).toEqual({ options: ['', ''], durationMinutes: 1440 });
    expect(cleanPollDraft(emptyPollDraft())).toBeNull();
  });

  it('is postable only with 2-4 filled choices of up to 25 characters', () => {
    expect(cleanPollDraft({ options: [' Linen ', 'Denim'], durationMinutes: 1440 })).toEqual({ options: ['Linen', 'Denim'], durationMinutes: 1440 });
    expect(cleanPollDraft({ options: ['a', 'b', ''], durationMinutes: 60 })).toBeNull();
    expect(cleanPollDraft({ options: ['a'], durationMinutes: 60 })).toBeNull();
    expect(cleanPollDraft({ options: ['a', 'b', 'c', 'd', 'e'], durationMinutes: 60 })).toBeNull();
    expect(cleanPollDraft({ options: ['a', 'x'.repeat(26)], durationMinutes: 60 })).toBeNull();
    expect(cleanPollDraft(null)).toBeNull();
  });

  it('clamps the length between 5 minutes and 7 days', () => {
    expect(joinMinutes(0, 0, 0)).toBe(5);
    expect(joinMinutes(7, 5, 30)).toBe(7 * 1440);
    expect(joinMinutes(1, 2, 3)).toBe(1440 + 123);
    expect(splitMinutes(1440 + 123)).toEqual({ days: 1, hours: 2, minutes: 3 });
  });
});

describe('poll copy', () => {
  it('formats the poll length like X', () => {
    expect(formatPollLength(1440)).toBe('1 day');
    expect(formatPollLength(2 * 1440 + 180)).toBe('2 days 3 hours');
    expect(formatPollLength(45)).toBe('45 minutes');
    expect(formatPollLength(61)).toBe('1 hour 1 minute');
  });

  it('formats time left and final results', () => {
    const now = Date.parse('2026-10-01T10:00:00Z');
    const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
    expect(formatTimeLeft(at(47 * 60), now)).toBe('1 day 23 hours left');
    expect(formatTimeLeft(at(24 * 60), now)).toBe('1 day left');
    expect(formatTimeLeft(at(23 * 60 + 10), now)).toBe('23 hours left');
    expect(formatTimeLeft(at(5), now)).toBe('5 minutes left');
    expect(formatTimeLeft(new Date(now + 10_000).toISOString(), now)).toBe('1 minute left');
    expect(formatTimeLeft(at(0), now)).toBe('Final results');
    expect(formatTimeLeft(null, now)).toBe('');
    expect(formatVotes(1)).toBe('1 vote');
    expect(formatVotes(1234)).toBe('1,234 votes');
  });
});

describe('postPollService', () => {
  beforeEach(() => { serviceRequest.mockReset(); __resetPollStore(); });

  it('batches feed lookups into one request', async () => {
    serviceRequest.mockResolvedValue({ polls: { a: { postId: 'a' } } });
    expect(await getPolls([])).toEqual({});
    expect(serviceRequest).not.toHaveBeenCalled();
    expect(await getPolls(['a', 'b'])).toEqual({ a: { postId: 'a' } });
    expect(serviceRequest).toHaveBeenCalledWith('/api/posts/polls?ids=a,b', {}, false);
  });

  it('saves a poll with PUT and votes with POST', async () => {
    serviceRequest.mockResolvedValue({ poll: { postId: 'p' } });
    await savePostPoll('p', { options: ['a', 'b'], durationMinutes: 60 });
    expect(serviceRequest).toHaveBeenLastCalledWith('/api/posts/p/poll', {
      method: 'PUT', body: JSON.stringify({ options: ['a', 'b'], durationMinutes: 60 }),
    });
    await voteInPoll('p', 1);
    expect(serviceRequest).toHaveBeenLastCalledWith('/api/posts/p/poll/vote', { method: 'POST', body: '{"optionIndex":1}' }, false);
  });

  it('keeps the poll the server returns with "already voted"', async () => {
    const err = Object.assign(new Error('409'), { body: JSON.stringify({ code: 'ALREADY_VOTED', poll: { postId: 'p', myVote: 0 } }) });
    serviceRequest.mockRejectedValue(err);
    await expect(voteInPoll('p', 1)).resolves.toMatchObject({ myVote: 0 });
    serviceRequest.mockRejectedValue(new Error('offline'));
    await expect(voteInPoll('p', 1)).rejects.toThrow('offline');
  });
});

describe('attachThreadPoll', () => {
  it('saves a valid poll for the new Thread', async () => {
    const save = vi.fn().mockResolvedValue({});
    const report = vi.fn();
    const post = { id: 'p1' };
    expect(await attachThreadPoll(post, { options: ['a', 'b'], durationMinutes: 60 }, save, report)).toBe(post);
    expect(save).toHaveBeenCalledWith('p1', { options: ['a', 'b'], durationMinutes: 60 });
    expect(report).not.toHaveBeenCalled();
  });

  it('does nothing without a postable poll', async () => {
    const save = vi.fn();
    await attachThreadPoll({ id: 'p1' }, null, save, vi.fn());
    await attachThreadPoll({ id: 'p1' }, { options: ['a', ''], durationMinutes: 60 }, save, vi.fn());
    expect(save).not.toHaveBeenCalled();
  });

  it('retries once, then reports without failing the post', async () => {
    const save = vi.fn().mockRejectedValue(new Error('down'));
    const report = vi.fn();
    const post = { id: 'p1' };
    await expect(attachThreadPoll(post, { options: ['a', 'b'], durationMinutes: 60 }, save, report)).resolves.toBe(post);
    expect(save).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
