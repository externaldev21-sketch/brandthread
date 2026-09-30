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

// ─── Full-screen composer clears the home indicator without a seller bar ─────

describe('ai-brain uses a full-screen composer', () => {
  it('deny-lists the ai-brain route so the global seller tab bar stays hidden', () => {
    const setBlock = rootLayout.match(
      /const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(setBlock, 'deny-list set must exist').toBeTruthy();
    expect(setBlock![1]).toContain("'ai-brain'");
  });

  it('uses only the safe-area bottom inset for the composer', () => {
    expect(screen).toContain('const composerBottomInset = Math.max(insets.bottom, 8);');
    expect(screen).toContain('bottomInset={composerBottomInset}');
    expect(screen).not.toContain('sellerBar.occupiedHeight');
  });

  it('uses KeyboardAvoidingView so the composer rises with the keyboard', () => {
    expect(screen).toContain('KeyboardAvoidingView');
    expect(screen).toContain("Platform.OS === 'ios' ? 'padding' : 'height'");
  });

  it('renders the composer through the shared AiComposer component, not an inline input row', () => {
    expect(screen).toContain('<AiComposer');
    expect(screen).toContain("from '@/components/ai/AiComposer'");
  });

  it('keeps the input focusable and submits text from the keyboard or send button', () => {
    expect(composer).toContain('pointerEvents="none"');
    expect(composer).toContain('submitBehavior="submit"');
    expect(composer).toContain('onChangeText={onChangeText}');
    expect(composer).toContain('onPress={isGenerating ? onStop : onSend}');
    expect(composer).toContain('zIndex: 1');
    expect(composer).toContain('height: 36');
    expect(composer).toContain('minHeight: 36');
  });

  it('uses preview replies for signed-out previews and guards signed-in token failures', () => {
    expect(screen).toContain('if (!isSignedIn)');
    expect(screen).toContain('sendPreviewMessageStream(');
    expect(screen).toContain('const token = await getToken().catch(() => null)');
    expect(screen).toContain("Couldn't verify your session. Tap Retry.");
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────
// Dev's explicit rule for this screen: no translucent overlays, no grey
// fills — solid black background. The aurora glow background (and the
// empty-state logo's own glow halo) were removed for exactly this reason;
// AuroraGlow.tsx still exists and is still reduced-motion-safe (see below),
// it's simply no longer used on this screen.

describe('empty state', () => {
  it('the screen has a solid black background, not the aurora glow or a themed color', () => {
    expect(screen).not.toContain('<AuroraGlow');
    expect(screen).not.toContain("from '@/components/ai/AuroraGlow'");
    expect(screen).toContain("backgroundColor: '#000000'");
  });

  it('the empty state does not give the logo a glow halo', () => {
    expect(screen).not.toMatch(/<BrandthreadLogo[^>]*showGlow/);
  });

  it('the empty state centers the Brandthread logo with the required prompt copy', () => {
    expect(screen).toContain('What are we building today?');
    expect(screen).toContain('<BrandthreadLogo');
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
