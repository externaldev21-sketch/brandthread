import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'google' | 'apple';
type AlertButton = {
  text?: string;
  onPress?: () => void | Promise<void>;
};

const { alertMock, useUserMock, routerBackMock, routerPushMock } = vi.hoisted(() => ({
  alertMock: vi.fn(),
  useUserMock: vi.fn(),
  routerBackMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const React = require('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: alertMock },
    Modal: nativeComponent('Modal'),
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Animated: {
      Value: class { constructor(_v?: number) {} },
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: routerBackMock, push: routerPushMock }),
}));

vi.mock('@clerk/expo', () => ({
  useUser: useUserMock,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
  Ionicons: ({ name }: { name: string }) => React.createElement('Ionicons', { name }),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(() => 'brandthread://redirect'),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary: '#ffffff',
    primaryForeground: '#000000',
    accent: '#222222',
  }),
}));

vi.mock('@/components/KeyboardAwareScrollViewCompat', () => {
  const React = require('react');
  return {
    KeyboardAwareScrollViewCompat: (props: Record<string, unknown>) =>
      React.createElement('KeyboardAwareScrollViewCompat', props, props.children as React.ReactNode),
  };
});

vi.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  return {
    default: (props: Record<string, unknown>) => React.createElement('QRCode', props),
  };
});

import LoginMethods from '@/app/login-methods';

type ExternalAccount = {
  id: string;
  provider: Provider;
  emailAddress: string;
  destroy: ReturnType<typeof vi.fn>;
};

type TestUser = {
  externalAccounts: ExternalAccount[];
  passwordEnabled: boolean;
  primaryEmailAddress: { emailAddress: string } | null;
  twoFactorEnabled: boolean;
  reload: ReturnType<typeof vi.fn>;
  updatePassword: ReturnType<typeof vi.fn>;
  createExternalAccount: ReturnType<typeof vi.fn>;
};

let currentUser: TestUser;
let rerenderUser: (() => void) | undefined;

function makeExternalAccount(provider: Provider): ExternalAccount {
  return {
    id: `${provider}-account`,
    provider,
    emailAddress: `${provider}@example.com`,
    destroy: vi.fn(() => {
      currentUser.externalAccounts = currentUser.externalAccounts.filter(
        (account) => account.id !== `${provider}-account`,
      );
    }),
  };
}

function makeUser(accounts: ExternalAccount[] = []): TestUser {
  return {
    externalAccounts: accounts,
    passwordEnabled: false,
    primaryEmailAddress: null,
    twoFactorEnabled: false,
    reload: vi.fn(async () => {
      rerenderUser?.();
    }),
    updatePassword: vi.fn(async () => {
      currentUser.passwordEnabled = true;
    }),
    createExternalAccount: vi.fn(),
  };
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<LoginMethods />);
    await Promise.resolve();
  });
  return renderer;
}

function lastAlertButtons(): AlertButton[] {
  const buttons = alertMock.mock.lastCall?.[2];
  return Array.isArray(buttons) ? buttons : [];
}

async function confirmRemoval(provider: Provider) {
  const removeButton = rendererForTest.root.findByProps({
    testID: `remove-${provider}-login-method`,
  });
  await act(async () => {
    removeButton.props.onPress();
    await Promise.resolve();
  });

  const removeConfirmation = lastAlertButtons().find((button) => button.text === 'Remove');
  expect(removeConfirmation?.onPress).toBeTypeOf('function');
  await act(async () => {
    await removeConfirmation?.onPress?.();
  });
}

let rendererForTest!: ReactTestRenderer;

