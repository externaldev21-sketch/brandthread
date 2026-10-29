/**
 * Onboarding resume (draft) rules, kept free of React Native so they can be
 * unit-tested. app/onboarding.tsx saves a draft after every change and, when
 * the app is reopened mid-onboarding, uses `resolveResumeStep` to land the
 * person back on the same screen with what they typed.
 *
 * Never stored: the password and the email code. A step that needs them is
 * resumed one step earlier so they can be entered again.
 *
 * Two storage keys:
 *  - PENDING_DRAFT_KEY (device-scoped) before an account exists — the person
 *    is signed out, so there is no user id to key on. Cleared on sign-out by
 *    app/_layout.tsx so a half-finished attempt never leaks to the next person.
 *  - `onboarding_draft:<clerkUserId>` once the account exists.
 */
import {
  DRAFT_VERSION,
  AUTH_STEPS,
  FIRST_PROFILE_STEP,
  isAuthStep,
  profileStepsFor,
  restoreDraftStep,
  type Flow,
  type StepId,
} from './onboardingFlow';

type AuthMethod = 'email' | 'apple' | 'google';
function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && [...AUTH_STEPS, ...profileStepsFor('seller').map(s => s.id)].includes(value as StepId);
}

export const PENDING_DRAFT_KEY = 'onboarding_pending_draft';
export const USER_DRAFT_KEY_PREFIX = 'onboarding_draft:';

export function userDraftKey(userId: string | null | undefined): string | null {
  return userId ? `${USER_DRAFT_KEY_PREFIX}${userId}` : null;
}

export interface OnboardingDraft {
  version: number;
  flow: Flow;
  stepId: StepId;
  authMethod: AuthMethod;
  /** Set right before the account is finalized; the pending draft then belongs to the new account. */
  accountCreated: boolean;
  /** Clerk id of the account this draft belongs to (null before it exists). */
  ownerId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  /** YYYY-MM-DD; only kept until the account exists and the age band is sent. */
  dob: string | null;
  referralCode: string;
  photoUri: string | null;
  styleInterests: string[];
  survey: unknown;
  brandName: string;
  brandStage: string;
  goals: string[];
  country: string;
  selectedThemeId: string;
  selectedAccent?: string;
}

const SECRET_KEYS = ['password', 'confirmPassword', 'code', 'verificationCode'];

/** No credentials. The birthday survives Clerk's redirect only until /auth/age succeeds. */
export function sanitizeDraftForStorage(draft: OnboardingDraft): OnboardingDraft {
  const clean: Record<string, unknown> = { ...draft, version: DRAFT_VERSION };
  for (const key of SECRET_KEYS) delete clean[key];
  return clean as unknown as OnboardingDraft;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Preserve owned answers, but restart incompatible step layouts. */
export function parseDraft(raw: string | null | undefined): OnboardingDraft | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const flow = data.flow === 'buyer' || data.flow === 'seller' ? data.flow : null;
  if (!flow) return null;
  const authMethod: AuthMethod = data.authMethod === 'apple' || data.authMethod === 'google' ? data.authMethod : 'email';
  return {
    version: DRAFT_VERSION,
    flow,
    stepId: data.version === DRAFT_VERSION && isStepId(data.stepId ?? data.step)
      ? (data.stepId ?? data.step) as StepId
      : restoreDraftStep({ version: data.version, step: data.stepId ?? data.step }, !!data.ownerId || data.accountCreated === true),
    authMethod,
    // Drafts older than v9 were only ever written for signed-in accounts.
    accountCreated: data.accountCreated === true || (data.version !== DRAFT_VERSION && typeof data.ownerId === 'string'),
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : null,
    email: str(data.email),
    firstName: str(data.firstName),
    lastName: str(data.lastName),
    username: str(data.username),
    dob: typeof data.dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.dob) ? data.dob : null,
    referralCode: str(data.referralCode),
    photoUri: typeof data.photoUri === 'string' ? data.photoUri : null,
    styleInterests: Array.isArray(data.styleInterests) ? data.styleInterests.filter((v): v is string => typeof v === 'string') : [],
    survey: data.survey,
    brandName: str(data.brandName),
    brandStage: str(data.brandStage),
    goals: Array.isArray(data.goals) ? data.goals.filter((v): v is string => typeof v === 'string') : [],
    country: str(data.country),
    selectedThemeId: str(data.selectedThemeId, 'monochrome'),
  };
}

