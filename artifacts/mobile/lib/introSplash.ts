/**
 * Tracks whether the animated launch intro has ever completed on this
 * device, so the first-ever run after install can play the longer,
 * more dramatic variant while every later cold start uses the short one.
 */

const FIRST_LAUNCH_KEY = 'bt:intro-splash:launched:v1';

export interface LaunchFlagStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Resolves whether this is the first-ever launch and marks the device as
 * launched for next time. A storage failure is treated as "not first" —
 * we can't confirm a real first run, and the short variant is the safer
 * default.
 */
export async function consumeFirstLaunch(storage: LaunchFlagStorage): Promise<boolean> {
  try {
    const seen = await storage.getItem(FIRST_LAUNCH_KEY);
    if (seen === 'true') return false;
    await storage.setItem(FIRST_LAUNCH_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}

export { FIRST_LAUNCH_KEY };
