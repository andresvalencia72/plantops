import { describe, expect, it } from 'vitest';
import {
  addCalendarDays, isDueOnLocalDay, localCalendarDay,
  resolvePlantTimeZone,
} from './industrial-calendar.js';

describe('industrial calendar — accepted civil-day semantics', () => {
  it('uses a validated IANA place zone, never a numeric offset', () => {
    expect(resolvePlantTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(resolvePlantTimeZone('America/Bogota')).toBe('America/Bogota');
    expect(resolvePlantTimeZone('Asia/Kathmandu')).toBe('Asia/Kathmandu');
    for (const invalid of ['', 'UTC+2', '+02:00', 'GMT+0100', 'Bad/Invalid', ' Europe/Madrid ']) {
      expect(() => resolvePlantTimeZone(invalid)).toThrow(RangeError);
    }
  });

  it('resolves local days from the same UTC instant for distinct plants', () => {
    const instant = new Date('2026-03-29T22:30:00.000Z');
    expect(localCalendarDay(instant, 'Europe/Madrid')).toBe('2026-03-30');
    expect(localCalendarDay(instant, 'America/Bogota')).toBe('2026-03-29');
    expect(localCalendarDay(instant, 'Asia/Kathmandu')).toBe('2026-03-30');
  });

  it('does not mistake UTC day for local due day at DST boundaries', () => {
    const instant = new Date('2026-03-29T22:30:00.000Z');
    expect(isDueOnLocalDay('2026-03-30', 'Europe/Madrid', instant)).toBe(true);
    expect(isDueOnLocalDay('2026-03-30', 'America/Bogota', instant)).toBe(false);
    expect(isDueOnLocalDay('2026-03-29', 'America/Bogota', instant)).toBe(true);
    expect(isDueOnLocalDay('2026-03-31', 'Europe/Madrid', instant)).toBe(false);
  });

  it('handles DST fall back without skipping or duplicating a civil day', () => {
    expect(localCalendarDay(
      new Date('2026-10-25T00:30:00.000Z'), 'Europe/Madrid',
    )).toBe('2026-10-25');
    expect(localCalendarDay(
      new Date('2026-10-25T01:30:00.000Z'), 'Europe/Madrid',
    )).toBe('2026-10-25');
    expect(localCalendarDay(
      new Date('2026-10-25T23:30:00.000Z'), 'Europe/Madrid',
    )).toBe('2026-10-26');
  });

  it('adds Gregorian days, not 24-hour intervals across a DST change', () => {
    expect(addCalendarDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addCalendarDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addCalendarDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addCalendarDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addCalendarDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rejects invalid inputs and values outside the provisional contract', () => {
    for (const invalid of ['2026-02-30', '2026-13-01', '2099-99-99', '2026-1-1']) {
      expect(() => addCalendarDays(invalid, 1)).toThrow(RangeError);
      expect(() => isDueOnLocalDay(invalid, 'Europe/Madrid', new Date())).toThrow(RangeError);
    }
    for (const invalid of [0, -1, 1.5, 366]) {
      expect(() => addCalendarDays('2026-01-01', invalid)).toThrow(RangeError);
    }
    expect(() => addCalendarDays('2099-12-31', 1)).toThrow(RangeError);
    expect(() => localCalendarDay(new Date(Number.NaN), 'Europe/Madrid'))
      .toThrow(RangeError);
  });

  it('checks overdue days inclusive but never generates an order by itself', () => {
    const instant = new Date('2026-11-16T00:30:00.000Z');
    expect(isDueOnLocalDay('2026-11-15', 'America/Bogota', instant)).toBe(true);
    expect(isDueOnLocalDay('2026-11-16', 'America/Bogota', instant)).toBe(false);
    expect(isDueOnLocalDay('2026-11-16', 'Europe/Madrid', instant)).toBe(true);
  });
});
