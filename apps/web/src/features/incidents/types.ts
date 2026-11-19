import type { DemoOrganization } from '@/app/types'

export type IncidentStatus = 'REPORTED' | 'UNDER_REVIEW' | 'IN_PROGRESS' | 'CLOSED'
export type IncidentPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface AssetSummary {
  id: string
  organization: DemoOrganization
  code: string
  name: string
  location: string
}

export interface IncidentRecord {
  id: string
  organization: DemoOrganization
  assetId: string
  title: string
  description: string
  status: IncidentStatus
  priority: IncidentPriority
  reportedAt: string
  reportedBy: string
}

export interface IncidentView extends IncidentRecord {
  asset: AssetSummary
}

export interface IncidentFilters {
  query: string
  status: IncidentStatus | 'ALL'
  priority: IncidentPriority | 'ALL'
}

export interface ReportIncidentInput {
  assetId: string
  title: string
  description: string
}
