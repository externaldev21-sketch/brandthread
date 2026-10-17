import { describe, expect, it } from 'vitest';
import {
  LIVE_NOT_CONFIGURED_BODY, formatShowDuration, isLiveNotConfiguredError, liveStartErrorMessage,
} from './liveAvailability';

describe('live availability copy', () => {
  it('maps the structured LIVE_NOT_CONFIGURED code to human copy', () => {
    const error = { code: 'LIVE_NOT_CONFIGURED', message: "API 503: Live streaming isn't set up yet." };
    expect(isLiveNotConfiguredError(error)).toBe(true);
    expect(liveStartErrorMessage(error)).toBe(LIVE_NOT_CONFIGURED_BODY);
  });

  it('never shows the raw env-var message from older servers', () => {
    const message = liveStartErrorMessage({ message: 'API 503: AGORA_APP_ID not configured' });
    expect(message).toBe(LIVE_NOT_CONFIGURED_BODY);
    expect(message).not.toContain('AGORA');
  });

  it('strips the API status prefix from other errors', () => {
    expect(liveStartErrorMessage({ message: 'API 409: You already have a live stream. End it first.' }))
      .toBe('You already have a live stream. End it first.');
    expect(liveStartErrorMessage(undefined)).toBe('Please check your connection and try again.');
  });

  it('formats a show duration like the post-broadcast summary', () => {
    expect(formatShowDuration(45)).toBe('45s');
    expect(formatShowDuration(2550)).toBe('42m 30s');
    expect(formatShowDuration(3900)).toBe('1h 05m');
    expect(formatShowDuration(-3)).toBe('0s');
  });
});
