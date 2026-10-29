/**
 * Account switch transition — the one pipeline every switch goes through
 * (the hold on the tab bar's Profile button and a tap on a row in the
 * Switch account sheet; contexts/QuickAccountSwitchContext.tsx runs it).
 *
 * The old switch faded a cover in, called Clerk's setActive, navigated and
 * faded the cover out one frame later. That frame came long before the new
 * account was actually on screen: the caches were still scoped to the old
 * account for a render, the old account's retained tab scenes re-rendered
 * with the new user (empty boxes), and the new shell's route code could
 * still be loading (a blank scene). Now the cover stays up until:
 *
 * 1. Clerk has activated the target account,
 * 2. every per-account cache has been re-scoped to it (lib/accountScope.ts,
 *    marked by app/_layout.tsx's ServiceConfigurer — that's also what
 *    re-keys the tab shells so the new account's screens mount fresh),
 * 3. the new account's home screen has painted its first content or its own
 *    loading skeleton (lib/perf.ts useScreenInteractive).
 *
 * The home route's code is loaded while the cover fades in, through the
 * same loader the background warmup uses (lib/navigation/routeWarmup.ts),
 * and the new shell's other tabs are then pre-mounted by its own
 * TabScenePreloader as on any first mount. A ceiling bounds the whole wait,
 * so a slow network only ever means the new screens show their own loading
 * states, never a stuck cover.
 *
 * Kept free of React so the sequencing is unit-tested directly
 * (tests/account-switch-transition.test.ts).
 */
export type AccountKind = 'buyer' | 'seller' | null;

export const SWITCH_COVER_IN_MS = 110;
export const SWITCH_COVER_OUT_MS = 220;
/** Longest the cover waits for the new account after Clerk activates it. */
export const SWITCH_READY_CEILING_MS = 4_000;

/** Where a switch lands. Unknown kind: "/" lets AuthGate route by the
 *  account's own stored role. */
export function switchHomeRoute(kind: AccountKind): string {
  return kind === 'seller' ? '/(tabs)/' : kind === 'buyer' ? '/(buyer)/' : '/';
}

/** The home screen's `useScreenInteractive` name (null: any screen). */
export function switchHomeScreen(kind: AccountKind): string | null {
  return kind === 'seller' ? 'seller-dashboard' : kind === 'buyer' ? 'feed' : null;
}

/** The home route's key in routeWarmup's loaders. */
export function switchHomeCode(kind: AccountKind): string | null {
  return kind === 'seller' ? '/(tabs)/index' : kind === 'buyer' ? '/(buyer)/index' : null;
}

export interface AccountSwitchTarget {
  /** Clerk user id being switched to; null when not known up front. */
  userId: string | null;
  kind: AccountKind;
}

export interface AccountSwitchDeps {
  /** Raise the cover; resolves once it is opaque. */
  cover: () => Promise<void>;
  /** Fade the cover out. */
  uncover: () => void;
  /** Make the target account the active Clerk session. */
  activate: () => Promise<void>;
  navigate: (route: string) => void;
  warmRoute: (route: string) => Promise<void>;
  getScope: () => string;
  subscribeScope: (listener: () => void) => () => void;
  subscribeScreenReady: (listener: (screen: string) => void) => () => void;
  ceilingMs?: number;
}

export type AccountSwitchResult = 'switched' | 'timed-out' | 'failed';

export async function runAccountSwitch(
  target: AccountSwitchTarget,
  deps: AccountSwitchDeps,
): Promise<AccountSwitchResult> {
  const fromScope = deps.getScope();
  const code = switchHomeCode(target.kind);
  await Promise.all([deps.cover(), code ? deps.warmRoute(code) : undefined]);

  try {
    await deps.activate();
  } catch {
    deps.uncover();
    return 'failed';
  }

  const expectedScreen = switchHomeScreen(target.kind);
  const isTargetScope = (scope: string) => (target.userId ? scope === target.userId : scope !== fromScope);
  let unsubscribeScope = () => {};
  let unsubscribeScreen = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = await new Promise<AccountSwitchResult>((resolve) => {
    let scoped = false;
    let navigated = false;
    const onScope = () => {
      if (scoped || !isTargetScope(deps.getScope())) return;
      scoped = true;
      if (!navigated) {
        navigated = true;
        deps.navigate(switchHomeRoute(target.kind));
      }
    };
    // Listen before anything can mount: the new shell mounts on the scope
    // change, and only a paint after it counts (never an old-account frame).
    unsubscribeScreen = deps.subscribeScreenReady((screen) => {
      if (!scoped) return;
      if (expectedScreen && screen !== expectedScreen) return;
      resolve('switched');
    });
    unsubscribeScope = deps.subscribeScope(onScope);
    timer = setTimeout(() => resolve('timed-out'), deps.ceilingMs ?? SWITCH_READY_CEILING_MS);
    onScope();
  });

  clearTimeout(timer);
  unsubscribeScope();
  unsubscribeScreen();
  if (result === 'timed-out' && !isTargetScope(deps.getScope())) {
    // Clerk never moved to the target (or the caches never followed): land
    // wherever AuthGate decides rather than leaving the old shell mid-swap.
    deps.navigate('/');
  }
  deps.uncover();
  return result;
}
