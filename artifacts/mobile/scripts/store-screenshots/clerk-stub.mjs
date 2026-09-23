/**
 * A stand-in for Clerk's browser SDK, injected before the app loads.
 *
 * The screenshot build uses a fake publishable key, so the real Clerk script
 * is never downloaded. @clerk/react finds `window.Clerk` already present,
 * "loads" it, and from then on the app sees a signed-in demo account:
 * `useAuth()` reports a user ID and `getToken()` returns a placeholder token
 * that only the screenshot script's fake API ever receives. No real account,
 * network call or credential is involved.
 */
export function clerkStubScript(user) {
  return `(() => {
  const user = ${JSON.stringify(user)};
  const now = new Date();
  const email = { id: 'idn_demo', emailAddress: user.email, verification: { status: 'verified' } };
  const clerkUser = {
    ...user,
    fullName: user.firstName + ' ' + user.lastName,
    username: user.username,
    imageUrl: user.imageUrl,
    hasImage: true,
    primaryEmailAddress: email,
    primaryEmailAddressId: email.id,
    emailAddresses: [email],
    phoneNumbers: [],
    externalAccounts: [],
    passkeys: [],
    organizationMemberships: [],
    publicMetadata: {},
    unsafeMetadata: {},
    createdAt: now,
    updatedAt: now,
    twoFactorEnabled: false,
    reload: async () => clerkUser,
    update: async () => clerkUser,
    getSessions: async () => [],
  };
  const session = {
    id: 'sess_demo',
    status: 'active',
    user: clerkUser,
    actor: null,
    factorVerificationAge: [0, 0],
    lastActiveToken: { jwt: { claims: { sub: user.id, sid: 'sess_demo' } }, getRawString: () => 'demo-token' },
    getToken: async () => 'demo-token',
    touch: async () => session,
    end: async () => undefined,
    remove: async () => undefined,
  };
  const client = { id: 'client_demo', sessions: [session], activeSessions: [session], lastActiveSessionId: session.id, signIn: {}, signUp: {} };
  const listeners = new Set();
  const noop = () => undefined;
  const target = {
    loaded: false,
    version: '0.0.0-screenshots',
    sdkMetadata: { name: 'screenshots', version: '0.0.0' },
    instanceType: 'development',
    frontendApi: 'clerk.brandthread.test',
    publishableKey: '',
    isSatellite: false,
    isStandardBrowser: true,
    session,
    user: clerkUser,
    client,
    organization: null,
    // Must stay undefined: @clerk/react then marks itself "ready" once load() resolves.
    status: undefined,
    telemetry: { record: noop },
    async load() { this.loaded = true; },
    addListener(listener) {
      listeners.add(listener);
      listener({ client, session, user: clerkUser, organization: null });
      return () => listeners.delete(listener);
    },
    // getToken() waits for a "ready" status event before returning a token.
    on(event, handler) { if (event === 'status') handler('ready'); },
    off: noop,
    setActive: async () => undefined,
    signOut: async () => undefined,
    handleRedirectCallback: async () => undefined,
    navigate: async () => undefined,
    buildUrlWithAuth: (url) => url,
  };
  // Any Clerk UI method the app might call (openSignIn, mountUserButton, …) is a no-op.
  window.Clerk = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      return noop;
    },
  });
  window.__internal_ClerkUICtor = function ClerkUIStub() {};
})();`;
}
