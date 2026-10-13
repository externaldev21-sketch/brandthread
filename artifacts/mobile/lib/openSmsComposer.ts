/**
 * Opens Messages with `body` filled in (and `to`, when given). On web, or
 * where `sms:` can't be opened, falls back to the system share sheet.
 */
import { Linking, Platform, Share } from 'react-native';
import { smsComposeUrl } from '@/lib/smsLink';

export async function openSmsComposer(body: string, to?: string | null): Promise<void> {
  const url = smsComposeUrl(body, Platform.OS, to);
  const supported = Platform.OS !== 'web' && await Linking.canOpenURL(url).catch(() => false);
  if (supported) await Linking.openURL(url);
  else await Share.share({ message: body });
}
