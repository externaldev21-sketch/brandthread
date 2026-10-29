/**
 * BT-372 (AI data consent), BT-374 (public Support URL), BT-376 (hide Go Live
 * without Agora): pure logic plus source wiring checks.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AI_CONSENT_COPY,
  cacheAiConsent,
  clearCachedAiConsent,
  hasCachedAiConsent,
  isAiConsentRequiredError,
} from '../lib/aiConsent';
import { parseLiveConfig, shouldShowGoLive } from '../lib/liveConfig';
import { isSignedInOnlyPath } from '../lib/guestApiPolicy';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AI consent (BT-372)', () => {
  beforeEach(() => clearCachedAiConsent());

  it('detects the server refusal', () => {
    expect(isAiConsentRequiredError({ status: 428 })).toBe(true);
    expect(isAiConsentRequiredError({ status: 400, code: 'AI_CONSENT_REQUIRED' })).toBe(true);
    expect(isAiConsentRequiredError({ status: 500 })).toBe(false);
    expect(isAiConsentRequiredError(null)).toBe(false);
  });

  it('caches consent per account only', () => {
    expect(hasCachedAiConsent('user_a')).toBe(false);
    cacheAiConsent('user_a');
    expect(hasCachedAiConsent('user_a')).toBe(true);
    expect(hasCachedAiConsent('user_b')).toBe(false);
    clearCachedAiConsent();
    expect(hasCachedAiConsent('user_a')).toBe(false);
  });

  it('copy names the recipient, the data and the purpose, with Allow / Not now', () => {
    const all = Object.values(AI_CONSENT_COPY).join(' ');
    expect(all).toContain('OpenAI');
    expect(AI_CONSENT_COPY.lead).toMatch(/messages/);
    expect(AI_CONSENT_COPY.lead).toMatch(/history/);
    expect(AI_CONSENT_COPY.lead).toMatch(/reply/);
    expect(AI_CONSENT_COPY.allow).toBe('Allow');
    expect(AI_CONSENT_COPY.notNow).toBe('Not now');
    expect(all).not.toContain('!');
  });

  it('gates agent requests through the shared consent boundary before provider calls', () => {
    const conv = source('app/buyer-conversation.tsx');
    expect(conv).toContain('ConversationThread');
    const service = source('services/aiService.ts');
    expect(service).toContain('withAiConsent(() => callAI(');
    expect(service).toContain('withAiConsent(() => callAIStream(');
    const routes = source('../api-server/src/routes/index.ts');
    expect(routes).toMatch(/"\/brandthread-agent",\s+requireAiConsent\(\), aiSafetyGuard/);
    expect(source('app/_layout.tsx')).toContain('<AiConsentSheet');
  });

  it('sheet uses the shared solid elevated surface and links the privacy policy', () => {
    const sheet = source('components/AiConsentSheet.tsx');
    expect(sheet).toContain('<BottomSheet');
    expect(sheet).toContain("'/privacy'");
    const primitive = source('components/ui/BottomSheet.tsx');
    expect(primitive).toContain('backgroundColor: FILL_ELEVATED');
    expect(sheet).not.toMatch(/BlurView/);
  });

  it('consent endpoint is never called signed out', () => {
    expect(isSignedInOnlyPath('/api/ai-consent')).toBe(true);
  });
});

describe('public Support URL (BT-374)', () => {
  it("'help' is a public screen", () => {
    const layout = source('app/_layout.tsx');
    const line = layout.split('\n').find((l) => l.startsWith('const PUBLIC_SCREENS'));
    expect(line).toContain("'help'");
  });

  it('help shows the support email and never sends a signed-out ticket to the API', () => {
    const help = source('app/help.tsx');
    expect(help).toContain("const SUPPORT_EMAIL = 'support@brandthread.app'");
    // The address is shown as text; the "Email Us" tile is the one mailto control.
    expect(help).toContain('{SUPPORT_EMAIL}</Text>');
    expect(help.match(/openURL\(`mailto:\$\{SUPPORT_EMAIL\}`\)/g)).toHaveLength(1);
    expect(help).not.toContain("openURL('https://brandthread.app/help')");
    const submit = help.slice(help.indexOf('async function handleSubmitTicket'));
    expect(submit.indexOf('if (!isSignedIn)')).toBeGreaterThan(-1);
    expect(submit.indexOf('if (!isSignedIn)')).toBeLessThan(submit.indexOf('api.support.submitTicket'));
  });
});

describe('Go Live availability (BT-376)', () => {
  it('hides Go Live only on an explicit false', () => {
    expect(shouldShowGoLive(false)).toBe(false);
    expect(shouldShowGoLive(true)).toBe(true);
    expect(shouldShowGoLive(undefined)).toBe(true);
  });

  it('parses the config payload defensively', () => {
    expect(parseLiveConfig({ liveAvailable: false })).toBe(false);
    expect(parseLiveConfig({ liveAvailable: true })).toBe(true);
    expect(parseLiveConfig({ liveAvailable: 'no' })).toBeUndefined();
    expect(parseLiveConfig(null)).toBeUndefined();
  });

  it('config endpoint is public', () => {
    expect(isSignedInOnlyPath('/api/config/live')).toBe(false);
  });
});
