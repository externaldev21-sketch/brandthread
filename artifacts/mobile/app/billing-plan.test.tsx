/**
 * Plan & billing screen (app/billing.tsx): current plan card, change plan via
 * checkout (in-place switch), cancel → "Cancels on" + Keep plan → resume,
 * App Store plans, and the no-plan state.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, roleState, sheetProps, alertMock, linkingMock } = vi.hoisted(() => ({
  apiMock: {
    seller: {
      subscription: {
        status: vi.fn(),
        invoices: vi.fn(),
        perks: vi.fn(),
        checkout: vi.fn(),
        portal: vi.fn(),
        cancel: vi.fn(),
        resume: vi.fn(),
      },
    },
  },
  roleState: { currentRole: 'owner' as string },
  sheetProps: {} as Record<string, any>,
  alertMock: vi.fn(),
  linkingMock: { openURL: vi.fn() },
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => {
    const C = (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
    C.displayName = name;
    return C;
  };
  return {
    ActivityIndicator: el('ActivityIndicator'),
    Alert: { alert: alertMock },
    Linking: linkingMock,
    Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
    ScrollView: el('ScrollView'),
    Share: { share: vi.fn() },
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    Text: el('Text'),
    TouchableOpacity: el('TouchableOpacity'),
    View: el('View'),
  };
});
vi.mock('@expo/vector-icons', () => ({ Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }) }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react') as typeof import('react');
    React.useEffect(cb, [cb]);
  },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user_test' }) }));
vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));
vi.mock('@/hooks/useTeamRole', () => ({ useTeamRole: () => ({ currentRole: roleState.currentRole, isLoadingRole: false }) }));
vi.mock('@/hooks/useSubscriptionPlan', () => ({ invalidatePlanCache: vi.fn() }));
vi.mock('@/lib/revenueCat', () => ({ useRevenueCat: () => ({ managementURL: null, restore: vi.fn() }) }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false, isPreviewDemoMode: () => false }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#c0c0c0', border: '#333', background: '#000' } }),
}));
vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title: string }) => React.createElement('Text', null, title),
}));
vi.mock('@/components/RoleLockedView', () => ({ RoleLockedView: () => React.createElement('RoleLockedView') }));
vi.mock('@/components/ui', () => ({
  Button: ({ label, onPress, testID, disabled }: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) =>
    React.createElement('Button', { testID, onPress, disabled }, React.createElement('Text', null, label)),
  Icon: ({ name }: { name: string }) => React.createElement('Icon', { name }),
  SkeletonBlock: () => null,
  SkeletonLine: () => null,
}));
vi.mock('@/components/billing/PlanSheets', () => {
  const capture = (name: string) => (props: Record<string, any>) => {
    sheetProps[name] = props;
    return null;
  };
  return {
    ChangePlanSheet: capture('change'),
    CancelPlanSheet: capture('cancel'),
    PlanFeaturesSheet: capture('features'),
    PlanOptionCard: ({ plan, actionLabel, onAction, testID }: any) =>
      React.createElement('Button', { testID, onPress: onAction }, React.createElement('Text', null, `${plan.name} ${actionLabel}`)),
  };
});

import BillingScreen from './billing';

const ACTIVE = {
  plan: 'growth', status: 'active', trialEnd: null, renewsOn: 'Nov 9, 2026', amountCents: 7900,
  paymentMethodLabel: 'Visa ···· 4242', cancelAtPeriodEnd: false, effectiveProvider: 'stripe',
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<BillingScreen />);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return r;
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (!node || typeof node !== 'object') return '';
  const n = node as { children?: unknown };
  return text(n.children);
}

const has = (r: ReactTestRenderer, testID: string) => r.root.findAllByProps({ testID }).length > 0;

async function press(r: ReactTestRenderer, testID: string) {
  await act(async () => {
    r.root.findAllByProps({ testID }).find((n) => typeof n.props.onPress === 'function')!.props.onPress();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  roleState.currentRole = 'owner';
  for (const fn of Object.values(apiMock.seller.subscription)) fn.mockReset();
  apiMock.seller.subscription.status.mockResolvedValue(ACTIVE);
  apiMock.seller.subscription.invoices.mockResolvedValue({ invoices: [] });
  apiMock.seller.subscription.perks.mockRejectedValue(new Error('offline'));
  for (const key of Object.keys(sheetProps)) delete sheetProps[key];
});

afterEach(() => vi.clearAllMocks());

describe('billing — current plan', () => {
  it('shows plan name, monthly price, status, renewal date and payment method', async () => {
    const r = await render();
    const t = text(r.toJSON());
    expect(t).toContain('Growth');
    expect(t).toContain('$79');
    expect(t).toContain('USD/month');
    expect(t).toContain('Active');
    expect(t).toContain('Renews on Nov 9, 2026');
    expect(t).toContain('Visa ···· 4242');
    expect(t).toContain('Upcoming bill');
    expect(has(r, 'billing-change-plan')).toBe(true);
    expect(has(r, 'billing-cancel-plan')).toBe(true);
  });

  it('shows Trial ends for a trial', async () => {
    apiMock.seller.subscription.status.mockResolvedValue({ ...ACTIVE, status: 'trialing', trialEnd: 'Oct 14, 2026' });
    const t = text((await render()).toJSON());
    expect(t).toContain('Trial ends Oct 14, 2026');
    expect(t).toContain('First bill is due Oct 14, 2026');
  });
});

describe('billing — change plan', () => {
  it('switches through checkout in place and refreshes', async () => {
    const r = await render();
    await press(r, 'billing-change-plan');
    expect(sheetProps.change.visible).toBe(true);
    apiMock.seller.subscription.checkout.mockResolvedValue({ updated: true, url: 'https://x/return' });
    apiMock.seller.subscription.status.mockResolvedValue({ ...ACTIVE, plan: 'pro', amountCents: 19900 });
    await act(async () => {
      await sheetProps.change.onConfirm('pro');
    });
    expect(apiMock.seller.subscription.checkout).toHaveBeenCalledWith('pro');
    expect(linkingMock.openURL).not.toHaveBeenCalled();
    expect(text(r.toJSON())).toContain('Pro');
    expect(alertMock).toHaveBeenCalledWith('Plan updated', "You're now on Pro.");
  });
});

describe('billing — cancel and keep plan', () => {
  it('cancels with the reason, then shows Cancels on + Keep plan, and resumes', async () => {
    const r = await render();
    await press(r, 'billing-cancel-plan');
    expect(sheetProps.cancel.visible).toBe(true);
    expect(sheetProps.cancel.lowerPlanId).toBe('starter');

    apiMock.seller.subscription.cancel.mockResolvedValue({ status: 'active', cancelAtPeriodEnd: true, endsAt: null });
    apiMock.seller.subscription.status.mockResolvedValue({ ...ACTIVE, cancelAtPeriodEnd: true });
    await act(async () => {
      await sheetProps.cancel.onConfirm({ reason: 'too_expensive' });
    });
    expect(apiMock.seller.subscription.cancel).toHaveBeenCalledWith({ reason: 'too_expensive' });
    const t = text(r.toJSON());
    expect(t).toContain('Plan ends on Nov 9, 2026');
    expect(t).toContain('Cancels on Nov 9, 2026');
    expect(t).toContain('No upcoming bill');
    expect(has(r, 'billing-keep-plan')).toBe(true);
    expect(has(r, 'billing-cancel-plan')).toBe(false);

    apiMock.seller.subscription.resume.mockResolvedValue({ status: 'active', cancelAtPeriodEnd: false, endsAt: null });
    apiMock.seller.subscription.status.mockResolvedValue(ACTIVE);
    await press(r, 'billing-keep-plan');
    expect(apiMock.seller.subscription.resume).toHaveBeenCalled();
    expect(has(r, 'billing-keep-plan')).toBe(false);
    expect(text(r.toJSON())).toContain('Renews on Nov 9, 2026');
  });
});

describe('billing — App Store plans and no plan', () => {
  it('does not offer Stripe change/cancel for App Store / Google Play plans', async () => {
    apiMock.seller.subscription.status.mockResolvedValue({ ...ACTIVE, renewsOn: null, effectiveProvider: 'revenuecat', paymentMethodLabel: null });
    const r = await render();
    expect(has(r, 'billing-change-plan')).toBe(false);
    expect(has(r, 'billing-cancel-plan')).toBe(false);
    expect(text(r.toJSON())).toContain('Billed through the App Store or Google Play.');
  });

  it('shows plans to pick when there is no plan, and starts checkout', async () => {
    apiMock.seller.subscription.status.mockResolvedValue({ ...ACTIVE, status: 'none', renewsOn: null, amountCents: 0, paymentMethodLabel: null });
    const r = await render();
    expect(has(r, 'billing-no-plan')).toBe(true);
    expect(text(r.toJSON())).toContain('Starter Try Starter');
    apiMock.seller.subscription.checkout.mockResolvedValue({ url: 'https://checkout.stripe.test/s' });
    await press(r, 'billing-start-growth');
    expect(apiMock.seller.subscription.checkout).toHaveBeenCalledWith('growth');
    expect(linkingMock.openURL).toHaveBeenCalledWith('https://checkout.stripe.test/s');
  });

  it('hides plan actions from managers', async () => {
    roleState.currentRole = 'manager';
    const r = await render();
    expect(has(r, 'billing-change-plan')).toBe(false);
    expect(has(r, 'billing-cancel-plan')).toBe(false);
    expect(has(r, 'seller-billing-payment-method')).toBe(false);
  });
});
