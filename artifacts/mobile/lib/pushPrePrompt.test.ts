import { describe, expect, it } from 'vitest';
import {
  PRE_PROMPT_COOLDOWN_MS,
  parseDeclines,
  prePromptAllowed,
  prePromptCopy,
  registerPushPrePrompt,
  showPushPrePrompt,
} from './pushPrePrompt';

describe('pre-prompt pacing', () => {
  const now = 1_800_000_000_000;
  it('asks the first time', () => {
    expect(prePromptAllowed({ count: 0, lastAt: null }, now)).toBe(true);
  });
  it('waits a week after "Not now"', () => {
    expect(prePromptAllowed({ count: 1, lastAt: now - 1000 }, now)).toBe(false);
    expect(prePromptAllowed({ count: 1, lastAt: now - PRE_PROMPT_COOLDOWN_MS }, now)).toBe(true);
  });
  it('stops after three "Not now"s', () => {
    expect(prePromptAllowed({ count: 3, lastAt: now - 10 * PRE_PROMPT_COOLDOWN_MS }, now)).toBe(false);
  });
  it('parses stored state defensively', () => {
    expect(parseDeclines(null)).toEqual({ count: 0, lastAt: null });
    expect(parseDeclines('{bad')).toEqual({ count: 0, lastAt: null });
    expect(parseDeclines('{"count":2,"lastAt":5}')).toEqual({ count: 2, lastAt: 5 });
  });
});

describe('presenter', () => {
  it('goes straight through when no sheet host is mounted', async () => {
    await expect(showPushPrePrompt('follow')).resolves.toBe(true);
  });
  it('uses the mounted host and unregisters cleanly', async () => {
    const off = registerPushPrePrompt(async (reason) => reason === 'order');
    await expect(showPushPrePrompt('order')).resolves.toBe(true);
    await expect(showPushPrePrompt('follow')).resolves.toBe(false);
    off();
    await expect(showPushPrePrompt('follow')).resolves.toBe(true);
  });
});

describe('copy', () => {
  it('says why, in one short line, for each moment', () => {
    for (const reason of ['follow', 'order', 'message', 'general'] as const) {
      const { title, body } = prePromptCopy(reason);
      expect(title.length).toBeLessThanOrEqual(28);
      expect(body.split('.').filter(Boolean)).toHaveLength(1);
      expect(`${title} ${body}`).not.toMatch(/!|journey|never miss/i);
    }
  });
});
