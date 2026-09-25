/**
 * Brandthread AI screen — redesign + input/keyboard-inset contract tests.
 *
 * These assert against source text (this workspace has no jsdom renderer —
 * see vitest.config.ts, environment: "node" — so RN component trees can't be
 * mounted). They pin down the specific regression this redesign fixes (the
 * composer rendering behind the seller tab bar) and the pieces the redesign
 * brief calls out as required: the aurora empty state, reduced-motion
 * handling, and keeping every AI capability's wiring (send/stop/retry/apply/
 * dismiss/undo/clear) intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const screen = read('app/ai-brain.tsx');
const rootLayout = read('app/_layout.tsx');
const aurora = read('components/ai/AuroraGlow.tsx');
const composer = read('components/ai/AiComposer.tsx');

// ─── Bug fix: composer/content must clear the tab bar + home indicator ───────

describe('ai-brain input is never behind the seller tab bar', () => {
  it('the ai-brain route is deny-listed so the global seller tab bar never mounts on top of it', () => {
    const setBlock = rootLayout.match(
      /const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(setBlock, 'deny-list set must exist').toBeTruthy();
    expect(setBlock![1]).toContain("'ai-brain'");
  });

  it('the composer pins its own bottom padding to the safe-area inset, not a hardcoded value', () => {
    expect(screen).toContain('insets.bottom');
    expect(screen).toContain('composerBottomInset');
  });

  it('uses KeyboardAvoidingView so the composer rises with the keyboard', () => {
    expect(screen).toContain('KeyboardAvoidingView');
    expect(screen).toContain("Platform.OS === 'ios' ? 'padding' : 'height'");
  });

  it('renders the composer through the shared AiComposer component, not an inline input row', () => {
    expect(screen).toContain('<AiComposer');
    expect(screen).toContain("from '@/components/ai/AiComposer'");
  });
});

// ─── Redesign: aurora idle state ──────────────────────────────────────────────

describe('aurora idle/empty state', () => {
  it('the screen renders the aurora background behind all content', () => {
    expect(screen).toContain('<AuroraGlow');
    expect(screen).toContain("from '@/components/ai/AuroraGlow'");
  });

  it('aurora brightens while the AI is generating and calms down when idle', () => {
    expect(screen).toContain('thinking={isGenerating}');
  });

  it('the empty state centers the Brandthread logo with a glow and the required prompt copy', () => {
    expect(screen).toContain('What are we building today?');
    expect(screen).toContain('showGlow');
  });

  it('the empty state offers 3–4 real AI suggestion chips sourced from SCREEN_PROMPTS', () => {
    expect(screen).toContain('SCREEN_PROMPTS');
    expect(screen).toContain('prompts.slice(0, 4)');
  });
});

// ─── Redesign: reduced motion ─────────────────────────────────────────────────

describe('reduced motion is respected', () => {
  it('AuroraGlow freezes its breathing loop under reduced motion', () => {
    expect(aurora).toContain('useReducedMotion');
    expect(aurora).toMatch(/if \(reduceMotion\)/);
  });

  it('the composer shortens/disables its focus and morph animations under reduced motion', () => {
    expect(composer).toContain('useReducedMotion');
    expect(composer).toContain('reduceMotion');
  });

  it('the streaming dots indicator stops looping under reduced motion', () => {
    expect(screen).toContain('if (reduceMotion) return;');
  });
});

// ─── Regression guard: every existing AI capability stays wired ─────────────

describe('existing AI capabilities remain wired', () => {
  const requiredImports = [
    'sendMessage', 'cancelGeneration', 'loadSession', 'startNewSession',
    'clearSession', 'applyAction', 'undoAction',
  ];
  for (const fn of requiredImports) {
    it(`still imports and uses services/aiService.${fn}`, () => {
      expect(screen).toContain(fn);
    });
  }

  it('still supports apply / dismiss / undo action cards', () => {
    expect(screen).toContain('handleApply');
    expect(screen).toContain('handleDismiss');
    expect(screen).toContain('handleUndo');
    expect(screen).toContain('<ActionCardView');
  });

  it('still supports retry on error and stop-while-generating', () => {
    expect(screen).toContain('handleRetry');
    expect(screen).toContain('handleStop');
  });

  it('adds explicit copy/regenerate actions without removing the long-press copy affordance', () => {
    expect(screen).toContain('handleCopy');
    expect(screen).toContain('onLongPress');
  });

  it('sends turns through the streaming service call, keeping the same session-based contract', () => {
    // aiService.ts intentionally grew a sendMessageStream() alongside
    // sendMessage() so the screen can render tokens live; the session-based
    // contract (userText/session/authToken in, updated session out) is
    // unchanged, so assert the screen calls the streaming variant with it.
    expect(screen).toContain('sendMessageStream(');
    expect(screen).toContain('userText: text');
    expect(screen).toContain('session,');
  });
});