export interface ResumeContext {
  /** A session exists for the account being onboarded. */
  accountReady: boolean;
  /** Clerk still holds the in-progress sign-up for this email (a code can be verified). */
  signUpPending: boolean;
  /** The email code was already verified for the in-progress sign-up. */
  emailVerified: boolean;
}

/**
 * The screen to reopen on. Moves back only as far as needed to re-enter
 * something that was deliberately not stored (password, code).
 */
export function resolveResumeStep(draft: Pick<OnboardingDraft, 'stepId' | 'authMethod' | 'dob' | 'email'>, ctx: ResumeContext): StepId {
  const { stepId } = draft;
  if (!isStepId(stepId)) return ctx.accountReady ? FIRST_PROFILE_STEP : 'WELCOME';
  if (ctx.accountReady) return isAuthStep(stepId) ? FIRST_PROFILE_STEP : stepId;
  if (stepId === 'WELCOME' || stepId === 'BIRTHDAY') return stepId;
  if (!draft.dob) return 'BIRTHDAY';
  if (!isAuthStep(stepId)) return 'EMAIL';
  if (draft.authMethod !== 'email') {
    return stepId === 'DETAILS' && ctx.signUpPending ? 'DETAILS' : 'WELCOME';
  }
  if (stepId === 'EMAIL') return 'EMAIL';
  if (!ctx.signUpPending || !draft.email) return 'EMAIL';
  if (!ctx.emailVerified) return 'CODE';
  // Any instance-required password/name is entered again, never restored.
  return 'DETAILS';
}

// ─── Before the account exists (launch flow) ────────────────────────────────

/**
 * What app/onboarding.tsx keeps under PENDING_DRAFT_KEY while the person is
 * still signed out, so a web reload (or the OS dropping the tab while they
 * fetch the code) never asks for the birthday, email or name again. The
 * buyer/seller choice is made after sign-in, so there is no `flow` yet.
 */
export interface PendingSignUpDraft {
  version: number;
  stepId: StepId;
  authMethod: AuthMethod;
  /** Lower-cased; also binds the birthday to the account it was typed for. */
  email: string;
  codeMode: 'signup' | 'signin';
  firstName: string;
  lastName: string;
  /** MM/DD/YYYY exactly as typed; dropped once /auth/age succeeds. */
  dobInput: string;
  savedAt: number;
}

export function parsePendingSignUp(raw: string | null | undefined): PendingSignUpDraft | null {
  if (!raw) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object' || data.version !== DRAFT_VERSION) return null;
  if (!isStepId(data.stepId) || !isAuthStep(data.stepId)) return null;
  return {
    version: DRAFT_VERSION,
    stepId: data.stepId,
    authMethod: data.authMethod === 'apple' || data.authMethod === 'google' ? data.authMethod : 'email',
    email: str(data.email).trim().toLowerCase(),
    codeMode: data.codeMode === 'signin' ? 'signin' : 'signup',
    firstName: str(data.firstName),
    lastName: str(data.lastName),
    dobInput: /^\d{2}\/\d{2}\/\d{4}$/.test(str(data.dobInput)) ? str(data.dobInput) : '',
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
  };
}

/**
 * A signed-out draft is only resumed for a while: long enough to fetch a code
 * or come back the same day, not long enough to greet the next person on a
 * shared device with someone else's email and birthday.
 */
export const PENDING_SIGNED_OUT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isPendingDraftFresh(draft: PendingSignUpDraft, now = Date.now()): boolean {
  return now - draft.savedAt >= 0 && now - draft.savedAt < PENDING_SIGNED_OUT_MAX_AGE_MS;
}

/** SSO drafts carry no email to match, so they only count right after the redirect. */
export const PENDING_SSO_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Whether a signed-out draft belongs to the account that is now signed in:
 * same email, or an Apple/Google sign-up that just came back. A different
 * person's half-finished attempt on a shared device never carries over.
 */
export function pendingDraftBelongsTo(draft: PendingSignUpDraft, signedInEmail: string | null | undefined, now = Date.now()): boolean {
  const email = (signedInEmail ?? '').trim().toLowerCase();
  if (draft.authMethod === 'email') return !!email && draft.email === email;
  return now - draft.savedAt >= 0 && now - draft.savedAt < PENDING_SSO_MAX_AGE_MS;
}
