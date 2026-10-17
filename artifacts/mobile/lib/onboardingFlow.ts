/**
 * Typed first-run step machine (v9, "launch onboarding").
 *
 * One flow for everyone, buyer-or-seller is asked last (like Depop, where you
 * start selling from an account you already have):
 *
 *   Before the account exists (no progress bar):
 *     WELCOME    TikTok "Sign up for TikTok": email / Apple / Google, Log in
 *     BIRTHDAY   TikTok "When's your birthday?" (age gate, kept in memory only)
 *     EMAIL      Depop "Sign up or login": one email field
 *     CODE       6-digit email code (Clerk email_code)
 *     DETAILS    Only when this Clerk instance requires more (password / name)
 *
 *   After (progress bar, Depop):
 *     USERNAME       Depop "Choose your username", live availability
 *     PHOTO     *    Instagram "Add a profile picture"
 *     INTEREST  *    Depop "Interest" (Menswear / Mens & Womenswear / Womenswear)
 *     BRANDS    *    Depop "Show these brands in search"
 *     SIZES     *    Depop "Sizes"
 *     NOTIFICATIONS* Cash App "Turn on notifications"
 *     ROLE           Etsy-style radio rows: Shop / Sell
 *     STORE          (sellers) Depop "Start selling" step: store name
 *     STAGE          (sellers) TikTok "Choose a category" radio list
 *   (* = skippable)
 *
 * Plain module, no React Native imports, so it is unit-testable.
 */

export type Flow = 'buyer' | 'seller';

export type StepId =
  | 'WELCOME'
  | 'BIRTHDAY'
  | 'EMAIL'
  | 'CODE'
  | 'DETAILS'
  | 'USERNAME'
  | 'PHOTO'
  | 'INTEREST'
  | 'BRANDS'
  | 'SIZES'
  | 'NOTIFICATIONS'
  | 'ROLE'
  | 'STORE'
  | 'STAGE';

export interface StepDef {
  id: StepId;
  /** Whether the user can advance past this step without completing it. */
  skippable: boolean;
}

/** Steps before a Clerk session exists. Order is decided by the auth method. */
export const AUTH_STEPS: readonly StepId[] = ['WELCOME', 'BIRTHDAY', 'EMAIL', 'CODE', 'DETAILS'];

const PROFILE_STEPS: StepDef[] = [
  { id: 'USERNAME', skippable: false },
  { id: 'PHOTO', skippable: true },
  { id: 'INTEREST', skippable: true },
  { id: 'BRANDS', skippable: true },
  { id: 'SIZES', skippable: true },
  { id: 'NOTIFICATIONS', skippable: true },
  { id: 'ROLE', skippable: false },
];

const SELLER_TAIL: StepDef[] = [
  { id: 'STORE', skippable: false },
  { id: 'STAGE', skippable: false },
];

/** The signed-in part of the flow for a given role choice (null = not chosen yet). */
export function profileStepsFor(role: Flow | null): StepDef[] {
  return role === 'seller' ? [...PROFILE_STEPS, ...SELLER_TAIL] : PROFILE_STEPS;
}

export function isAuthStep(id: StepId): boolean {
  return AUTH_STEPS.includes(id);
}

export function isStepSkippable(id: StepId): boolean {
  return [...PROFILE_STEPS, ...SELLER_TAIL].find((s) => s.id === id)?.skippable ?? false;
}

/** The first signed-in step. */
export const FIRST_PROFILE_STEP: StepId = 'USERNAME';

/** Next signed-in step, or null when the flow is finished. */
export function nextProfileStep(id: StepId, role: Flow | null): StepId | null {
  const steps = profileStepsFor(role);
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return FIRST_PROFILE_STEP;
  return steps[i + 1]?.id ?? null;
}

/** Previous signed-in step, or null on the first one (there is no going back into sign-up). */
export function prevProfileStep(id: StepId, role: Flow | null): StepId | null {
  const steps = profileStepsFor(role);
  const i = steps.findIndex((s) => s.id === id);
  return i > 0 ? steps[i - 1].id : null;
}

/**
 * Progress bar fill (0..1) for a signed-in step. The first step already shows
 * a sliver (Depop starts part-filled); the last step reads full.
 */
export function progressFor(id: StepId, role: Flow | null): number | undefined {
  const steps = profileStepsFor(role);
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  return (i + 1) / steps.length;
}

// ─── Draft persistence ──────────────────────────────────────────────────────

/**
 * v9 stores the step by id, not index, so future reorders don't need index
 * migration tables. Drafts from v8 and earlier used a different flow (role was
 * picked before sign-up) — their answers don't map onto these screens, so a
 * signed-in user resuming one starts again at Username.
 */
export const DRAFT_VERSION = 9;

export function restoreDraftStep(raw: { version?: unknown; step?: unknown } | null | undefined, signedIn: boolean): StepId {
  if (!signedIn) return 'WELCOME';
  if (raw && raw.version === DRAFT_VERSION && typeof raw.step === 'string') {
    const id = raw.step as StepId;
    if ([...PROFILE_STEPS, ...SELLER_TAIL].some((s) => s.id === id)) return id;
  }
  return FIRST_PROFILE_STEP;
}

// ─── Usernames ──────────────────────────────────────────────────────────────

export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/** Lowercase, spaces → underscores, drop anything else the server rejects. */
export function normalizeUsernameInput(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 30);
}

/** Inline format error for a typed username ('' when fine or empty). */
export function usernameFormatError(username: string): string {
  if (!username) return '';
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (!USERNAME_RE.test(username)) return 'Use letters, numbers and underscores only.';
  return '';
}

/**
 * Whatnot-style suggestions from what we already know (name, email). Pure and
 * deterministic; the screen only shows the ones the server confirms are free.
 */
export function usernameSuggestions(seed: { firstName?: string | null; lastName?: string | null; email?: string | null }, digits: string): string[] {
  const first = normalizeUsernameInput(seed.firstName ?? '').replace(/_/g, '');
  const last = normalizeUsernameInput(seed.lastName ?? '').replace(/_/g, '');
  const local = normalizeUsernameInput((seed.email ?? '').split('@')[0] ?? '');
  const raw = [
    first && last ? `${first}${last}` : '',
    first && last ? `${first}_${last}` : '',
    local,
    first && last ? `${first}${last}${digits}` : '',
    local ? `${local}${digits}` : '',
    first ? `${first}${digits}` : '',
  ];
  const out: string[] = [];
  for (const candidate of raw) {
    const c = candidate.slice(0, 30);
    if (USERNAME_RE.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
