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
  isAccountStep,
  isStepId,
  restoreDraftStepId,
  type AuthMethod,
  type Flow,
  type StepId,
} from './onboardingFlow';

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
}

const SECRET_KEYS = ['password', 'confirmPassword', 'code', 'verificationCode'];

/** What actually goes to storage: no secrets, and no birthday once the account exists. */
export function sanitizeDraftForStorage(draft: OnboardingDraft): OnboardingDraft {
  const clean: Record<string, unknown> = { ...draft, version: DRAFT_VERSION };
  for (const key of SECRET_KEYS) delete clean[key];
  if (draft.accountCreated) clean.dob = null;
  return clean as unknown as OnboardingDraft;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Parse a stored draft (any version) into the v9 shape, or null if unusable. */
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
    stepId: restoreDraftStepId(flow, data),
    authMethod,
    // Drafts older than v9 were only ever written for signed-in accounts.
    accountCreated: data.version === DRAFT_VERSION ? data.accountCreated === true : true,
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
  if (!isStepId(stepId)) return 'ACCOUNT_TYPE';
  if (ctx.accountReady) return isAccountStep(stepId) ? 'NAME' : stepId;
  if (!isAccountStep(stepId)) {
    // Profile steps need an account; without a session, start the account steps again.
    if (['WELCOME', 'ACCOUNT_TYPE', 'STAGE', 'GOALS', 'LOCATION'].includes(stepId)) return stepId;
    return 'EMAIL';
  }
  if (draft.authMethod !== 'email') {
    // Apple/Google: nothing secret was typed; the birthday must exist before terms.
    if (stepId === 'TERMS' && !draft.dob) return 'BIRTHDAY';
    return stepId === 'CODE' || stepId === 'PASSWORD' ? 'BIRTHDAY' : stepId;
  }
  if (stepId === 'EMAIL') return 'EMAIL';
  if (!ctx.signUpPending || !draft.email) return 'EMAIL';
  if (!ctx.emailVerified) return 'CODE';
  // The password was never stored, so anything after it starts at PASSWORD.
  return 'PASSWORD';
}
