import { describe, expect, it } from 'vitest';
import { ApiError } from './networkNotice';
import { aiToolErrorMessage } from './aiToolErrors';

describe('aiToolErrorMessage', () => {
  it('explains a Growth plan gate', () => {
    const err = new ApiError(403, JSON.stringify({ error: 'Upgrade required', code: 'PLAN_REQUIRED' }));
    expect(aiToolErrorMessage(err, 'fallback')).toBe('This AI tool needs the Growth plan.');
  });

  it('shows a 4xx server reason but hides 5xx details', () => {
    expect(aiToolErrorMessage(new ApiError(400, JSON.stringify({ error: 'Prompt is too long' })), 'fallback')).toBe('Prompt is too long');
    expect(aiToolErrorMessage(new ApiError(500, JSON.stringify({ error: 'db exploded' })), 'fallback')).toBe('fallback');
  });

  it('passes through local, human-written errors', () => {
    expect(aiToolErrorMessage(new Error('Each reference image must be under 8MB.'), 'fallback')).toBe('Each reference image must be under 8MB.');
    expect(aiToolErrorMessage('weird', 'fallback')).toBe('fallback');
  });
});
