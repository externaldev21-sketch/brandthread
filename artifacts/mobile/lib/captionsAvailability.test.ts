import { describe, expect, it } from 'vitest';
import { captionsUnavailableCopy, isCaptionsUnavailableError } from './captionsAvailability';

const err = (reason?: string) => ({
  status: 503,
  code: 'CAPTIONS_UNAVAILABLE',
  body: JSON.stringify({ code: 'CAPTIONS_UNAVAILABLE', error: 'x', ...(reason ? { reason } : {}) }),
});

describe('captions availability copy', () => {
  it('detects the unavailable response', () => {
    expect(isCaptionsUnavailableError(err())).toBe(true);
    expect(isCaptionsUnavailableError({ status: 404 })).toBe(false);
  });

  it('says "not set up" when the server has no transcription keys', () => {
    expect(captionsUnavailableCopy(err('CAPTIONS_NOT_CONFIGURED')).title).toMatch(/set up yet/);
  });

  it('says "not turned on" when the flag is off or the reason is unknown', () => {
    expect(captionsUnavailableCopy(err('CAPTIONS_DISABLED')).title).toMatch(/turned on yet/);
    expect(captionsUnavailableCopy(err()).title).toMatch(/turned on yet/);
    expect(captionsUnavailableCopy({ body: 'not json' }).title).toMatch(/turned on yet/);
  });
});
