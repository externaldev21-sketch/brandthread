import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const { serviceRequest, configListeners } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  configListeners: [] as Array<() => void>,
}));
vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest,
  onServicesConfigured: (fn: () => void) => { configListeners.push(fn); return () => {}; },
}));

import { usePostPoll, type PostPoll } from './postPollService';

const POST = '11111111-2222-4333-8444-555555555555';
const poll = (myVote: number | null): PostPoll => ({
  postId: POST, options: [{ text: 'A', votes: 1, percent: 100 }, { text: 'B', votes: 0, percent: 0 }],
  totalVotes: 1, durationMinutes: 60, endsAt: null, isEnded: false, myVote,
  isAuthor: false, canVote: myVote === null, showResults: myVote !== null, winner: null,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('postPollService (audit)', () => {
  it("drops the previous account's vote when another account signs in", async () => {
    let seen: PostPoll | null | undefined;
    function Probe() { seen = usePostPoll(POST); return null; }

    // Account A voted for option 0.
    serviceRequest.mockResolvedValue({ polls: { [POST]: poll(0) } });
    await act(async () => { TestRenderer.create(<Probe />); });
    await act(async () => { await wait(60); });
    expect(seen?.myVote).toBe(0);

    // Account B signs in (auth re-wired) and has not voted.
    serviceRequest.mockResolvedValue({ polls: { [POST]: poll(null) } });
    await act(async () => { configListeners.forEach((fn) => fn()); });
    await act(async () => { await wait(60); });
    expect(seen?.myVote).toBeNull();
    expect(seen?.canVote).toBe(true);
  });
});
