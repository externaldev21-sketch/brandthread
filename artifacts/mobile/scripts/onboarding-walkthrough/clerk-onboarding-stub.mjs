/**
 * A stand-in for Clerk's browser SDK that starts SIGNED OUT and implements
 * enough of the real sign-up surface for the onboarding screen to drive an
 * actual (fake, in-memory) account creation — unlike
 * scripts/store-screenshots/clerk-stub.mjs, which simulates an
 * already-signed-in account for screenshots.
 *
 * app/onboarding.tsx drives sign-up through @clerk/react's newer
 * *signal-based* `useSignUp()` (a `SignUpFutureResource`, reached through
 * `window.Clerk.__internal_state.signUpSignal()` / `__internal_effect`), so
 * this stub implements that surface:
 *   - signUp.password({ emailAddress, password })
 *   - signUp.verifications.sendEmailCode() / verifyEmailCode({ code })
 *   - signUp.finalize({ navigate })
 *   - signUp.status
 *
 * `useAuth()` / `useUser()` keep using the classic
 * `client` / `session` / `user` + `addListener` /
 * `__internal_lastEmittedResources` surface, the same one clerk-stub.mjs
 * relies on.
 *
 * Any 6-digit code is accepted once a code has been "sent"
 * (`sendEmailCode()`), defaulting to '000000'. No real Clerk network call is
 * ever made — everything lives in memory in the page.
 */
