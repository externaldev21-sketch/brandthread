import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'google' | 'apple';
type AlertButton = {
  text?: string;
  onPress?: () => void | Promise<void>;
};

const { alertMock, useUserMock, routerBackMock } = vi.hoisted(() => ({
  alertMock: vi.fn(),
  useUserMock: vi.fn(),
  routerBackMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
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
    Platform: { OS: 'ios' },
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: routerBackMock }),
}));

vi.mock('@clerk/expo', () => ({
  useUser: useUserMock,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
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

import LoginMethods from './login-methods';

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
  createExternalAccount: ReturnType<typeof vi.fn>;
};

let currentUser: TestUser;
let rerenderUser: (() => void) | undefined;

function makeExternalAccount(provider: Provider): ExternalAccount {
  return {
    id: `${provider}-account`,
    provider,
    emailAddress: `${provider}@example.com`,
    destroy: vi.fn(),
  };
}

function makeUser(accounts: ExternalAccount[] = []): TestUser {
  return {
    externalAccounts: accounts,
    passwordEnabled: false,
    primaryEmailAddress: null,
    twoFactorEnabled: false,
    reload: vi.fn(async () => {
      currentUser.externalAccounts = [];
      rerenderUser?.();
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
      'Could not remove Apple',
      'Session expired. Sign in again and retry.',
    );
    expect(rendererForTest.root.findByProps({ testID: 'remove-apple-login-method' })).toBeTruthy();
    expect(rendererForTest.root.findAllByProps({ testID: 'connect-apple-login-method' })).toHaveLength(0);
  });
});