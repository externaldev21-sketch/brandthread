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
  // Newer @clerk/expo hooks (useSignIn()/useSignUp()) read their state via
  // useSyncExternalStore from Clerk.__internal_state's signInSignal/
  // signUpSignal (alien-signals), not from client.signIn/signUp directly.
  // Without these, mounting /sign-in, /onboarding or /account-type (which
  // render even for this stub's already-signed-in demo session) throws
  // "t.__internal_state.signUpSignal is not a function" and trips the app's
  // error boundary. Static empty snapshots are enough: this stub never
  // drives a real sign-in/sign-up flow, it only needs the hooks to mount.
  const STATIC_EMPTY_ERRORS = Object.freeze({ fields: Object.freeze({}), raw: null, global: null });
  const STATIC_SIGN_IN_SNAPSHOT = Object.freeze({ errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', signIn: null });
  const STATIC_SIGN_UP_SNAPSHOT = Object.freeze({ errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', signUp: null });
  const STATIC_WAITLIST_SNAPSHOT = Object.freeze({ errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', waitlist: null });
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
    // useAuth()/useUser()/useSession() read the signed-in state from here.
    __internal_lastEmittedResources: { client, session, user: clerkUser, organization: null },
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
    __internal_state: {
      signInSignal: () => STATIC_SIGN_IN_SNAPSHOT,
      signUpSignal: () => STATIC_SIGN_UP_SNAPSHOT,
      waitlistSignal: () => STATIC_WAITLIST_SNAPSHOT,
      // Minimal stand-in for alien-signals' effect(): run fn once to
      // establish "interest", never re-run it (this stub's snapshots never
      // change, so there's nothing to notify).
      __internal_effect(fn) { fn(); return noop; },
      __internal_computed(getter) { const value = getter(); return () => value; },
      __internal_waitlist: {},
    },
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
