import type { IncidentFilters, IncidentView } from './types'

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function filterIncidents(incidents: IncidentView[], filters: IncidentFilters): IncidentView[] {
  const query = normalize(filters.query.trim())
  return incidents
    .filter((item) => filters.status === 'ALL' || item.status === filters.status)
    .filter((item) => filters.priority === 'ALL' || item.priority === filters.priority)
    .filter((item) => !query || normalize([
      item.id, item.title, item.description, item.asset.name,
      item.asset.code, item.asset.location,
    ].join(' ')).includes(query))
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
}

export function summarizeIncidents(incidents: IncidentView[]) {
  return {
    total: incidents.length,
    open: incidents.filter((item) => item.status !== 'CLOSED').length,
    critical: incidents.filter((item) => item.status !== 'CLOSED' && item.priority === 'CRITICAL').length,
    inProgress: incidents.filter((item) => item.status === 'IN_PROGRESS').length,
    pendingReview: incidents.filter((item) => item.status === 'REPORTED').length,
  }
}
