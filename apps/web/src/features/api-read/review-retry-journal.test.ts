import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearReviewRetryKey, reviewRetryKey } from './review-retry-journal'

const user = '11111111-1111-4111-8111-111111111111'
const orgA = '22222222-2222-4222-8222-222222222222'
const orgB = '33333333-3333-4333-8333-333333333333'
const incident = '44444444-4444-4444-8444-444444444444'

beforeEach(() => sessionStorage.clear())

describe('review retry pointer', () => {
  it('keeps the exact same UUID after a simulated reload and isolates tenants', () => {
    const first = reviewRetryKey(user, orgA, incident)
    expect(first).toMatch(/^[\da-f-]{36}$/)
    expect(reviewRetryKey(user, orgA, incident)).toBe(first)
    expect(reviewRetryKey(user, orgB, incident)).not.toBe(first)
    expect(sessionStorage.length).toBe(2)
    clearReviewRetryKey(user, orgA, incident)
    expect(sessionStorage.length).toBe(1)
  })
  it('fails closed for invalid identity and malformed stored data', () => {
    expect(() => reviewRetryKey('not-a-user', orgA, incident)).toThrow('contexto')
    reviewRetryKey(user, orgA, incident)
    sessionStorage.setItem(sessionStorage.key(0)!, 'corrupt')
    expect(() => reviewRetryKey(user, orgA, incident)).toThrow('no es válida')
  })
  it('never calls fetch and stores only a retry UUID', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const key = reviewRetryKey(user, orgA, incident)
    const stored = sessionStorage.getItem(sessionStorage.key(0)!)
    expect(stored).toBe(key)
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
})
