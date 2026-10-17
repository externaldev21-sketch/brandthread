import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const source = readFileSync(resolve(__dirname, '../components/buyer-feed/LiveEdgeTab.tsx'), 'utf8');

describe('LIVE edge label clearance', () => {
  it('sizes both rotated axes from the unconstrained text measurement plus padding', () => {
    expect(source).toContain('onLayout={measureLabel}');
    expect(source).toContain('labelSize.width + REST_LABEL_PADDING * 2');
    expect(source).toContain('labelSize.height + REST_LABEL_CROSS_PADDING * 2');
    expect(source).toContain('left: (LIVE_EDGE_WIDTH - restHeight) / 2');
    expect(source).toContain('top: (LIVE_EDGE_HEIGHT - restWidth) / 2');
  });
  it('does not truncate the resting word or clip its rotated wrappers', () => {
    const label = source.match(/<Text[^>]*testID="live-edge-rest-label"[^>]*>LIVE<\/Text>/)?.[0];
    expect(label).toBeTruthy();
    expect(label).not.toContain('numberOfLines');
    expect(label).not.toContain('ellipsizeMode');
    expect(source.match(/overflow: 'visible'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('flexShrink: 0');
  });
  it('retains the original font, spring, edge anchoring and Cart push', () => {
    expect(source).toContain('fontSize: 9.5');
    expect(source).toContain('fontWeight: \'800\'');
    expect(source).toContain('duration: 250, dampingRatio: 0.92');
    expect(source).toContain('const tuckedX = restCenterX - LIVE_EDGE_WIDTH / 2;');
    expect(source).toContain('{ translateX: pushX * progress.value }');
  });
});
