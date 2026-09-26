/**
 * Fake-but-signed-in Clerk stub for Playwright specs against the dev-web
 * preview (see brandthread-agent.spec.ts's original header comment for the
 * full rationale — screens that gate data loading on Clerk's `userId` never
 * reach the `?bt_preview` seeded-data fallback without this). No real Clerk
 * account, network call, or credential is involved.
 */
export function clerkStubScript(): string {
  const user = {
    id: 'user_preview_verify',
    firstName: 'Preview',
    lastName: 'Verify',
    username: 'previewverify',
    email: 'preview-verify@example.com',
    imageUrl: '',
  };
  return `(() => {
  const user = ${JSON.stringify(user)};
  const now = new Date();
  const email = { id: 'idn_demo', emailAddress: user.email, verification: { status: 'verified' } };
  const clerkUser = {
    ...user,
    fullName: user.firstName + ' ' + user.lastName,
    username: user.username,
    imageUrl: user.imageUrl,
    hasImage: false,
    primaryEmailAddress: email,
    primaryEmailAddressId: email.id,
    emailAddresses: [email],
    phoneNumbers: [], externalAccounts: [], passkeys: [], organizationMemberships: [],
    publicMetadata: {}, unsafeMetadata: {}, createdAt: now, updatedAt: now, twoFactorEnabled: false,
    reload: async () => clerkUser, update: async () => clerkUser, getSessions: async () => [],
  };
  const session = {
    id: 'sess_demo', status: 'active', user: clerkUser, actor: null, factorVerificationAge: [0, 0],
    lastActiveToken: { jwt: { claims: { sub: user.id, sid: 'sess_demo' } }, getRawString: () => 'demo-token' },
    getToken: async () => 'demo-token', touch: async () => session, end: async () => undefined, remove: async () => undefined,
  };
  const client = { id: 'client_demo', sessions: [session], activeSessions: [session], lastActiveSessionId: session.id, signIn: {}, signUp: {} };
  const listeners = new Set();
  const noop = () => undefined;
  const target = {
    loaded: false, version: '0.0.0-verify', sdkMetadata: { name: 'verify', version: '0.0.0' },
    instanceType: 'development', frontendApi: 'clerk.brandthread.test', publishableKey: '',
    isSatellite: false, isStandardBrowser: true, session, user: clerkUser, client, organization: null,
    __internal_lastEmittedResources: { client, session, user: clerkUser, organization: null },
    status: undefined, telemetry: { record: noop },
    async load() { this.loaded = true; },
    addListener(listener) { listeners.add(listener); listener({ client, session, user: clerkUser, organization: null }); return () => listeners.delete(listener); },
    on(event, handler) { if (event === 'status') handler('ready'); },
    off: noop, setActive: async () => undefined, signOut: async () => undefined,
    handleRedirectCallback: async () => undefined, navigate: async () => undefined, buildUrlWithAuth: (url) => url,
  };
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
