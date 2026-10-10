import { beforeEach, describe, expect, it, vi } from 'vitest';

const alert = vi.fn();
vi.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => alert(...args) } }));

import { ApiError } from './networkNotice';
import { promptUpgradeOnPlanGate } from './planUpgradePrompt';

const gate = (body: Record<string, unknown>) => new ApiError(403, JSON.stringify(body));

describe('promptUpgradeOnPlanGate', () => {
  beforeEach(() => alert.mockReset());

  it("shows the server's sentence with a way to the plans", () => {
    const router = { push: vi.fn() };
    const handled = promptUpgradeOnPlanGate(gate({
      code: 'PLAN_REQUIRED', feature: 'drops', requiredPlan: 'growth',
      message: 'Drops and pre-orders is on the Growth plan. Upgrade to use it.',
    }), router);
    expect(handled).toBe(true);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Upgrade to Growth');
    expect(message).toBe('Drops and pre-orders is on the Growth plan. Upgrade to use it.');
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Not now', 'View plans']);
    buttons[1].onPress();
    expect(router.push).toHaveBeenCalledWith('/subscription');
  });

  it('names Pro for Pro-only actions', () => {
    promptUpgradeOnPlanGate(gate({ code: 'PLAN_REQUIRED', requiredPlan: 'pro', message: 'Analytics export is on the Pro plan. Upgrade to use it.' }), { push: vi.fn() });
    expect(alert.mock.calls[0][0]).toBe('Upgrade to Pro');
  });

  it('leaves every other error to the screen', () => {
    expect(promptUpgradeOnPlanGate(new ApiError(500, '{"error":"boom"}'), { push: vi.fn() })).toBe(false);
    expect(promptUpgradeOnPlanGate(new Error('offline'), { push: vi.fn() })).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });
});
