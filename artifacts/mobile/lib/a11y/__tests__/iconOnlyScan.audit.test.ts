import { describe, expect, it } from 'vitest';
import { findUnlabeledIconOnlyPressables } from '../iconOnlyScan';

const scan = (child: string) =>
  findUnlabeledIconOnlyPressables('a.tsx', `const A = () => <Pressable onPress={f}><Feather name="x" />${child}</Pressable>;`);

describe('iconOnlyScan: an expression that can render text is never called icon-only', () => {
  it('reads the left side of || and ?? (it is what renders when present)', () => {
    expect(scan('{label || <Feather name="y" />}')).toHaveLength(0);
    expect(scan('{label ?? <Feather name="y" />}')).toHaveLength(0);
  });

  it('treats template literals, element access, non-null and casts as possible text', () => {
    expect(scan('{`Close`}')).toHaveLength(0);
    expect(scan('{labels[i]}')).toHaveLength(0);
    expect(scan('{label!}')).toHaveLength(0);
    expect(scan('{label as string}')).toHaveLength(0);
  });

  it('still flags a truly icon-only control', () => {
    expect(scan('')).toHaveLength(1);
    expect(scan('{null}')).toHaveLength(1);
    expect(scan('{open ? <Feather name="a" /> : <Feather name="b" />}')).toHaveLength(1);
    expect(scan('{busy && <Feather name="y" />}')).toHaveLength(1);
    expect(scan('{undefined ?? <Feather name="y" />}')).toHaveLength(1);
  });
});
