/**
 * A failed questions read must not render as a real empty state
 * ("Questions (0)" + "No questions yet") — that tells the buyer nobody has
 * asked anything when the app simply could not load the list.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const list = vi.fn();
const api = { productQa: { list } };

vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', borderSubtle: '#222' } }),
}));
vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return { PressableScale: (p: Record<string, unknown>) => React.createElement('PressableScale', p, p.children as React.ReactNode) };
});
vi.mock('@/components/ui/Button', () => {
  const React = require('react') as typeof import('react');
  return { Button: (p: Record<string, unknown>) => React.createElement('Button', p) };
});

import { ProductQuestionsSection } from '../ProductQuestionsSection';

function texts(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((n) => typeof n.type === 'string')
    .map((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
      .filter((c: unknown) => typeof c === 'string' || typeof c === 'number')
      .join(''))
    .filter(Boolean)
    .join(' | ');
}

describe('ProductQuestionsSection', () => {
  it('does not claim zero questions when the read fails', async () => {
    list.mockRejectedValueOnce(new Error('network down'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProductQuestionsSection productId="p1" />); });
    const out = texts(renderer);
    expect(out).not.toContain('Questions (0)');
    expect(out).not.toContain('No questions yet');
    // The Ask entry point stays available.
    expect(renderer.root.findAll((n) => (n.type as unknown) === 'Button')).toHaveLength(1);
  });

  it('still shows the real empty state for a product with no questions', async () => {
    list.mockResolvedValueOnce({ questions: [], totalCount: 0 });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProductQuestionsSection productId="p2" />); });
    const out = texts(renderer);
    expect(out).toContain('Questions (0)');
    expect(out).toContain('No questions yet');
  });

  it('shows the count and featured answered question on success', async () => {
    list.mockResolvedValueOnce({
      questions: [
        { id: 'q1', body: 'Is it warm?', answer: null },
        { id: 'q2', body: 'Does it run small?', answer: { id: 'a', body: 'True to size' } },
      ],
      totalCount: 7,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProductQuestionsSection productId="p3" />); });
    const out = texts(renderer);
    expect(out).toContain('Questions (7)');
    expect(out).toContain('Does it run small?');
  });
});
