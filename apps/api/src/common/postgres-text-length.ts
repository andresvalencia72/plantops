/**
 * PostgreSQL char_length(text) counts Unicode code points, whereas JS
 * .length counts UTF-16 code units. Keep HTTP validation aligned with
 * SQL CHECK constraints to reject malformed inputs before INSERT.
 */
export function postgresTextLength(text: string): number {
  return Array.from(text).length;
}

export function postgresTextLengthIsBetween(
  text: string, min: number, max: number,
): boolean {
  const length = postgresTextLength(text);
  return length >= min && length <= max;
}
