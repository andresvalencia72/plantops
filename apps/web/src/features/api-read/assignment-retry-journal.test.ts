import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { clearPendingAssignment, fingerprintAssignment,
  readPendingAssignment, savePendingAssignment } from './assignment-retry-journal'

const actor = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const org = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const incident = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const order = '0a0b0c0d-0e0f-4d11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'

const pointer = { key, fingerprint: 'f'.repeat(64), expectedVersion: 0 }
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('UC-05 assignment retry journal', () => {
  it('stores version, retry UUID and hash only, scoped to actor/tenant/incident/order', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const input = { technicianMembershipId: key, expectedVersion: 0,
      reason: ' Cambio de turno ' }
    const fingerprint = await fingerprintAssignment(incident, order, input)
    savePendingAssignment(actor, org, incident, order,
      { key, fingerprint, expectedVersion: 0 })
    expect(readPendingAssignment(actor, org, incident, order))
      .toEqual({ key, fingerprint, expectedVersion: 0 })
    expect(readPendingAssignment(key, org, incident, order)).toBeNull()
    expect(readPendingAssignment(actor, key, incident, order)).toBeNull()
    expect(readPendingAssignment(actor, org, key, order)).toBeNull()
    expect(readPendingAssignment(actor, org, incident, key)).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('Cambio de turno')
    expect(await fingerprintAssignment(incident.toUpperCase(), order.toUpperCase(), {
      technicianMembershipId: key.toUpperCase(), expectedVersion: 0,
      reason: 'Cambio de turno',
    })).toBe(fingerprint)
    clearPendingAssignment(actor, org, incident, order)
    expect(readPendingAssignment(actor, org, incident, order)).toBeNull()
  })

  it('rejects malformed metadata, wrong version and key reuse', () => {
    savePendingAssignment(actor, org, incident, order, pointer)
    expect(() => savePendingAssignment(actor, org, incident, order, {
      ...pointer, expectedVersion: 1,
    })).toThrow('Existe otro cambio')
    expect(() => savePendingAssignment(actor, org, incident, order,
      { ...pointer, key: 'invalid' })).toThrow('no válida')
    const keyName = Object.keys(sessionStorage)[0]!
    sessionStorage.setItem(keyName, '{"key":"invalid","expectedVersion":-1}')
    expect(() => readPendingAssignment(actor, org, incident, order))
      .toThrow('No se pudo comprobar')
  })
})
