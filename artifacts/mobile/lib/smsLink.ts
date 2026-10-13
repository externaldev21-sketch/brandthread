/**
 * `sms:` URL that opens the Messages composer with a prefilled body and,
 * optionally, the recipient. iOS reads the body after `&`, Android after `?`.
 */
export function smsComposeUrl(body: string, os: string, to?: string | null): string {
  return `sms:${to ? to.replace(/[^+\d]/g, '') : ''}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
