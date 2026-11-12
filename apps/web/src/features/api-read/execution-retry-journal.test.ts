import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { clearExecutionRetry, fingerprintExecution,
  readExecutionRetry, saveExecutionRetry } from './execution-retry-journal'
const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const order = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC06 execution journal', () => {
  it('scopes attempts to actor, tenant, incident, order and action, no work result', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const fingerprint = await fingerprintExecution(incident, order, 'COMPLETED',
      ' Replaced main motor bearing ')
    saveExecutionRetry(actor, org, incident, order, 'COMPLETED', { key, fingerprint })
    expect(readExecutionRetry(actor, org, incident, order, 'COMPLETED'))
      .toEqual({ key, fingerprint })
    expect(readExecutionRetry(actor, org, incident, order, 'STARTED')).toBeNull()
    expect(readExecutionRetry(key, org, incident, order, 'COMPLETED')).toBeNull()
    expect(readExecutionRetry(actor, key, incident, order, 'COMPLETED')).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('motor')
    expect(await fingerprintExecution(incident.toUpperCase(), order,
      'COMPLETED', 'Replaced main motor bearing')).toBe(fingerprint)
    clearExecutionRetry(actor, org, incident, order, 'COMPLETED')
    expect(readExecutionRetry(actor, org, incident, order, 'COMPLETED')).toBeNull()
  })

  it('rejects corrupted pointers and conflicts with prior retries', () => {
    saveExecutionRetry(actor, org, incident, order, 'STARTED', {
      key, fingerprint: 'f'.repeat(64),
    })
    expect(() => saveExecutionRetry(actor, org, incident, order, 'STARTED', {
      key, fingerprint: 'a'.repeat(64),
    })).toThrow('sin confirmar')
    const stored = Object.keys(sessionStorage)[0]!
    sessionStorage.setItem(stored, '{"key":"bad","fingerprint":"abc"}')
    expect(() => readExecutionRetry(actor, org, incident, order, 'STARTED'))
      .toThrow('validar')
  })
})
