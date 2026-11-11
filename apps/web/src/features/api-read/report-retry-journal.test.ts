import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeWebCrypto } from '@/test/fake-webcrypto'
import { clearPendingReport, fingerprintReport, readPendingReport, savePendingReport } from './report-retry-journal'

const actorA = '0a0b0c0d-0e0f-4a11-8a22-333344445555'
const actorB = '1a0b0c0d-0e0f-4a11-8a22-333344445555'
const tenantA = '0a0b0c0d-0e0f-4b11-8a22-333344445555'
const tenantB = '0a0b0c0d-0e0f-4c11-8a22-333344445555'
const key = '2a0b0c0d-0e0f-4a11-8a22-333344445555'

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals() })

describe('tab-scoped incident report retry recovery', () => {
  it('stores only retry key and a body fingerprint, scoped by actor and tenant', async () => {
    vi.stubGlobal('crypto', fakeWebCrypto())
    const payload = {
      assetId: tenantA, title: '  Fallo del motor ',
      description: 'Anomalía visible durante el turno ',
    }
    const fingerprint = await fingerprintReport(payload)
    savePendingReport(actorA, tenantA, { key, fingerprint })
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(readPendingReport(actorA, tenantA)).toEqual({ key, fingerprint })
    expect(readPendingReport(actorB, tenantA)).toBeNull()
    expect(readPendingReport(actorA, tenantB)).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain('Anomalía visible')
    const same = { ...payload, assetId: tenantA.toUpperCase(),
      title: payload.title.trim(), description: payload.description.trim() }
    expect(await fingerprintReport(same)).toBe(fingerprint)
    clearPendingReport(actorA, tenantA)
    expect(readPendingReport(actorA, tenantA)).toBeNull()
  })

  it('rejects conflicting saved attempts and invalid journal values', () => {
    const fingerprint = 'e'.repeat(64)
    savePendingReport(actorA, tenantA, { key, fingerprint })
    expect(() => savePendingReport(actorA, tenantA, {
      key: '3a0b0c0d-0e0f-4a11-8a22-333344445555', fingerprint,
    })).toThrow('Ya existe')
    const [journalKey] = Object.keys(sessionStorage)
    if (!journalKey) throw new Error('Missing journal key')
    sessionStorage.setItem(journalKey, '{"key":"invalid","fingerprint":"bad"}')
    expect(() => readPendingReport(actorA, tenantA)).toThrow('No se pudo verificar')
  })
})
