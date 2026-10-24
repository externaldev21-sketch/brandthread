/**
 * IANA time zone list, labels and search for the time zone picker
 * (components/TimeZonePicker.tsx).
 *
 * The list comes from `Intl.supportedValuesOf('timeZone')` where the engine
 * has it; older Hermes / JSC builds don't, so lib/dropSchedule's curated
 * COMMON_TIME_ZONES stands in. Offsets are worked out from `Intl.DateTimeFormat` parts,
 * not `timeZoneName: 'shortOffset'`, which some engines also lack.
 */
import { COMMON_TIME_ZONES } from '@/lib/dropSchedule';

export interface TimeZoneOption {
  /** IANA id, e.g. "America/New_York". What gets saved. */
  id: string;
  /** "New York" */
  city: string;
  /** "America", "America / Argentina"; empty for "UTC". */
  region: string;
  /** Minutes east of UTC at the reference date (DST-aware). */
  offsetMinutes: number;
  /** "GMT-4", "GMT+5:30", "GMT". */
  offsetLabel: string;
}

/** Every zone the engine knows, or the built-in list. Always includes UTC. */
export function listTimeZones(intl: { supportedValuesOf?: (key: string) => string[] } = Intl as any): string[] {
  let zones: string[] = [];
  try {
    if (typeof intl.supportedValuesOf === 'function') zones = intl.supportedValuesOf('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (!Array.isArray(zones) || zones.length === 0) zones = [...COMMON_TIME_ZONES];
  if (!zones.includes('UTC')) zones = [...zones, 'UTC'];
  return zones;
}

/** Minutes east of UTC for `timeZone` at `date`, or null when the engine doesn't know the zone. */
export function timeZoneOffsetMinutes(timeZone: string, date: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    if (!Number.isFinite(asUtc)) return null;
    const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((asUtc - wholeSeconds) / 60000);
  } catch {
    return null;
  }
}

/** "GMT", "GMT-4", "GMT+5:30". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'GMT';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Splits "America/Argentina/Buenos_Aires" into city "Buenos Aires" and region "America / Argentina". */
export function timeZoneParts(id: string): { city: string; region: string } {
  const segs = id.split('/');
  const city = (segs.pop() ?? id).replace(/_/g, ' ');
  return { city, region: segs.map(s => s.replace(/_/g, ' ')).join(' / ') };
}

export function toTimeZoneOption(id: string, date: Date = new Date()): TimeZoneOption {
  const offsetMinutes = timeZoneOffsetMinutes(id, date) ?? 0;
  return { id, ...timeZoneParts(id), offsetMinutes, offsetLabel: formatOffset(offsetMinutes) };
}

/** One-line label for a saved zone: "New York (GMT-4)". */
export function timeZoneLabel(id: string, date: Date = new Date()): string {
  if (!id) return '';
  const offset = timeZoneOffsetMinutes(id, date);
  const { city } = timeZoneParts(id);
  return offset == null ? city : `${city} (${formatOffset(offset)})`;
}

/** Options sorted west to east, then by city. A saved zone the list lacks is kept. */
export function buildTimeZoneOptions(zones: string[], date: Date = new Date(), include?: string): TimeZoneOption[] {
  const ids = include && !zones.includes(include) ? [include, ...zones] : zones;
  return ids
    .map(id => toTimeZoneOption(id, date))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city));
}

const norm = (s: string) => s.toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Matches every word of the query against the id, city, region and offset
 * ("new york", "tokyo", "europe", "gmt+5:30"). City-prefix hits come first.
 */
export function filterTimeZones(options: TimeZoneOption[], query: string): TimeZoneOption[] {
  const q = norm(query);
  if (!q) return options;
  const words = q.split(' ');
  const hits = options.filter(o => {
    const hay = `${norm(o.id)} ${norm(o.city)} ${norm(o.region)} ${o.offsetLabel.toLowerCase()}`;
    return words.every(w => hay.includes(w));
  });
  const starts = (o: TimeZoneOption) => (norm(o.city).startsWith(q) ? 0 : 1);
  return hits
    .map((o, i) => ({ o, i }))
    .sort((a, b) => starts(a.o) - starts(b.o) || a.i - b.i)
    .map(x => x.o);
}
