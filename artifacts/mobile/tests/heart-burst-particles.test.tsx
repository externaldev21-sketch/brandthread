import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

import { HeartBurstParticles } from '@/components/buyer-feed/HeartBurstParticles';

describe('feed heart burst', () => {
  it('shows no center dot before a double-tap, then renders the burst', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<HeartBurstParticles trigger={0} />); });
    expect(tree.toJSON()).toBeNull();
    act(() => { tree.update(<HeartBurstParticles trigger={1} />); });
    expect(tree.root.findAll(node => String(node.type) === 'Feather' && node.props.name === 'heart')).toHaveLength(8);
    act(() => { tree.unmount(); });
  });
});