/**
 * The device's IANA time zone (e.g. "America/Los_Angeles"). Quiet hours are
 * evaluated server-side in this zone, so it is sent with every quiet-hours
 * save and every push-token registration. Undefined when the runtime cannot
 * tell (the server then keeps whatever zone it already has).
 */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 && zone.length <= 64 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** Quiet-hours body for PUT /api/notification-prefs, stamped with the device zone. */
export function quietHoursBody(
  start: string | null,
  end: string | null,
): { start: string; end: string; timezone?: string } | null {
  if (!start || !end) return null;
  const timezone = deviceTimeZone();
  return timezone ? { start, end, timezone } : { start, end };
}