export function clerkOnboardingStubScript() {
  return `(() => {
  const genId = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10);
  const usedEmails = new Set();

  // ── "backend" state for the in-flight sign-up attempt ──────────────────────
  function freshSignUpState() {
    return {
      id: null,
      status: 'missing_requirements',
      emailAddress: null,
      username: null,
      firstName: null,
      lastName: null,
      hasPassword: false,
      createdSessionId: null,
      createdUserId: null,
      pendingCode: null,
      pendingProfile: null,
    };
  }
  let signUpState = freshSignUpState();

  let session = null;
  let user = null;
  const client = { id: 'client_stub', sessions: [], activeSessions: [], lastActiveSessionId: null, signIn: {}, signUp: {} };

  // A signed-up "session" is persisted to localStorage (this build's origin
  // is exclusive to this walkthrough run) so it survives the full-page
  // reload finalize() below performs — mirroring how real Clerk restores a
  // session from a token cache on load. Without this, the stub would reset
  // to signed-out on every reload and the onboarding screen would never get
  // past email verification.
  const SESSION_KEY = 'bt:onboarding-walkthrough-stub-session:v1';
  function persistSession(profile) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(profile)); } catch {}
  }
  function clearPersistedSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }
  function restorePersistedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const profile = JSON.parse(raw);
      usedEmails.add(profile.email);
      user = makeUser(profile);
      session = makeSession(user);
      client.sessions = [session];
      client.activeSessions = [session];
      client.lastActiveSessionId = session.id;
    } catch {}
  }

  const authListeners = new Set();
  const signUpListeners = new Set();
  function notifyAuth() {
    const payload = { client, session, user, organization: null };
    authListeners.forEach((fn) => { try { fn(payload); } catch {} });
  }
  function notifySignUp() {
    signUpSnapshot = { errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', signUp: signUpResource };
    signUpListeners.forEach((fn) => { try { fn(); } catch {} });
  }

  function fakeError(code, message) {
    return { code, message, longMessage: message, clerkError: true, errors: [{ code, message, longMessage: message }] };
  }

  function makeUser(profile) {
    const now = new Date();
    const email = { id: 'idn_' + profile.id, emailAddress: profile.email, verification: { status: 'verified' } };
    const u = {
      id: profile.id,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
      username: profile.username || null,
      imageUrl: '',
      hasImage: false,
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
      reload: async () => u,
      update: async () => u,
      getSessions: async () => [],
    };
    return u;
  }

  function makeSession(u) {
    const s = {
      id: genId('sess'),
      status: 'active',
      user: u,
      actor: null,
      factorVerificationAge: [0, 0],
      // Encodes the signed-in Clerk user id into the bearer token so the
      // fake API (fake-api.mjs's installFakeBackend) can read it back out of
      // the Authorization header and use the SAME id as the fake DB row's
      // clerkId — exactly what a real backend derives by verifying the JWT.
      // Without this, the fake API would mint its own unrelated id, and
      // screens that compare "who's signed in" against "whose onboarding
      // record is this" (e.g. app/thread-explainer.tsx) would treat the
      // account as belonging to someone else and bounce back to onboarding.
      lastActiveToken: { jwt: { claims: { sub: u.id, sid: 'sess_stub' } }, getRawString: () => 'stub-token.' + u.id },
      getToken: async () => 'stub-token.' + u.id,
      touch: async () => s,
      end: async () => undefined,
      remove: async () => undefined,
    };
    return s;
  }

  // ── SignUpFutureResource-shaped object (see @clerk/shared/types state.d.ts) ─
  const signUpResource = {
    get id() { return signUpState.id; },
    get status() { return signUpState.status; },
    get username() { return signUpState.username; },
    get firstName() { return signUpState.firstName; },
    get lastName() { return signUpState.lastName; },
    get emailAddress() { return signUpState.emailAddress; },
    get phoneNumber() { return null; },
    get web3Wallet() { return null; },
    get hasPassword() { return signUpState.hasPassword; },
    get createdSessionId() { return signUpState.createdSessionId; },
    get createdUserId() { return signUpState.createdUserId; },
    get isTransferable() { return false; },
    get existingSession() { return undefined; },
    requiredFields: [],
    optionalFields: [],
    missingFields: [],
    unverifiedFields: [],
    unsafeMetadata: {},
    abandonAt: null,
    legalAcceptedAt: null,
    locale: null,
    protectCheck: null,
    canBeDiscarded: false,

    async create(params) { return signUpResource.password(params); },
    async update(params) {
      if (params?.username != null) signUpState.username = params.username;
      if (params?.firstName != null) signUpState.firstName = params.firstName;
      if (params?.lastName != null) signUpState.lastName = params.lastName;
      notifySignUp();
      return { error: null };
    },
    async password(params) {
      const emailAddress = (params?.emailAddress || '').trim().toLowerCase();
      if (usedEmails.has(emailAddress)) {
        return { error: fakeError('form_identifier_exists', 'That email address is taken. Please try another.') };
      }
      signUpState = {
        ...freshSignUpState(),
        emailAddress,
        hasPassword: true,
        username: params?.username ?? signUpState.username,
        firstName: params?.firstName ?? signUpState.firstName,
        lastName: params?.lastName ?? signUpState.lastName,
      };
      notifySignUp();
      return { error: null };
    },
    verifications: {
      get emailAddress() { return { status: signUpState.status === 'complete' ? 'verified' : 'unverified' }; },
      phoneNumber: { status: 'unverified' },
      web3Wallet: { status: 'unverified' },
      externalAccount: { status: 'unverified' },
      emailLinkVerification: null,
      async sendEmailCode() {
        signUpState.pendingCode = '000000';
        notifySignUp();
        return { error: null };
      },
      async verifyEmailCode({ code }) {
        const expected = signUpState.pendingCode || '000000';
        if (!signUpState.emailAddress) {
          return { error: fakeError('form_identifier_not_found', 'Start a sign-up before verifying a code.') };
        }
        if (code !== expected) {
          return { error: fakeError('form_code_incorrect', 'Invalid code. Please check and try again.') };
        }
        signUpState.id = signUpState.id || genId('su');
        signUpState.status = 'complete';
        signUpState.pendingProfile = {
          id: genId('user'),
          firstName: signUpState.firstName || '',
          lastName: signUpState.lastName || '',
          username: signUpState.username || '',
          email: signUpState.emailAddress,
        };
        notifySignUp();
        return { error: null };
      },
      async sendEmailLink() { return { error: null }; },
      async waitForEmailLinkVerification() { return { error: null }; },
      async sendPhoneCode() { return { error: null }; },
      async verifyPhoneCode() { return { error: null }; },
    },
    async sso() { return { error: fakeError('not_supported', 'SSO sign-up is not available in this preview build.') }; },
    async ticket() { return { error: fakeError('not_supported', 'Not supported in this preview build.') }; },
    async web3() { return { error: fakeError('not_supported', 'Not supported in this preview build.') }; },
    async submitProtectCheck() { return { error: null }; },
    async finalize(params) {
      const navigate = params?.navigate;
      if (signUpState.status !== 'complete' || !signUpState.pendingProfile) {
        return { error: fakeError('sign_up_not_complete', 'This sign-up is not ready to finalize yet.') };
      }
      const profile = signUpState.pendingProfile;
      usedEmails.add(profile.email);
      user = makeUser(profile);
      session = makeSession(user);
      client.sessions = [session];
      client.activeSessions = [session];
      client.lastActiveSessionId = session.id;
      signUpState.createdSessionId = session.id;
      signUpState.createdUserId = user.id;
      target.session = session;
      target.user = user;
      target.client = client;
      target.__internal_lastEmittedResources = { client, session, user, organization: null };
      persistSession(profile);
      notifyAuth();
      if (typeof navigate === 'function') {
        // Absolutizing the URL (as real Clerk's decorateUrl does for
        // cross-domain ITP cookie refresh) makes the app take its
        // window.location.href = url branch instead of a client-side
        // router.replace — a real full navigation, exactly like the
        // production redirect after email verification. This build's own
        // expo-router + query-string combination does not reliably preserve
        // state across a same-route client-side replace, so this also
        // sidesteps that rather than trying to out-guess it.
        await navigate({ decorateUrl: (url) => new URL(url, location.origin).toString() });
      }
      return { error: null };
    },
    async reset() {
      signUpState = freshSignUpState();
      notifySignUp();
      return { error: null };
    },
  };

  // A single stable object, reused forever: useSyncExternalStore compares
  // snapshots by reference, so returning a fresh {fields:{...}} literal from
  // every signUpSignal() call (even with unchanged content) makes React think
  // the store changes on every render and spin into "Maximum update depth
  // exceeded". Errors are never surfaced by this stub (methods return their
  // error directly), so one frozen object for the whole run is enough.
  const STATIC_EMPTY_ERRORS = Object.freeze({
    fields: Object.freeze({
      firstName: null, lastName: null, emailAddress: null, phoneNumber: null,
      password: null, username: null, code: null, captcha: null, legalAccepted: null,
    }),
    raw: null,
    global: null,
  });

  // Same reference-stability requirement for the signal *value* itself: only
  // build a new snapshot object when the sign-up state actually changes
  // (inside notifySignUp), never on every read.
  let signUpSnapshot = { errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', signUp: signUpResource };
  const STATIC_SIGN_IN_SNAPSHOT = { errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', signIn: null };
  const STATIC_WAITLIST_SNAPSHOT = { errors: STATIC_EMPTY_ERRORS, fetchStatus: 'idle', waitlist: null };

  // Restore a session persisted by a previous load (see persistSession()
  // above) before window.Clerk is built, so a full-page navigation to
  // /onboarding after email verification lands here already signed in.
  restorePersistedSession();

  // ── window.Clerk ─────────────────────────────────────────────────────────
  const noop = () => undefined;
  const target = {
    loaded: false,
    version: '0.0.0-onboarding-walkthrough',
    sdkMetadata: { name: 'onboarding-walkthrough', version: '0.0.0' },
    instanceType: 'development',
    frontendApi: 'clerk.brandthread.test',
    publishableKey: '',
    isSatellite: false,
    isStandardBrowser: true,
    session,
    user,
    client,
    organization: null,
    __internal_lastEmittedResources: { client, session, user, organization: null },
    // Must stay undefined: @clerk/react then marks itself "ready" once load() resolves.
    status: undefined,
    telemetry: { record: noop },
    async load() { this.loaded = true; },
    addListener(listener) {
      authListeners.add(listener);
      listener({ client, session, user, organization: null });
      return () => authListeners.delete(listener);
    },
    // getToken() waits for a "ready" status event before returning a token.
    on(event, handler) { if (event === 'status') handler('ready'); },
    off: noop,
    async setActive({ session: sessionOrId } = {}) {
      // Used by OAuth flows this stub does not drive; kept as a safe no-op.
      return undefined;
    },
    async signOut() {
      user = null;
      session = null;
      client.sessions = [];
      client.activeSessions = [];
      client.lastActiveSessionId = null;
      signUpState = freshSignUpState();
      clearPersistedSession();
      target.session = null;
      target.user = null;
      target.__internal_lastEmittedResources = { client, session: null, user: null, organization: null };
      notifyAuth();
      notifySignUp();
    },
    handleRedirectCallback: async () => undefined,
    navigate: async () => undefined,
    buildUrlWithAuth: (url) => url,
    __internal_state: {
      signInSignal: () => STATIC_SIGN_IN_SNAPSHOT,
      signUpSignal: () => signUpSnapshot,
      waitlistSignal: () => STATIC_WAITLIST_SNAPSHOT,
      // Minimal stand-in for alien-signals' effect(): run fn immediately (so
      // it reads the current signal and establishes "interest"), then re-run
      // it on every mutation. useClerkSignal() only uses the re-run to tell
      // React to re-pull a fresh snapshot via useSyncExternalStore.
      __internal_effect(fn) {
        fn();
        signUpListeners.add(fn);
        return () => signUpListeners.delete(fn);
      },
      __internal_computed(getter) {
        let value = getter();
        return () => value;
      },
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
