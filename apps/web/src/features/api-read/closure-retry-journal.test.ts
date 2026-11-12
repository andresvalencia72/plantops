import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { clearClosureRetry, closureFingerprint,
  readClosureRetry, saveClosureRetry } from './closure-retry-journal'
const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC08 closure durable retry', () => {
  it('stores only UUID+digest, scoped to actor/tenant/incident', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const digest = await closureFingerprint(incident,
      ' Equipment inspected ', ' All work verified ')
    saveClosureRetry(actor, org, incident, { key, fingerprint: digest })
    expect(readClosureRetry(actor, org, incident)).toEqual({ key, fingerprint: digest })
    expect(readClosureRetry(key, org, incident)).toBeNull()
    expect(readClosureRetry(actor, key, incident)).toBeNull()
    expect(readClosureRetry(actor, org, key)).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('inspected')
    expect(await closureFingerprint(incident.toUpperCase(),
      'Equipment inspected', 'All work verified')).toBe(digest)
    clearClosureRetry(actor, org, incident)
    expect(readClosureRetry(actor, org, incident)).toBeNull()
  })

  it('rejects corrupted or conflicting records before any new POST', () => {
    const pointer = { key, fingerprint: 'f'.repeat(64) }
    saveClosureRetry(actor, org, incident, pointer)
    expect(() => saveClosureRetry(actor, org, incident,
      { ...pointer, fingerprint: 'a'.repeat(64) })).toThrow('sin confirmar')
    sessionStorage.setItem(Object.keys(sessionStorage)[0]!, '{"key":"invalid"}')
    expect(() => readClosureRetry(actor, org, incident)).toThrow('No se pudo validar')
  })
})