describe('LoginMethods linked-account removal', () => {
  beforeEach(() => {
    alertMock.mockReset();
    useUserMock.mockReset();
    routerBackMock.mockReset();
    routerPushMock.mockReset();
    rerenderUser = undefined;
    currentUser = makeUser();
    useUserMock.mockImplementation(() => {
      const [, setVersion] = React.useState(0);
      rerenderUser = () => setVersion((version) => version + 1);
      return { user: currentUser, isLoaded: true };
    });
  });

  afterEach(async () => {
    await act(async () => {
      rendererForTest?.unmount();
    });
  });

  it.each<Provider>(['google', 'apple'])(
    '%s removal requires explicit confirmation before destroying the account',
    async (provider) => {
      const account = makeExternalAccount(provider);
      currentUser = makeUser([account, makeExternalAccount(provider === 'google' ? 'apple' : 'google')]);
      rendererForTest = await renderScreen();

      await act(async () => {
        rendererForTest.root.findByProps({
          testID: `remove-${provider}-login-method`,
        }).props.onPress();
      });

      expect(account.destroy).not.toHaveBeenCalled();
      expect(alertMock).toHaveBeenCalledWith(
        `Remove ${provider === 'google' ? 'Google' : 'Apple'}?`,
        expect.stringContaining('no longer be able to sign in'),
        expect.any(Array),
      );
      expect(lastAlertButtons().map((button) => button.text)).toEqual(['Cancel', 'Remove']);
    },
  );

  it('blocks removal of the last login method and leaves the row connected', async () => {
    const account = makeExternalAccount('google');
    currentUser = makeUser([account]);
    rendererForTest = await renderScreen();

    await act(async () => {
      rendererForTest.root.findByProps({ testID: 'remove-google-login-method' }).props.onPress();
    });

    expect(account.destroy).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith(
      'Keep a login method',
      expect.stringContaining('only sign-in method'),
      [{ text: 'OK' }],
    );
    expect(rendererForTest.root.findByProps({ testID: 'remove-google-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findAllByProps({ testID: 'connect-google-login-method' })).toHaveLength(0);
  });

  it('reloads the user after successful removal and exposes Connect again', async () => {
    const account = makeExternalAccount('google');
    currentUser = makeUser([account, makeExternalAccount('apple')]);
    rendererForTest = await renderScreen();

    await confirmRemoval('google');

    expect(account.destroy).toHaveBeenCalledOnce();
    expect(currentUser.reload).toHaveBeenCalledOnce();
    expect(rendererForTest.root.findByProps({ testID: 'connect-google-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findAllByProps({ testID: 'remove-google-login-method' })).toHaveLength(0);
  });

  it('keeps the account connected and shows the Clerk error after removal fails', async () => {
    const account = makeExternalAccount('apple');
    account.destroy.mockRejectedValueOnce(new Error('Session expired. Sign in again and retry.'));
    currentUser = makeUser([account, makeExternalAccount('google')]);
    rendererForTest = await renderScreen();

    await confirmRemoval('apple');

    expect(currentUser.reload).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenLastCalledWith(
      'Removal failed',
      "Couldn't remove Apple. Try again.",
    );
    expect(rendererForTest.root.findByProps({ testID: 'remove-apple-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findAllByProps({ testID: 'connect-apple-login-method' })).toHaveLength(0);
  });

  it('lets buyers add a password, refreshes Clerk state, and keeps the social account removable', async () => {
    const account = makeExternalAccount('google');
    currentUser = makeUser([account]);
    rendererForTest = await renderScreen();

    await act(async () => {
      rendererForTest.root.findByProps({ testID: 'setup-password-login-method' }).props.onPress();
    });

    await act(async () => {
      rendererForTest.root.findByProps({ testID: 'new-password-input' }).props.onChangeText('correct horse');
      rendererForTest.root.findByProps({ testID: 'confirm-password-input' }).props.onChangeText('correct horse');
    });
    await act(async () => {
      await rendererForTest.root.findByProps({ testID: 'save-password-button' }).props.onPress();
    });

    expect(currentUser.updatePassword).toHaveBeenCalledWith({ newPassword: 'correct horse' });
    expect(currentUser.reload).toHaveBeenCalledOnce();
    expect(rendererForTest.root.findByProps({ testID: 'remove-google-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findAllByProps({ testID: 'setup-password-login-method' })).toHaveLength(0);
  });

  it('keeps password setup errors visible and does not refresh or change the account', async () => {
    const account = makeExternalAccount('apple');
    currentUser = makeUser([account]);
    currentUser.updatePassword.mockRejectedValueOnce(new Error('Password was rejected by Clerk.'));
    rendererForTest = await renderScreen();

    await act(async () => {
      rendererForTest.root.findByProps({ testID: 'setup-password-login-method' }).props.onPress();
      rendererForTest.root.findByProps({ testID: 'new-password-input' }).props.onChangeText('correct horse');
      rendererForTest.root.findByProps({ testID: 'confirm-password-input' }).props.onChangeText('correct horse');
    });
    await act(async () => {
      await rendererForTest.root.findByProps({ testID: 'save-password-button' }).props.onPress();
    });

    expect(currentUser.updatePassword).toHaveBeenCalledOnce();
    expect(currentUser.reload).not.toHaveBeenCalled();
    expect(rendererForTest.root.findByProps({ testID: 'setup-password-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findByProps({ testID: 'password-setup-error' }).props.children)
      .toBe("Couldn't add your password. Try again.");
  });
});
