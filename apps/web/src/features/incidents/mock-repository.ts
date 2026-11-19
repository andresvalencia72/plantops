import type { DemoOrganization } from '@/app/types'
import { assets, incidents } from './fixtures'
import type { AssetSummary, IncidentView } from './types'

export interface IncidentRepository {
  list(organization: DemoOrganization): Promise<IncidentView[]>
  getById(organization: DemoOrganization, id: string): Promise<IncidentView | null>
  listAssets(organization: DemoOrganization): Promise<AssetSummary[]>
}

function toView(organization: DemoOrganization, id: string): IncidentView | null {
  const record = incidents.find((item) => item.organization === organization && item.id === id)
  if (!record) return null
  const asset = assets.find((item) => item.organization === organization && item.id === record.assetId)
  if (!asset) throw new Error('Datos ficticios inconsistentes: incidencia sin activo propio')
  return { ...record, asset: { ...asset } }
}

export const mockIncidentRepository: IncidentRepository = {
  async list(organization) {
    return incidents.filter((item) => item.organization === organization)
      .map((item) => toView(organization, item.id)!)
  },
  async getById(organization, id) {
    return toView(organization, id)
  },
  async listAssets(organization) {
    return assets.filter((item) => item.organization === organization).map((asset) => ({ ...asset }))
  },
}
