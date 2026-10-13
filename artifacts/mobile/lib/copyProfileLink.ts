/**
 * "Copy profile link" (Instagram profile ••• → Copy profile URL → "Link
 * copied"). Copies the canonical https://brandthread.app/u/<handle> link.
 * The clipboard writer is injected so this stays free of native imports.
 */
import { buildCanonicalProfileUrl } from '@/lib/shareProfile';

export async function copyProfileLink(
  username: string | null | undefined,
  setString: (text: string) => Promise<unknown>,
): Promise<boolean> {
  const url = buildCanonicalProfileUrl(username);
  if (!url) return false;
  try {
    await setString(url);
    return true;
  } catch {
    return false;
  }
}
