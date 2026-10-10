import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREATE_MODES_BY_ROLE, MODE_LABEL, stepCreateMode, storyCameraModes } from '@/constants/postLimits';

const src = readFileSync(resolve(process.cwd(), 'app/buyer-story-create.tsx'), 'utf8');
const cameraStep = src.slice(src.indexOf("if (step === 'camera')"), src.indexOf('{/* Bottom controls */}'));
const topBar = cameraStep.slice(cameraStep.indexOf('{/* Top bar'), cameraStep.indexOf('{/* Left-side vertical tool rail'));
const rail = cameraStep.slice(cameraStep.indexOf('{/* Left-side vertical tool rail'), cameraStep.indexOf('{gridPopoverOpen &&'));

describe('story camera mode switcher', () => {
  it('lists every creation mode per role: seller THREAD, POST, STORY, LIVE; buyer POST, STORY', () => {
    expect(storyCameraModes('seller').map((m) => MODE_LABEL[m])).toEqual(['THREAD', 'POST', 'STORY', 'LIVE']);
    expect(storyCameraModes('buyer').map((m) => MODE_LABEL[m])).toEqual(['POST', 'STORY']);
  });

  it('only ever offers modes the role has in CREATE_MODES_BY_ROLE', () => {
    for (const role of ['seller', 'buyer'] as const) {
      expect([...storyCameraModes(role)].sort()).toEqual([...CREATE_MODES_BY_ROLE[role]].sort());
    }
  });

  it('steps one mode per swipe and clamps at the ends', () => {
    const seller = storyCameraModes('seller');
    expect(stepCreateMode(seller, 'story', 1)).toBe('live');
    expect(stepCreateMode(seller, 'story', -1)).toBe('post');
    expect(stepCreateMode(seller, 'live', 1)).toBe('live');
    expect(stepCreateMode(seller, 'thread', -1)).toBe('thread');
    const buyer = storyCameraModes('buyer');
    expect(stepCreateMode(buyer, 'story', 1)).toBe('story');
    expect(stepCreateMode(buyer, 'story', -1)).toBe('post');
  });

  it('renders the shared list (no hardcoded mode array) and routes THREAD/POST to create-post with their mode', () => {
    expect(cameraStep).not.toMatch(/\['post', 'story'/);
    expect(src).toContain("const cameraModes = storyCameraModes(isSeller ? 'seller' : 'buyer');");
    expect(src).toContain('{cameraModes.map((m) => {');
    expect(src).toContain("if (m === 'thread' || m === 'post') { router.push({ pathname: '/create-post', params: { accountType: isSeller ? 'seller' : 'buyer', mode: m } } as any); return; }");
    expect(src).toContain('{...modeSwipe.panHandlers}');
  });
});

describe('story camera flash placement', () => {
  it('keeps only X and settings in the top bar', () => {
    expect(topBar).toContain('accessibilityLabel="Close"');
    expect(topBar).toContain('accessibilityLabel="Story settings"');
    expect(topBar).not.toMatch(/zap|flash/i);
  });

  it('puts flash first in the left rail, above Aa, and only with a live camera', () => {
    const order = ["'Turn flash on'", 'railAa', 'accessibilityLabel="Boomerang"', 'accessibilityLabel="Layout"', 'accessibilityLabel="Hands-free"', "'Expand tools'"]
      .map((needle) => rail.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rail).toMatch(/\{hasPermission && \(\s*<TouchableOpacity\s*style=\{styles\.railBtn\}/);
    expect(rail).toContain("<Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={20} color={flash === 'on' ? '#FBBF24' : ON_DARK} />");
  });
});
