/** Display helpers for the Text messages (SMS order updates) screen. */

/** "+15551234567" → "+1 (555) 123-4567"; other countries keep E.164. */
export function formatSmsPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `+1 (${us[1]}) ${us[2]}-${us[3]}` : e164;
}

/** Last four digits only, for the code step: "+15551234567" → "•••• 4567". */
export function maskSmsPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return `•••• ${e164.slice(-4)}`;
}

/** TCPA / CTIA opt-in disclosure shown above "Turn on". */
export const SMS_OPT_IN_DISCLOSURE =
  'By turning on order updates, you agree to get automated texts from Brandthread about your orders at this number. '
  + 'Consent is not a condition of purchase. Msg frequency varies. Msg & data rates may apply. '
  + 'Reply STOP to opt out, HELP for help.';

/** Short version shown once texts are on. */
export const SMS_ON_DISCLOSURE = 'Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.';
