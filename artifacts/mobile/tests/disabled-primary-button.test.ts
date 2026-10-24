/**
 * Disabled primary buttons used to paint `palette.elevated` — `#000000` on
 * the default Monochrome theme — so a disabled CTA was bare grey text on a
 * black screen. They now get a visible silver-wash fill, hairline silver
 * border and muted label (lib/disabledButton.ts); enabled styles unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: null }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ auth: { me: async () => ({}) } }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { APP_THEME_PRESETS } from '@/contexts/AppThemeContext';
import { getDisabledFilledButtonColors } from '@/lib/disabledButton';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('getDisabledFilledButtonColors', () => {
  it.each(APP_THEME_PRESETS.map((t) => [t.id, t] as const))('%s: fill differs from the screen background and the label is muted', (_id, theme) => {
    const c = getDisabledFilledButtonColors(theme);
    expect(c.bg).toBe(theme.borderSubtle);
    expect(c.bg).not.toBe(theme.background);
    expect(c.bg).not.toBe(theme.cardElevated);
    expect(c.border).toBe(theme.border);
    expect(c.fg).toBe(theme.muted);
    expect(c.fg).not.toBe(theme.text);
  });
});

describe('Button / PrimaryButton disabled styling', () => {
  const button = read('components/ui/Button.tsx');
  const legacy = read('components/BrandthreadUI.tsx');

  it('ui/Button primary + destructive use the visible disabled fill with a hairline border', () => {
    expect(button).toContain("case 'primary': return isDisabled ? disabledFilled : { bg: theme.accent, fg: theme.onAccent };");
    expect(button).toContain("case 'destructive': return isDisabled ? disabledFilled : { bg: RED, fg: palette.background };");
    expect(button).toContain('isFilled && isDisabled && { borderWidth: StyleSheet.hairlineWidth, borderColor: variantStyle.border }');
    expect(button).not.toMatch(/isDisabled \? palette\.elevated/);
  });

  it('PrimaryButton paints the disabled fill and a muted, full-opacity label', () => {
    expect(legacy).toContain('colors={disabled ? [disabledColors.bg, disabledColors.bg] : buttonColors}');
    expect(legacy).toContain('disabled ? { color: disabledColors.fg, fontSize: small ? FS.sm : FS.base }');
    expect(legacy).not.toContain('[palette.elevated, palette.elevated]');
  });

  it('keeps the enabled styles untouched', () => {
    expect(button).toContain('isFilled && !isDisabled && styles.raisedShadow');
    expect(legacy).toContain('[onAccentTextStyle, { fontSize: small ? FS.sm : FS.base }]');
  });
});

describe('Composer send button touch target', () => {
  const composer = read('components/ui/Composer.tsx');
  it('the Pressable is >= 44pt while the drawn circle stays 32pt', () => {
    expect(composer).toContain('export const COMPOSER_SEND_HIT_SIZE = 44;');
    expect(composer).toContain('export const COMPOSER_SEND_SIZE = 32;');
    expect(composer).toContain('style={styles.sendHit}');
    expect(composer).toContain('margin: -(COMPOSER_SEND_HIT_SIZE - COMPOSER_SEND_SIZE) / 2');
  });
});

describe('AiGeneratedBadge type', () => {
  const badge = read('components/AiGeneratedBadge.tsx');
  it('uses 11pt Inter via the FONT token, no raw fontWeight', () => {
    expect(badge).toContain('fontSize: 11');
    expect(badge).toContain('fontFamily: FONT.semibold');
    expect(badge).not.toContain('fontWeight');
  });
});
