import { describe, expect, it } from 'vitest'
import { assets, incidents } from './fixtures'
import { createMockIncidentRepository, mockIncidentRepository } from './mock-repository'
import { filterIncidents, summarizeIncidents } from './selectors'

describe('Mock data boundaries', () => {
  it('returns only the selected demo organization and consistent assets', async () => {
    const atlas = await mockIncidentRepository.list('atlas')
    const north = await mockIncidentRepository.list('north')
    expect(atlas).toHaveLength(6)
    expect(north).toHaveLength(2)
    expect(atlas.every((i) => i.organization === 'atlas' && i.asset.organization === 'atlas')).toBe(true)
    expect(north.every((i) => i.organization === 'north' && i.asset.organization === 'north')).toBe(true)
  })

  it('does not resolve an ID owned by another demo organization', async () => {
    expect(await mockIncidentRepository.getById('atlas', 'INC-2091')).toBeNull()
    expect(await mockIncidentRepository.getById('north', 'INC-1042')).toBeNull()
  })

  it('has no orphan or cross-tenant asset references in fixtures', () => {
    for (const record of incidents) {
      expect(assets.some((asset) => asset.id === record.assetId && asset.organization === record.organization))
        .toBe(true)
    }
  })

  it('derives counts from fixture rows, not independent KPIs', async () => {
    const atlas = await mockIncidentRepository.list('atlas')
    expect(summarizeIncidents(atlas)).toMatchObject({
      total: 6, open: 5, critical: 1, inProgress: 2, pendingReview: 2,
    })
  })

  it('filters by status, priority and accent-insensitive search', async () => {
    const atlas = await mockIncidentRepository.list('atlas')
    expect(filterIncidents(atlas, { query: 'manometro', status: 'ALL', priority: 'ALL' })
      .map((record) => record.id)).toEqual(['INC-1042'])
    expect(filterIncidents(atlas, { query: '', status: 'IN_PROGRESS', priority: 'HIGH' })
      .map((record) => record.id)).toEqual(['INC-1039'])
  })
})


describe('Mock incident reporting', () => {
  it('creates a reported incident for a valid asset owned by the current demo organization', async () => {
    const repository = createMockIncidentRepository()
    const incident = await repository.report('atlas', {
      assetId: 'a-101', title: '  Nuevo aviso ', description: 'La máquina vibra durante la operación.',
    })
    expect(incident).toMatchObject({
      organization: 'atlas', assetId: 'a-101', status: 'REPORTED', priority: 'MEDIUM',
      title: 'Nuevo aviso',
    })
    expect(await repository.list('atlas')).toHaveLength(7)
    expect(await repository.list('north')).toHaveLength(2)
  })

  it('rejects an asset from another demo organization', async () => {
    const repository = createMockIncidentRepository()
    await expect(repository.report('atlas', {
      assetId: 'n-201', title: 'Aviso externo', description: 'Intento de cruce de organización.',
    })).rejects.toThrow(/no pertenece/)
    expect(await repository.list('atlas')).toHaveLength(6)
  })

  it('rejects invalid title and description even when client validation is bypassed', async () => {
    const repository = createMockIncidentRepository()
    await expect(repository.report('atlas', {
      assetId: 'a-101', title: 'a', description: 'Descripción válida de ejemplo',
    })).rejects.toThrow(/título/)
    await expect(repository.report('atlas', {
      assetId: 'a-101', title: 'Título válido', description: 'corta',
    })).rejects.toThrow(/descripción/)
  })
})
