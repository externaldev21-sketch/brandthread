/**
 * Whether the user is touching the screen right now (or just was). Background
 * scene pre-mounting (components/navigation/TabScenePreloader) waits for a
 * quiet moment: a scene mount that lands mid-press blocks the press handlers
 * and, on a slow device or dev build, can make a tap read as a long-press.
 */
let touching = 0;
let lastInputAt = 0;
let webListening = false;

const now = () => Date.now();

export function noteTouchStart(): void {
  touching += 1;
  lastInputAt = now();
}

export function noteTouchEnd(): void {
  touching = Math.max(0, touching - 1);
  lastInputAt = now();
}

/** True while a finger is down, or within `quietMs` of the last touch. */
export function isUserInteracting(quietMs = 400): boolean {
  listenOnWeb();
  return touching > 0 || now() - lastInputAt < quietMs;
}

function listenOnWeb(): void {
  if (webListening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  webListening = true;
  // Mouse/pen presses never reach RN's touch handlers on web.
  document.addEventListener('pointerdown', () => { touching = 1; lastInputAt = now(); }, true);
  const up = () => { touching = 0; lastInputAt = now(); };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
}
