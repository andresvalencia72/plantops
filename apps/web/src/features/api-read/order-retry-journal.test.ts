import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import {
  clearPendingOrder, fingerprintOrder, readPendingOrder, savePendingOrder,
} from './order-retry-journal'

const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const otherActor = '1a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const otherOrg = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const otherIncident = '0a0b0c0d-0e0f-4e11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC-04 session-scoped order idempotency recovery', () => {
  it('stores only key and canonical SHA-256, not body, scoped to tenant/actor/incident', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const input = { title: ' Cambiar rodamiento ',
      description: ' Comprobar la vibración del motor principal ' }
    const fingerprint = await fingerprintOrder(incident.toUpperCase(), input)
    savePendingOrder(actor, org, incident, { key, fingerprint })
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(readPendingOrder(actor, org, incident)).toEqual({ key, fingerprint })
    expect(readPendingOrder(otherActor, org, incident)).toBeNull()
    expect(readPendingOrder(actor, otherOrg, incident)).toBeNull()
    expect(readPendingOrder(actor, org, otherIncident)).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('Cambiar rodamiento')
    expect(JSON.stringify(sessionStorage)).not.toContain('vibración')
    expect(await fingerprintOrder(incident, {
      title: input.title.trim(), description: input.description.trim(),
    })).toBe(fingerprint)
    clearPendingOrder(actor, org, incident)
    expect(readPendingOrder(actor, org, incident)).toBeNull()
  })

  it('fails closed on malformed or conflicting retry metadata', () => {
    const fingerprint = 'd'.repeat(64)
    savePendingOrder(actor, org, incident, { key, fingerprint })
    expect(() => savePendingOrder(actor, org, incident, {
      key: '3a0b0c0d-0e0f-4a11-8a22-333344445555', fingerprint,
    })).toThrow('Existe una orden sin confirmar')
    expect(() => savePendingOrder(actor, org, incident, {
      key: 'invalid', fingerprint,
    })).toThrow('La clave')
    const [storedKey] = Object.keys(sessionStorage)
    if (!storedKey) throw new Error('Missing pointer')
    sessionStorage.setItem(storedKey, '{"key":"broken"}')
    expect(() => readPendingOrder(actor, org, incident)).toThrow('No se pudo verificar')
    expect(() => readPendingOrder(actor, org, otherIncident)).not.toThrow()
  })
})
