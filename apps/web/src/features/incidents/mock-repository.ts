import type { DemoOrganization } from '@/app/types'
import { assets, incidents } from './fixtures'
import type { AssetSummary, IncidentRecord, IncidentView, ReportIncidentInput } from './types'

export interface IncidentRepository {
  list(organization: DemoOrganization): Promise<IncidentView[]>
  getById(organization: DemoOrganization, id: string): Promise<IncidentView | null>
  listAssets(organization: DemoOrganization): Promise<AssetSummary[]>
  report(organization: DemoOrganization, input: ReportIncidentInput): Promise<IncidentView>
}

// A demo adapter, NOT a multi-tenant security implementation.
export function createMockIncidentRepository() {
  let created: IncidentRecord[] = []
  let sequence = 0

  function all() {
    return [...incidents, ...created]
  }

  function toView(organization: DemoOrganization, id: string): IncidentView | null {
    const record = all().find((item) => item.organization === organization && item.id === id)
    if (!record) return null
    const asset = assets.find((item) => item.organization === organization && item.id === record.assetId)
    if (!asset) throw new Error('Datos ficticios inconsistentes: incidencia sin activo propio')
    return { ...record, asset: { ...asset } }
  }

  return {
    async list(organization: DemoOrganization) {
      return all().filter((item) => item.organization === organization)
        .map((item) => toView(organization, item.id)!)
    },
    async getById(organization: DemoOrganization, id: string) {
      return toView(organization, id)
    },
    async listAssets(organization: DemoOrganization) {
      return assets.filter((item) => item.organization === organization).map((asset) => ({ ...asset }))
    },
    async report(organization: DemoOrganization, input: ReportIncidentInput) {
      const asset = assets.find((item) => item.organization === organization && item.id === input.assetId)
      if (!asset) throw new Error('El activo seleccionado no pertenece a esta organización.')
      if (input.title.trim().length < 3) throw new Error('El título debe tener al menos 3 caracteres.')
      if (input.description.trim().length < 10) throw new Error('La descripción debe tener al menos 10 caracteres.')

      const record: IncidentRecord = {
        id: 'INC-DEMO-' + String(++sequence).padStart(3, '0'),
        organization, assetId: asset.id,
        title: input.title.trim(), description: input.description.trim(),
        status: 'REPORTED', priority: 'MEDIUM',
        reportedAt: new Date().toISOString(), reportedBy: 'Operador demo',
      }
      created = [...created, record]
      return { ...record, asset: { ...asset } }
    },
    resetForTests() { created = []; sequence = 0 },
  }
}

export const mockIncidentRepository = createMockIncidentRepository()
