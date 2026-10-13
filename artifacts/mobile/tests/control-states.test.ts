import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISABLED_OPACITY } from '@/constants/states';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/** Less-AI pass items 57, 70, 71, 72, 75: one rule per control state. */
describe('control states', () => {
  it('disabled is the whole control at 30% opacity', () => {
    expect(DISABLED_OPACITY).toBe(0.3);
    const button = read('components/ui/Button.tsx');
    expect(button).toContain('disabled && { opacity: DISABLED_OPACITY }');
    expect(button).not.toMatch(/isDisabled \? palette\.elevated/);
    const ui = read('components/BrandthreadUI.tsx');
    expect(ui).not.toMatch(/opacity: disabled \? 0\.[45]/);
  });

  it('destructive is red text, never a red fill', () => {
    const button = read('components/ui/Button.tsx');
    expect(button).toContain("case 'destructive': return { bg: 'transparent', fg: RED };");
    expect(button).toContain("const isFilled = variant === 'primary';");
  });

  it('text buttons carry no icon; icon-only buttons keep theirs', () => {
    expect(read('components/ui/Button.tsx')).toContain('{icon && !label && <Feather');
  });

  it('chips are solid when selected and an outline when not', () => {
    expect(read('components/ui/Chip.tsx')).toContain("backgroundColor: selected ? theme.accent : 'transparent'");
    expect(read('components/BrandthreadUI.tsx')).toContain("style={[fcS.chip, { backgroundColor: 'transparent', borderColor: palette.border }");
  });

  it('text links underline while pressed', () => {
    expect(read('components/BrandthreadUI.tsx')).toContain("textDecorationLine: pressed ? 'underline' : 'none'");
  });
});
