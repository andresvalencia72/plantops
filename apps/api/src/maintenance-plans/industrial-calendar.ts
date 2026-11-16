import { isUtcCalendarDay } from './utc-calendar-day.js';

/** A civil day is YYYY-MM-DD; it has no UTC offset or time of day. */
export type CivilDay = string & { readonly __civilDay: unique symbol };
export type PlantTimeZone = string & { readonly __plantTimeZone: unique symbol };

function civilDay(value: string): CivilDay {
  if (!isUtcCalendarDay(value)) {
    throw new RangeError('Invalid Gregorian calendar day (2000–2099)');
  }
  return value as CivilDay;
}

/** Accept only named IANA zones, not a client-supplied fixed UTC offset. */
export function resolvePlantTimeZone(value: string): PlantTimeZone {
  if (typeof value !== 'string' ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) {
    throw new RangeError('An IANA time zone identifier is required');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new RangeError('Unknown IANA time zone');
  }
  return value as PlantTimeZone;
}

/**
 * Resolve only the Gregorian civil date of an instant in the plant's
 * IANA zone. UTC timestamps remain instants in audit/event columns.
 * Never compare JavaScript's host-local Date components here.
 */
export function localCalendarDay(
  instant: Date, timeZone: string,
): CivilDay {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new RangeError('Invalid UTC instant');
  }
  const zone = resolvePlantTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const component = (part: 'year' | 'month' | 'day') =>
    parts.find(({ type }) => type === part)?.value;
  const year = component('year');
  const month = component('month');
  const day = component('day');
  if (!year || !month || !day) {
    throw new RangeError('Unable to derive local civil date');
  }
  return civilDay(`${year.padStart(4, '0')}-${month}-${day}`);
}

/** Inclusive comparison; caller must still authorize manual generation. */
export function isDueOnLocalDay(
  dueOn: string, timeZone: string, asOfUtc: Date,
): boolean {
  return civilDay(dueOn) <= localCalendarDay(asOfUtc, timeZone);
}

/**
 * Add calendar days (not elapsed hours), supporting leap years and DST.
 * No plant zone is involved until the resulting civil day is compared
 * against an instant.
 */
export function addCalendarDays(day: string, intervalDays: number): CivilDay {
  const normalized = civilDay(day);
  if (!Number.isInteger(intervalDays) ||
    intervalDays < 1 || intervalDays > 365) {
    throw new RangeError('Interval must be an integer from 1 to 365 days');
  }
  const next = new Date(`${normalized}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + intervalDays);
  return civilDay(next.toISOString().slice(0, 10));
}
