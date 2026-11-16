import { describe, expect, it } from 'vitest';
import {
  postgresTextLength, postgresTextLengthIsBetween,
} from './postgres-text-length.js';

describe('PostgreSQL-compatible UTF-8 character validation', () => {
  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(postgresTextLength('abcd')).toBe(4);
    expect(postgresTextLength('😀😀')).toBe(2);
    expect(postgresTextLength('a\u0301')).toBe(2);
    expect(postgresTextLength('')).toBe(0);
  });
  it('matches the SQL minimum and maximum inclusive boundaries', () => {
    expect(postgresTextLengthIsBetween('😀'.repeat(2), 3, 160)).toBe(false);
    expect(postgresTextLengthIsBetween('😀'.repeat(3), 3, 160)).toBe(true);
    expect(postgresTextLengthIsBetween('😀'.repeat(160), 3, 160)).toBe(true);
    expect(postgresTextLengthIsBetween('😀'.repeat(161), 3, 160)).toBe(false);
    expect(postgresTextLengthIsBetween('😀'.repeat(5), 10, 1000)).toBe(false);
    expect(postgresTextLengthIsBetween('😀'.repeat(1000), 10, 1000)).toBe(true);
  });
});
