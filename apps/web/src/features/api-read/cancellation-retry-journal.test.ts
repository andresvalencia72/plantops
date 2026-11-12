import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { cancellationFingerprint, clearCancellationRetry,
  readCancellationRetry, saveCancellationRetry } from './cancellation-retry-journal'

const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const order = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC07 cancellation retry journal', () => {
  it('stores key/hash only, with user and tenant isolation', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const fingerprint = await cancellationFingerprint(incident, order,
      ' Equipment already replaced ')
    saveCancellationRetry(actor, org, incident, order, { key, fingerprint })
    expect(readCancellationRetry(actor, org, incident, order))
      .toEqual({ key, fingerprint })
    expect(readCancellationRetry(key, org, incident, order)).toBeNull()
    expect(readCancellationRetry(actor, key, incident, order)).toBeNull()
    expect(readCancellationRetry(actor, org, key, order)).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('replaced')
    expect(await cancellationFingerprint(incident.toUpperCase(), order,
      'Equipment already replaced')).toBe(fingerprint)
    clearCancellationRetry(actor, org, incident, order)
    expect(readCancellationRetry(actor, org, incident, order)).toBeNull()
  })

  it('fails closed on malformed or conflicting retry records', () => {
    const data = { key, fingerprint: 'f'.repeat(64) }
    saveCancellationRetry(actor, org, incident, order, data)
    expect(() => saveCancellationRetry(actor, org, incident, order,
      { ...data, fingerprint: 'a'.repeat(64) })).toThrow('sin confirmar')
    sessionStorage.setItem(Object.keys(sessionStorage)[0]!, '{"key":"broken"}')
    expect(() => readCancellationRetry(actor, org, incident, order)).toThrow('no se puede validar')
  })
})
