import { useEffect, useState } from 'react'
import type { DemoOrganization } from '@/app/types'
import { mockIncidentRepository } from './mock-repository'
import type { IncidentView } from './types'

interface IncidentState {
  organization: DemoOrganization
  records: IncidentView[]
  loading: boolean
  error: string | null
}

export function useIncidents(organization: DemoOrganization) {
  const [state, setState] = useState<IncidentState>({
    organization, records: [], loading: true, error: null,
  })

  useEffect(() => {
    let active = true
    void mockIncidentRepository.list(organization).then((records) => {
      if (active) setState({ organization, records, loading: false, error: null })
    }).catch(() => {
      if (active) setState({ organization, records: [], loading: false, error: 'No se pudo cargar la información.' })
    })
    return () => { active = false }
  }, [organization])

  // Never display rows from the previous organization during a context switch.
  if (state.organization !== organization) {
    return { records: [], loading: true, error: null }
  }
  return { records: state.records, loading: state.loading, error: state.error }
}
