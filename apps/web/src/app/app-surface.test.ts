import { describe, expect, it } from 'vitest'
import { resolveAppSurface } from './app-surface'

describe('explicit PlantOps product surface', () => {
  it('defaults to demo, without making the API reachable in production by query', () => {
    expect(resolveAppSurface(undefined, false, '')).toBe('demo')
    expect(resolveAppSurface(undefined, false, '?source=api')).toBe('demo')
    expect(resolveAppSurface('demo', true, '?source=api')).toBe('demo')
  })
  it('retains the legacy local API preview only for default development builds', () => {
    expect(resolveAppSurface(undefined, true, '?source=api')).toBe('authenticated')
    expect(resolveAppSurface(undefined, true, '?source=other')).toBe('demo')
  })
  it('keeps the authenticated surface even when query parameters request demo', () => {
    for (const search of ['', '?source=demo', '?source=api', '?source=atlas']) {
      expect(resolveAppSurface('authenticated', false, search)).toBe('authenticated')
      expect(resolveAppSurface('authenticated', true, search)).toBe('authenticated')
    }
  })
  it('rejects unknown or misspelled surfaces rather than silently downgrading', () => {
    for (const value of ['production', 'auth', 'DEMO', 'private']) {
      expect(() => resolveAppSurface(value, false, '')).toThrow('Invalid PlantOps')
    }
  })
})
