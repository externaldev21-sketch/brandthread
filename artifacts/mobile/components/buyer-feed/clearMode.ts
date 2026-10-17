/** Long-press "Clear mode": hide all overlay chrome so only the media shows. */
export function clearModeChromeStyle(clear: boolean): { opacity: number; pointerEvents?: 'none' } {
  return clear ? { opacity: 0, pointerEvents: 'none' } : { opacity: 1 };
}
/** Photo carousels never auto-advance unless the viewer opts in. */
export const PHOTO_AUTO_ADVANCE_DEFAULT = false;
