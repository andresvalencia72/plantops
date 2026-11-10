import { describe, expect, it } from 'vitest'
import { assets, incidents } from './fixtures'
import { mockIncidentRepository } from './mock-repository'
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
